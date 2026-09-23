"""
Security module for Nexus Media Extractor
==========================================
Handles:
  - Admin exemption (localhost + secret header)
  - Unkey.dev API key verification (optional — only when UNKEY_API_ID is set)

DEV MODE: If UNKEY_API_ID is not configured, ALL requests are allowed through.
PROD MODE: If UNKEY_API_ID is set, every non-admin request must provide a Bearer token.
"""

import os
import secrets
import logging

import httpx
from fastapi import Request, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

log = logging.getLogger("media-extractor.security")

security_scheme = HTTPBearer(auto_error=False)

# Reuse a single async HTTPX client for Unkey verification (connection pool efficiency)
unkey_client = httpx.AsyncClient(
    base_url="https://api.unkey.dev/v1",
    timeout=5.0
)


def is_admin_exempt(request: Request) -> bool:
    """
    Return True if the request should bypass Unkey verification.
    Two exemption paths:
      1. Localhost — any request from 127.0.0.1 or ::1 (dev server)
      2. Admin Header — X-Nexus-Admin matches ADMIN_SECRET_KEY
    """
    host = request.client.host if request.client else ""

    # Localhost / loopback exemption (covers both IPv4 and IPv6)
    if host in ("127.0.0.1", "::1", "localhost"):
        return True

    # Secret header exemption (for server-to-server admin calls)
    admin_secret = os.environ.get("ADMIN_SECRET_KEY", "").strip()
    if admin_secret:
        header_val = request.headers.get("X-Nexus-Admin", "")
        # Constant-time comparison to prevent timing attacks
        if secrets.compare_digest(header_val, admin_secret):
            return True

    return False


async def verify_unkey_token(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Security(security_scheme),
) -> dict:
    """
    FastAPI dependency for Unkey-based API key verification.

    Behavior:
      - Admin-exempt requests pass through immediately.
      - If UNKEY_API_ID is not set → DEV MODE: all requests are allowed.
      - If UNKEY_API_ID is set → PROD MODE: Bearer token is required and validated.
    """

    # ── 1. Admin / localhost exemption ──────────────────────────────────────
    if is_admin_exempt(request):
        log.debug("Request exempt (admin/localhost): %s", request.client.host if request.client else "unknown")
        return {"admin": True, "valid": True}

    # ── 2. Dev mode — Unkey not configured, allow all ───────────────────────
    api_id = os.environ.get("UNKEY_API_ID", "").strip()
    if not api_id:
        log.debug("DEV MODE: UNKEY_API_ID not set — skipping token validation.")
        return {"dev": True, "valid": True}

    # ── 3. Production — Bearer token required ───────────────────────────────
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=401,
            detail="Missing Authorization header. Expected: Bearer <API_KEY>",
        )

    key = credentials.credentials

    # ── 4. Verify key against Unkey.dev ─────────────────────────────────────
    try:
        response = await unkey_client.post(
            "/keys.verify",
            json={"apiId": api_id, "key": key},
        )
        response.raise_for_status()
        data = response.json()
    except httpx.RequestError as exc:
        log.error("Unkey service unreachable: %s", exc)
        raise HTTPException(
            status_code=503,
            detail="Key verification service is temporarily unavailable. Please try again.",
        )
    except httpx.HTTPStatusError as exc:
        log.error("Unkey returned HTTP error: %s", exc)
        raise HTTPException(status_code=500, detail="Error communicating with key verification service.")

    # ── 5. Handle rejection codes ────────────────────────────────────────────
    if not data.get("valid", False):
        code = data.get("code", "UNKNOWN")
        if code == "RATE_LIMITED":
            raise HTTPException(
                status_code=429,
                detail="API quota exceeded for this key. Please upgrade your Nexus plan.",
            )
        # Revoked, expired, or invalid key
        raise HTTPException(status_code=401, detail=f"Invalid or revoked API key (code: {code}).")

    return data
