"""Batch ICMP probes using the Linux fping utility."""

import ipaddress
import math
import os
import subprocess
import tempfile
import time
from dataclasses import dataclass, field

SEND_INTERVAL_MS = 10
MAX_BATCH_SIZE = 256


class FpingError(RuntimeError):
    """The probe did not produce a complete measurement."""


@dataclass
class BatchMeasurements:
    samples: dict = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    target_count: int = 0
    send_seconds: float = 0.0


def _parse_results(output, targets, count):
    expected = set(targets)
    results = {}
    for line in output.splitlines():
        address, separator, samples = line.rpartition(" :")
        if not separator:
            continue
        try:
            address = str(ipaddress.ip_address(address.strip()))
        except ValueError:
            continue
        if address not in expected:
            continue
        values = samples.split()
        if len(values) != count or address in results:
            raise FpingError(f"Invalid fping result for {address}")
        try:
            latencies = [float(value) for value in values if value != "-"]
        except ValueError as exc:
            raise FpingError(f"Invalid fping RTT for {address}") from exc
        if any(not math.isfinite(value) or value < 0 for value in latencies):
            raise FpingError(f"Invalid fping RTT for {address}")
        results[address] = (latencies, count)
    if results.keys() != expected:
        raise FpingError(
            f"fping returned results for {len(results)} of {len(targets)} targets"
        )
    return results


def _probe_batch(executable, family, targets, count, timeout, stop_event):
    timeout_ms = max(1, math.ceil(timeout * 1000))
    # fping count mode requires the per-target period to cover the timeout.
    period_ms = max(10, timeout_ms)
    command = [
        executable,
        f"-{family}",
        "-q",
        "-C",
        str(count),
        "-i",
        str(SEND_INTERVAL_MS),
        "-p",
        str(period_ms),
        "-t",
        str(timeout_ms),
        *targets,
    ]
    budget = count * max(len(targets) * SEND_INTERVAL_MS, period_ms) / 1000 + 5
    deadline = time.monotonic() + budget
    # A file lets the child write freely while we wait through the monitor's
    # stop event. Eventlet's timed communicate() can raise a TimeoutExpired
    # from a different subprocess module, aborting a healthy batch.
    with tempfile.TemporaryFile() as capture:
        with subprocess.Popen(
            command,
            stdout=capture,
            stderr=subprocess.STDOUT,
            env={**os.environ, "LC_ALL": "C"},
        ) as process:
            try:
                while process.poll() is None:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise FpingError("fping exceeded its batch deadline")
                    if stop_event.wait(min(0.25, remaining)):
                        return None
            finally:
                if process.poll() is None:
                    process.kill()
        capture.seek(0)
        output = capture.read().decode("utf-8", errors="replace")

    # Exit code 1 is a normal result when one or more targets are down.
    if process.returncode not in (0, 1):
        diagnostic = "\n".join(output.splitlines()[:3])[:300]
        raise FpingError(f"fping exited with code {process.returncode}: {diagnostic}")
    return _parse_results(output, targets, count)


def probe_addresses(executable, addresses, count, timeout, stop_event):
    """Collect valid batches independently, or return None on stop."""
    measurements = BatchMeasurements()
    families = {4: {}, 6: {}}
    aliases = {}
    for address in addresses:
        try:
            ip = ipaddress.ip_address(address)
        except ValueError:
            measurements.errors.append(f"Invalid ICMP target: {address!r}")
            continue
        canonical = str(ip)
        families[ip.version][canonical] = None
        aliases[address] = canonical

    measurements.target_count = sum(map(len, families.values()))
    measurements.send_seconds = measurements.target_count * count * SEND_INTERVAL_MS / 1000
    results = {}
    for family, unique in families.items():
        targets = list(unique)
        for start in range(0, len(targets), MAX_BATCH_SIZE):
            if stop_event.is_set():
                return None
            chunk = targets[start : start + MAX_BATCH_SIZE]
            try:
                batch = _probe_batch(executable, family, chunk, count, timeout, stop_event)
            except (FpingError, OSError) as exc:
                measurements.errors.append(f"IPv{family} batch of {len(chunk)} targets: {exc}")
                continue
            if batch is None:
                return None
            results.update(batch)
    if stop_event.is_set():
        return None
    measurements.samples = {
        address: results[canonical]
        for address, canonical in aliases.items()
        if canonical in results
    }
    return measurements
