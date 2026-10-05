"""NEXUS Ticket Service — Short-Lived Signed Ticket Issuance & Validation.

Every media operation requiring a controlled relay or verified direct access uses
cryptographically signed, short-lived, single-purpose tickets.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import time
import uuid
from typing import Any, Optional
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).parent / ".env", override=False)

DEFAULT_SECRET = "nexus-fallback-ticket-secret-key-change-in-prod"


def _get_ticket_secret() -> bytes:
    return os.environ.get("SIGNED_DOWNLOAD_SECRET", DEFAULT_SECRET).encode("utf-8")


DEFAULT_TICKET_TTL_SECONDS = 900  # 15 minutes


class TicketError(ValueError):
    """Raised when a ticket is missing, forged, or expired."""
    pass


def issue_signed_ticket(
    *,
    job_id: str,
    user_id: Optional[str] = None,
    resource_id: str,
    allowed_host: str,
    target_url: Optional[str] = None,
    max_bytes: int = 2147483648, # 2GB default
    max_requests: int = 500,
    ttl_seconds: int = DEFAULT_TICKET_TTL_SECONDS,
    allowed_method: str = "GET",
    resource_type: str = "range"
) -> str:
    now = int(time.time())
    payload = {
        "jti": str(uuid.uuid4()),
        "sub": user_id or "anon",
        "job": job_id,
        "res": resource_id,
        "hst": allowed_host,
        "mth": allowed_method,
        "byt": max_bytes,
        "req": max_requests,
        "iat": now,
        "exp": now + ttl_seconds,
        "typ": resource_type,
        "v": 1
    }
    if target_url:
        payload["u_hash"] = hashlib.sha256(target_url.encode("utf-8")).hexdigest()

    raw_json = json.dumps(payload, separators=(',', ':'), sort_keys=True).encode("utf-8")
    b64_payload = base64.urlsafe_b64encode(raw_json).decode("utf-8").rstrip("=")
    signature = hmac.new(_get_ticket_secret(), b64_payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{b64_payload}.{signature}"


def verify_signed_ticket(
    ticket: str,
    target_url: Optional[str] = None,
    expected_resource_type: Optional[str] = None
) -> dict[str, Any]:
    if not ticket or "." not in ticket:
        raise TicketError("Invalid ticket format")

    parts = ticket.split(".")
    if len(parts) != 2:
        raise TicketError("Invalid ticket structure")

    b64_payload, signature = parts[0], parts[1]
    expected_sig = hmac.new(_get_ticket_secret(), b64_payload.encode("utf-8"), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(signature, expected_sig):
        raise TicketError("Ticket signature verification failed")

    # Pad base64 string
    padded_b64 = b64_payload + "=" * ((4 - len(b64_payload) % 4) % 4)
    try:
        raw_bytes = base64.urlsafe_b64decode(padded_b64.encode("utf-8"))
        payload = json.loads(raw_bytes.decode("utf-8"))
    except Exception as exc:
        raise TicketError(f"Corrupt ticket payload: {exc}")

    now = int(time.time())
    if payload.get("exp", 0) < now:
        raise TicketError("Ticket has expired")

    if target_url and payload.get("u_hash"):
        target_hash = hashlib.sha256(target_url.encode("utf-8")).hexdigest()
        if payload["u_hash"] != target_hash:
            raise TicketError("Target URL does not match ticket binding (u_hash mismatch)")

    if expected_resource_type:
        ticket_typ = payload.get("typ", "range")
        if ticket_typ != expected_resource_type:
            raise TicketError(
                f"Resource type mismatch: ticket is authorized for '{ticket_typ}', requested '{expected_resource_type}'"
            )

    return payload
