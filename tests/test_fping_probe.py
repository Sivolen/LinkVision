import subprocess
import sys
from threading import Event

import pytest

from services import fping_probe, monitor


def test_batch_reads_fping_output_and_deduplicates_targets(monkeypatch):
    popen = subprocess.Popen
    commands = []

    def launch(command, **kwargs):
        commands.append(command)
        script = (
            "import sys; print('10.255.100.202 : 0.180 0.197 0.221 0.195"
            " 0.110 0.182 0.199 0.187\\n192.0.2.1 : - - - - - - - -',"
            " file=sys.stderr); sys.exit(1)"
        )
        return popen([sys.executable, "-c", script], **kwargs)

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
    assert results == {
        "10.255.100.202": ([0.180, 0.197, 0.221, 0.195, 0.110, 0.182, 0.199, 0.187], 8),
        "192.0.2.1": ([], 8),
    }


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

    stop = Event()
    completed = []

    def probe(path, addresses, count, timeout, stop_event):
        assert set(addresses) == {"192.0.2.1", "2001:db8::1"}
        if scenario == "failed":
            # Simulate a process that returned a row for only one address.
            return fping_probe._parse_results(
                "192.0.2.1 : " + " ".join(["-"] * count),
                ["192.0.2.1", "2001:db8::1"],
                count,
            )
        ipv6_rtts = [0.18] * count if scenario == "unchanged" else []
        return {"192.0.2.1": ([0.18] * count, count), "2001:db8::1": (ipv6_rtts, count)}

    def finish(elapsed, interval, successful):
        completed.append(successful)
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
        device = db.session.get(Device, device_id)
        assert device.status == ("partial" if scenario == "partial" else "up")
        assert device.quality_latency_ms == (
            88 if scenario == "failed" else pytest.approx(0.18)
        )
        assert (
            device.quality_loss_percent
            == {"failed": None, "partial": 50, "unchanged": 0}[scenario]
        )
