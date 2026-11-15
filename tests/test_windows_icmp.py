from types import SimpleNamespace
import socket
import struct

import pytest

from services import windows_icmp


@pytest.mark.parametrize("status", [0, 11010, 11050])
def test_windows_probe_distinguishes_zero_rtt_timeout_and_local_error(
    monkeypatch, status
):
    closed = []

    def send(handle, destination, payload, size, options, buffer, capacity, timeout):
        if status:
            return 0
        reply = windows_icmp._EchoReplyV4.from_buffer(buffer)
        reply.status = 0
        reply.rtt_ms = 0
        return 1

    api = SimpleNamespace(
        IcmpCreateFile=lambda: 1, IcmpSendEcho=send, IcmpCloseHandle=closed.append
    )
    monkeypatch.setattr(windows_icmp, "_load_api", lambda: api)
    monkeypatch.setattr(
        windows_icmp.ct, "get_last_error", lambda: status, raising=False
    )

    if status == 11050:
        with pytest.raises(windows_icmp.WindowsIcmpError):
            windows_icmp.ping("127.0.0.1", timeout=1, seq=0)
    elif status == 11010:
        assert windows_icmp.ping("127.0.0.1", timeout=1, seq=0) is None
    else:
        assert windows_icmp.ping("127.0.0.1", timeout=1, seq=0) == 0.0
    assert closed == [1]


def test_windows_ipv6_uses_native_round_trip_time(monkeypatch):
    closed = []

    def send(handle, event, callback, context, source, dest, payload, size,
             options, buffer, capacity, timeout):
        assert handle == 2 and timeout == 500
        assert source._obj.family == socket.AF_INET6
        assert bytes(dest._obj.address) == socket.inet_pton(socket.AF_INET6, "::1")
        # ICMPV6_ECHO_REPLY: 28-byte address followed by status and RTT.
        struct.pack_into("<II", buffer, 28, 0, 17)
        return 1

    api = SimpleNamespace(
        Icmp6CreateFile=lambda: 2, Icmp6SendEcho2=send, IcmpCloseHandle=closed.append
    )
    monkeypatch.setattr(windows_icmp, "_load_api", lambda: api)
    assert windows_icmp.ping("::1", timeout=0.5, seq=0) == 0.017
    assert closed == [2]
