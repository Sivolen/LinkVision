import errno
import socket
import struct
import sys
import time
from collections import deque
from types import SimpleNamespace

import ping3
import pytest

from services import linux_icmp


@pytest.mark.unit
@pytest.mark.parametrize("ipv6", [False, True])
@pytest.mark.parametrize("raw", [False, True])
def test_linux_probe_receives_own_reply_amid_unrelated_traffic(monkeypatch, ipv6, raw):
    host = "2001:db8::1" if ipv6 else "192.0.2.1"
    other = "2001:db8::2" if ipv6 else "192.0.2.2"
    endpoint = (host, 0, 0, 0) if ipv6 else (host, 0)
    sequence = 42
    echo_type = 129 if ipv6 else 0
    unreachable_type = 1 if ipv6 else 3
    sock = SimpleNamespace(
        family=socket.AF_INET6 if ipv6 else socket.AF_INET,
        type=socket.SOCK_RAW if raw else socket.SOCK_DGRAM,
        peer=None,
        mask=None,
        packets=deque(),
        getsockname=lambda: ("localhost", 3210),
    )

    def enqueue(packet_type, sender, identifier):
        if sock.peer and sock.peer[0] != sender:
            return
        if sock.mask and sock.mask[packet_type // 32] & (1 << (packet_type % 32)):
            return
        header = b""
        if not ipv6 and raw:
            header = bytes.fromhex("450000240000000040010000c0000201c0000203")
        packet = struct.pack("!BBHHH", packet_type, 0, 0, identifier, sequence)
        sock.packets.append((header + packet + struct.pack("!d", time.time()), (sender, 0)))

    def send(sock, address, identifier, seq, size):
        assert address == host and seq == sequence
        identifier = identifier if raw else sock.getsockname()[1]
        enqueue(unreachable_type, other, 0)
        enqueue(echo_type, other, identifier)
        if raw:
            enqueue(unreachable_type, host, 0)
        enqueue(echo_type, host, identifier)

    class SocketContext:
        def __enter__(self):
            return sock

        def __exit__(self, *args):
            pass

        def __getattr__(self, key):
            return getattr(sock, key)

    def make_socket(family, kind, protocol):
        if raw and kind == socket.SOCK_DGRAM:
            raise PermissionError(errno.EACCES, "ping sockets disabled")
        assert kind == sock.type and family == sock.family
        return SocketContext()

    def set_filter(level, option, mask):
        assert level == (socket.IPPROTO_ICMPV6 if ipv6 else 255) and option == 1
        sock.mask = struct.unpack("=8I" if ipv6 else "=I", mask)

    sock.connect = lambda peer: setattr(sock, "peer", peer)
    sock.setsockopt = set_filter
    sock.recvfrom = lambda size: sock.packets.popleft()
    monkeypatch.setattr(
        linux_icmp,
        "socket",
        SimpleNamespace(
            **{
                **vars(socket),
                "socket": make_socket,
                "getaddrinfo": lambda host, port, family, kind: [
                    (family, kind, 0, "", endpoint)
                ],
            }
        ),
    )
    # Exercise ping3's actual receive loop. Reproduce Linux's IPv4 header
    # behaviour even when the application test suite runs on Windows.
    monkeypatch.setattr(ping3, "os", SimpleNamespace(name="posix"))
    monkeypatch.setattr(
        ping3,
        "select",
        SimpleNamespace(select=lambda reads, *args: (reads if sock.packets else [], [], [])),
    )
    monkeypatch.setattr(linux_icmp, "send_one_ping", send)

    assert isinstance(linux_icmp.ping(host, timeout=0.1, seq=sequence), float)
    assert not sock.packets


@pytest.mark.unit
@pytest.mark.skipif(sys.platform != "linux", reason="Requires Linux ICMP sockets")
def test_linux_probe_loopback():
    for kind in (socket.SOCK_DGRAM, socket.SOCK_RAW):
        try:
            with socket.socket(socket.AF_INET, kind, socket.IPPROTO_ICMP):
                break
        except OSError as exc:
            if exc.errno not in (errno.EACCES, errno.EPERM, errno.EPROTONOSUPPORT):
                raise
    else:
        pytest.skip("ICMP sockets unavailable")

    rtt = linux_icmp.ping("127.0.0.1", timeout=1, seq=1)

    assert isinstance(rtt, float) and 0 <= rtt < 1
