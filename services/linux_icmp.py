"""Isolate Linux ICMP replies before ping3 reads and times them."""

import errno
import ipaddress
import os
import socket
import struct

from ping3 import errors, receive_one_ping, send_one_ping


def _filter_raw_socket(sock, ipv6):
    # Linux UAPI: SOL_RAW=255, ICMP_FILTER=1, ICMPV6_FILTER=1.
    # These masks block messages with the corresponding bit set.
    if ipv6:
        mask = [0xFFFFFFFF] * 8
        mask[129 // 32] ^= 1 << (129 % 32)  # ICMPv6 Echo Reply
        sock.setsockopt(socket.IPPROTO_ICMPV6, 1, struct.pack("=8I", *mask))
    else:
        sock.setsockopt(255, 1, struct.pack("=I", 0xFFFFFFFE))  # ICMP Echo Reply (0)


def ping(host, timeout, seq):
    try:
        ipv6 = ipaddress.ip_address(host).version == 6
    except ValueError:
        ipv6 = False  # Preserve ping3's IPv4 hostname resolution.
    family = socket.AF_INET6 if ipv6 else socket.AF_INET
    protocol = socket.IPPROTO_ICMPV6 if ipv6 else socket.IPPROTO_ICMP

    # Linux ping sockets have a kernel-assigned identifier per socket. They
    # avoid delivering every host's replies to each concurrent probe.
    try:
        sock = socket.socket(family, socket.SOCK_DGRAM, protocol)
    except OSError as exc:
        if exc.errno not in (errno.EACCES, errno.EPERM, errno.EPROTONOSUPPORT):
            raise
        sock = socket.socket(family, socket.SOCK_RAW, protocol)

    try:
        with sock:
            # Use getaddrinfo only to resolve the address. Some resolvers reject
            # SOCK_DGRAM + IPPROTO_ICMP as a service/protocol combination.
            endpoint = socket.getaddrinfo(host, None, family, socket.SOCK_DGRAM)[0][4]
            if sock.type == socket.SOCK_RAW:
                _filter_raw_socket(sock, ipv6)
            sock.connect(endpoint)
            identifier = (os.getpid() & 0xFFFF) or 1
            address = endpoint[0]
            if ipv6 and endpoint[3]:
                address = f"{address}%{endpoint[3]}"
            send_one_ping(sock, address, identifier, seq, 56)
            return receive_one_ping(sock, identifier, seq, timeout)
    except errors.Timeout:
        return None
    except (errors.PingError, socket.gaierror):
        return False
