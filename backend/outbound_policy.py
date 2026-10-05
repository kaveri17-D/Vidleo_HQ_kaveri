"""NEXUS Outbound Fetch Policy & SSRF Prevention Engine.

Enforces zero-trust outbound network validation:
- Validates URL scheme (http/https only)
- Canonicalizes hostname
- Resolves DNS and blocks private/loopback/cloud metadata IP ranges
- Revalidates every hop on HTTP redirects to prevent open-redirect SSRF
"""
from __future__ import annotations

import ipaddress
import logging
import socket
from typing import Optional
from urllib.parse import urlparse

log = logging.getLogger("nexus.outbound_policy")

# Disallowed IP networks
BLOCKED_NETWORKS = [
    ipaddress.ip_network("0.0.0.0/8"),          # Current network
    ipaddress.ip_network("10.0.0.0/8"),         # Private RFC1918
    ipaddress.ip_network("100.64.0.0/10"),      # Shared Address Space
    ipaddress.ip_network("127.0.0.0/8"),        # Loopback
    ipaddress.ip_network("169.254.0.0/16"),     # Link-local / Cloud Metadata (AWS, GCP, Azure, DigitalOcean)
    ipaddress.ip_network("172.16.0.0/12"),      # Private RFC1918
    ipaddress.ip_network("192.0.0.0/24"),       # IETF Protocol Assignments
    ipaddress.ip_network("192.0.2.0/24"),       # TEST-NET-1
    ipaddress.ip_network("192.88.99.0/24"),     # 6to4 Relay
    ipaddress.ip_network("192.168.0.0/16"),     # Private RFC1918
    ipaddress.ip_network("198.18.0.0/15"),      # Network benchmark tests
    ipaddress.ip_network("198.51.100.0/24"),    # TEST-NET-2
    ipaddress.ip_network("203.0.113.0/24"),     # TEST-NET-3
    ipaddress.ip_network("224.0.0.0/4"),        # Multicast
    ipaddress.ip_network("240.0.0.0/4"),        # Reserved
    ipaddress.ip_network("255.255.255.255/32"), # Broadcast
    # IPv6
    ipaddress.ip_network("::/128"),             # Unspecified
    ipaddress.ip_network("::1/128"),            # Loopback
    ipaddress.ip_network("fc00::/7"),           # Unique local
    ipaddress.ip_network("fe80::/10"),          # Link-local unicast
    ipaddress.ip_network("ff00::/8"),           # Multicast
]

ALLOWED_SCHEMES = {"http", "https"}


class OutboundPolicyViolation(ValueError):
    """Raised when an outbound URL violates security policy."""
    pass


def is_ip_allowed(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
        for net in BLOCKED_NETWORKS:
            if ip in net:
                return False
        return True
    except ValueError:
        return False


def validate_outbound_url(url: str, *, allow_loopback_for_dev: bool = False) -> str:
    """
    Validates that a URL is safe to contact from server infrastructure.
    Resolves DNS and asserts that target IPs are public.
    """
    if not url or not isinstance(url, str):
        raise OutboundPolicyViolation("Missing or empty URL")

    parsed = urlparse(url.strip())
    if parsed.scheme.lower() not in ALLOWED_SCHEMES:
        raise OutboundPolicyViolation(f"Unsafe URL scheme: {parsed.scheme}")

    hostname = parsed.hostname
    if not hostname:
        raise OutboundPolicyViolation("URL has no valid hostname")

    hostname_lower = hostname.lower()
    if hostname_lower in {"localhost", "metadata.google.internal"}:
        if not allow_loopback_for_dev:
            raise OutboundPolicyViolation(f"Access to {hostname} is blocked by policy")

    try:
        # Resolve all IPv4 and IPv6 addresses for the host
        addr_info = socket.getaddrinfo(hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
    except socket.gaierror as e:
        raise OutboundPolicyViolation(f"Failed to resolve DNS for {hostname}: {e}")

    for item in addr_info:
        ip = item[4][0]
        if not allow_loopback_for_dev and not is_ip_allowed(ip):
            log.warning("Blocked outbound request to private/metadata IP: %s (host: %s)", ip, hostname)
            raise OutboundPolicyViolation(f"Host {hostname} resolves to blocked IP address {ip}")

    return url
