import subprocess
import sys
import shutil
from threading import Event

import pytest

from services import fping_probe, monitor


def test_batch_reads_fping_output_and_deduplicates_targets(monkeypatch):
    popen = subprocess.Popen
    commands = []

    class PatchedTimeoutExpired(Exception):
        pass

    def patched_communicate(timeout=None):
        if timeout is not None:
            raise PatchedTimeoutExpired
        return None, None

    def launch(command, **kwargs):
        commands.append(command)
        script = (
            "import sys, time; time.sleep(0.65);"
            " print('10.255.100.202 : 0.180 0.197 0.221 0.195"
            " 0.110 0.182 0.199 0.187\\n192.0.2.1 : - - - - - - - -',"
            " file=sys.stderr); sys.exit(1)"
        )
        process = popen([sys.executable, "-c", script], **kwargs)
        # Simulate the exception identity mismatch seen under Eventlet.
        process.communicate = patched_communicate
        return process

    monkeypatch.setattr(fping_probe.subprocess, "Popen", launch)
    results = fping_probe.probe_addresses(
        "fping",
        ["10.255.100.202", "192.0.2.1", "10.255.100.202"],
        8,
        1,
        Event(),
    )

    assert commands[0][-2:] == ["10.255.100.202", "192.0.2.1"]
    assert len(commands) == 1
    assert results.samples == {
        "10.255.100.202": ([0.180, 0.197, 0.221, 0.195, 0.110, 0.182, 0.199, 0.187], 8),
        "192.0.2.1": ([], 8),
    }
    assert not results.errors


@pytest.mark.parametrize("scenario", ["partial", "failed", "unchanged"])
def test_monitor_consumes_batch_or_preserves_state_on_failure(
    app, map_ids, monkeypatch, scenario
):
    from models import Device, DeviceIP, db

    with app.app_context():
        device = Device(
            map_id=map_ids["Own Map"],
            name="probe target",
            status="up",
            quality_status="good",
            quality_latency_ms=88,
            ips=[DeviceIP(ip_address="192.0.2.1"), DeviceIP(ip_address="2001:db8::1")],
        )
        db.session.add(device)
        db.session.commit()
        device_id = device.id

    with app.app_context():
        other = Device(
            map_id=map_ids["Own Map"],
            name="independent target",
            status="down",
            ips=[DeviceIP(ip_address="192.0.2.2")],
        )
        db.session.add(other)
        db.session.commit()
        other_id = other.id

    stop = Event()
    completed = []

    def probe(path, addresses, count, timeout, stop_event):
        assert set(addresses) == {"192.0.2.1", "2001:db8::1", "192.0.2.2"}
        samples = {"192.0.2.1": ([0.18] * count, count), "192.0.2.2": ([0.2] * count, count)}
        if scenario == "failed":
            return fping_probe.BatchMeasurements(samples, ["incomplete IPv6 batch"], 3)
        ipv6_rtts = [0.18] * count if scenario == "unchanged" else []
        samples["2001:db8::1"] = (ipv6_rtts, count)
        return fping_probe.BatchMeasurements(samples, target_count=3)

    def finish(elapsed, interval, successful, stats):
        completed.append(successful)
        assert stats["backend"] == "fping"
        assert stats["targets"] == 3
        stop.set()

    monkeypatch.setattr(monitor, "_find_fping", lambda: "fping")
    monkeypatch.setattr(monitor, "probe_addresses", probe)
    monkeypatch.setattr(monitor, "app_instance", app)
    monkeypatch.setattr(monitor, "_executor", object())
    monkeypatch.setattr(monitor, "_monitor_stop_event", stop)
    monkeypatch.setattr(monitor, "_monitor_stop_flag", False)
    monkeypatch.setattr(monitor, "_quality_windows", {})
    monkeypatch.setattr(monitor, "_quality_last_persist", {})
    monkeypatch.setattr(monitor, "_last_history_cleanup", 0)
    monkeypatch.setattr(monitor, "_record_monitor_health", finish)

    monitor.monitor_loop()

    assert completed == [scenario != "failed"]
    with app.app_context():
        assert db.session.get(Device, other_id).status == "up"
        device = db.session.get(Device, device_id)
        assert device.status == ("partial" if scenario == "partial" else "up")
        assert device.quality_latency_ms == (
            88 if scenario == "failed" else pytest.approx(0.18)
        )
        assert (
            device.quality_loss_percent
            == {"failed": None, "partial": 50, "unchanged": 0}[scenario]
        )


def test_failed_batch_and_invalid_target_do_not_block_other_batches(monkeypatch):
    def measure(executable, family, addresses, count, timeout, stop):
        if addresses == ["192.0.2.2"]:
            return fping_probe._parse_results("", addresses, count)
        return {addresses[0]: ([0.2], count)}

    monkeypatch.setattr(fping_probe, "MAX_BATCH_SIZE", 1)
    monkeypatch.setattr(fping_probe, "_probe_batch", measure)
    results = fping_probe.probe_addresses(
        "fping", ["192.0.2.1", "invalid", "192.0.2.2", "::1"], 1, 1, Event()
    )
    assert results.samples == {"192.0.2.1": ([0.2], 1), "::1": ([0.2], 1)}
    assert len(results.errors) == 2
    assert results.target_count == 3


@pytest.mark.parametrize("stop", [True, False])
def test_batch_reaps_child_on_stop_or_deadline(monkeypatch, stop):
    popen = subprocess.Popen
    children = []

    def launch(command, **kwargs):
        child = popen([sys.executable, "-c", "import time; time.sleep(30)"], **kwargs)
        children.append(child)
        return child

    event = Event()
    monkeypatch.setattr(fping_probe.subprocess, "Popen", launch)
    if stop:
        event.set()
        assert fping_probe._probe_batch("fping", 4, ["127.0.0.1"], 1, 1, event) is None
    else:
        from types import SimpleNamespace

        clock = iter([0, 100])
        monkeypatch.setattr(fping_probe, "time", SimpleNamespace(monotonic=lambda: next(clock)))
        with pytest.raises(fping_probe.FpingError, match="batch deadline"):
            fping_probe._probe_batch("fping", 4, ["127.0.0.1"], 1, 1, event)
    assert children[0].returncode is not None


@pytest.mark.skipif(sys.platform != "linux", reason="Requires Linux fping")
def test_real_fping_under_eventlet():
    executable = shutil.which("fping")
    if not executable:
        pytest.skip("fping is not installed")
    subprocess.run(
        [sys.executable, "-c", """
import eventlet
eventlet.monkey_patch()
from threading import Event
from services.fping_probe import probe_addresses
import sys
result = probe_addresses(sys.argv[1], ["127.0.0.1"], 2, 1, Event())
assert not result.errors, result.errors
assert len(result.samples["127.0.0.1"][0]) == 2, result.samples
""", executable],
        check=True,
        timeout=15,
    )
