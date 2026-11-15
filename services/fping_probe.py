"""Batch ICMP probes using the Linux fping utility."""

import ipaddress
import math
import os
import subprocess
import time

SEND_INTERVAL_MS = 10
MAX_BATCH_SIZE = 256


class FpingError(RuntimeError):
    """The probe did not produce a complete measurement."""


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
    with subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        env={**os.environ, "LC_ALL": "C"},
    ) as process:
        try:
            while True:
                if stop_event.is_set():
                    return None
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise FpingError("fping exceeded its batch deadline")
                try:
                    output, _ = process.communicate(timeout=min(0.5, remaining))
                    break
                except subprocess.TimeoutExpired:
                    continue
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()

    # Exit code 1 is a normal result when one or more targets are down.
    if process.returncode not in (0, 1):
        diagnostic = "\n".join(output.splitlines()[:3])[:300]
        raise FpingError(f"fping exited with code {process.returncode}: {diagnostic}")
    return _parse_results(output, targets, count)


def probe_addresses(executable, addresses, count, timeout, stop_event):
    """Return per-address (successful RTTs in ms, sent count), or None on stop."""
    families = {4: {}, 6: {}}
    aliases = {}
    for address in addresses:
        ip = ipaddress.ip_address(address)
        canonical = str(ip)
        families[ip.version][canonical] = None
        aliases[address] = canonical

    results = {}
    for family, unique in families.items():
        targets = list(unique)
        for start in range(0, len(targets), MAX_BATCH_SIZE):
            if stop_event.is_set():
                return None
            batch = _probe_batch(
                executable,
                family,
                targets[start : start + MAX_BATCH_SIZE],
                count,
                timeout,
                stop_event,
            )
            if batch is None:
                return None
            results.update(batch)
    return {address: results[canonical] for address, canonical in aliases.items()}
