"""Read ICMP round-trip times from the Windows IP Helper API."""

import ctypes as ct
from functools import lru_cache
import math
import socket
import sys


class WindowsIcmpError(RuntimeError):
    """The local ICMP API could not perform a measurement."""


class _SocketAddressV6(ct.Structure):
    _fields_ = [
        ("family", ct.c_uint16),
        ("port", ct.c_uint16),
        ("flowinfo", ct.c_uint32),
        ("address", ct.c_ubyte * 16),
        ("scope_id", ct.c_uint32),
    ]


class _EchoReplyV4(ct.Structure):
    # Only the fixed prefix of ICMP_ECHO_REPLY is needed.
    _fields_ = [
        ("address", ct.c_uint32),
        ("status", ct.c_uint32),
        ("rtt_ms", ct.c_uint32),
    ]


class _ReplyAddressV6(ct.Structure):
    # IPV6_ADDRESS_EX is packed and omits sockaddr_in6's family field.
    _pack_ = 1
    _fields_ = [
        ("port", ct.c_uint16),
        ("flowinfo", ct.c_uint32),
        ("address", ct.c_ubyte * 16),
        ("scope_id", ct.c_uint32),
    ]


class _EchoReplyV6(ct.Structure):
    _fields_ = [
        ("address", _ReplyAddressV6),
        ("status", ct.c_uint32),
        ("rtt_ms", ct.c_uint32),
    ]


_NO_REPLY_CODES = {
    11002,
    11003,
    11004,
    11005,
    11010,
    11012,
    11013,
    11014,
    11018,
    1231,
    1232,
}
_INVALID_HANDLE = ct.c_void_p(-1).value
_PAYLOAD = bytes(56)


@lru_cache(maxsize=1)
def _load_api():
    api = ct.WinDLL("iphlpapi.dll", use_last_error=True)
    ptr = ct.c_void_p
    uint = ct.c_uint32
    api.IcmpCreateFile.argtypes = api.Icmp6CreateFile.argtypes = []
    api.IcmpCreateFile.restype = api.Icmp6CreateFile.restype = ptr
    api.IcmpCloseHandle.argtypes = [ptr]
    api.IcmpCloseHandle.restype = ct.c_int
    api.IcmpSendEcho.argtypes = [ptr, uint, ptr, ct.c_uint16, ptr, ptr, uint, uint]
    api.IcmpSendEcho.restype = uint
    api.Icmp6SendEcho2.argtypes = [
        ptr,
        ptr,
        ptr,
        ptr,
        ptr,
        ptr,
        ptr,
        ct.c_uint16,
        ptr,
        ptr,
        uint,
        uint,
    ]
    api.Icmp6SendEcho2.restype = uint
    return api


def _ipv6_address(host):
    address, _, _, scope_id = socket.getaddrinfo(
        host,
        0,
        socket.AF_INET6,
        socket.SOCK_DGRAM,
    )[0][4]
    return _SocketAddressV6(
        family=socket.AF_INET6,
        address=(ct.c_ubyte * 16).from_buffer_copy(
            socket.inet_pton(socket.AF_INET6, address)
        ),
        scope_id=scope_id,
    )


def ping(host, timeout, seq):
    """Return RTT in seconds, or None when the destination did not reply."""
    # The OS correlates each response with its own request.
    ipv6 = ":" in host
    try:
        destination = (
            _ipv6_address(host)
            if ipv6
            else int.from_bytes(
                socket.inet_aton(socket.gethostbyname(host)), sys.byteorder
            )
        )
    except socket.gaierror:
        return None

    try:
        api = _load_api()
    except (AttributeError, OSError) as exc:
        raise WindowsIcmpError("Could not load the Windows ICMP API") from exc
    handle = api.Icmp6CreateFile() if ipv6 else api.IcmpCreateFile()
    if handle in (None, _INVALID_HANDLE):
        raise WindowsIcmpError(
            f"Could not create ICMP handle (Windows error {ct.get_last_error()})"
        )

    try:
        payload = ct.create_string_buffer(_PAYLOAD)
        buffer = ct.create_string_buffer(256)
        timeout_ms = max(1, math.ceil(timeout * 1000))
        options = (payload, len(_PAYLOAD), None, buffer, ct.sizeof(buffer), timeout_ms)
        if ipv6:
            source = _SocketAddressV6(family=socket.AF_INET6)
            count = api.Icmp6SendEcho2(
                handle,
                None,
                None,
                None,
                ct.byref(source),
                ct.byref(destination),
                *options,
            )
            reply_type = _EchoReplyV6
        else:
            count = api.IcmpSendEcho(handle, destination, *options)
            reply_type = _EchoReplyV4

        if count:
            reply = reply_type.from_buffer_copy(buffer)
            if reply.status == 0:
                return reply.rtt_ms / 1000
            status = reply.status
        else:
            status = ct.get_last_error()
        if status in _NO_REPLY_CODES:
            return None
        raise WindowsIcmpError(f"ICMP request failed (Windows status {status})")
    finally:
        api.IcmpCloseHandle(handle)
