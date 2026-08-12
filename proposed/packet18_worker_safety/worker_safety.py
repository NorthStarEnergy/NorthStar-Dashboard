"""Worker capability tokens and phone-verification throttling — Packet 18 §18.1.

STATUS AS OF 2026-08-12: written, reviewed by its own author, NOT executed by
anyone, and NOT imported by ieso_backend.py, northstar_store.py, or any other
live file. Nothing in the running system calls this module. It is deliberately
kept outside tests/ so it is not picked up by `python -m pytest tests -q` and
cannot silently affect that suite's baseline.

Before this goes anywhere near the live request path, in order:

  1. Someone with a working shell runs
     `python -m pytest proposed/packet18_worker_safety -q`
     and confirms it actually passes. Nobody has done that yet — the tests
     were written carefully and traced by hand, not executed.
  2. Decide where NORTHSTAR_WORKER_TOKEN_SECRET is provisioned in production
     (this is a new, separate secret from NORTHSTAR_QR_SECRET, on purpose —
     see _secret()'s docstring). That's part of decision D-1 in
     docs/architecture/DECISION_LOG.md, an owner decision, not this module's
     to make.
  3. Wire it into ieso_backend.py: issue a token when POST /api/checkins
     creates a record, require it on the worker's own GET/heartbeat/
     checkout/help routes, and add the wrong-record / expired-token
     regression tests Packet 18's acceptance criterion asks for — in
     tests/, alongside the existing security regression tests, at that
     point.
  4. Tune PhoneVerificationThrottle's default limits with whoever owns the
     SMS budget; the numbers below are conservative placeholders, not a
     researched decision.

This mirrors the signed-token pattern already in northstar_phase1.py
(versioned JSON payload, HMAC-SHA256, base64url, constant-time compare) on
purpose, so adopting it is a small, familiar change rather than a new
pattern for someone to review from scratch.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from dataclasses import dataclass
from threading import Lock

# ---------------------------------------------------------------------------
# Worker capability tokens
# ---------------------------------------------------------------------------

TOKEN_PREFIX = "wct1"
DEFAULT_TOKEN_TTL_SECONDS = 12 * 60 * 60  # 12 hours: long enough to cover one shift

# A per-process fallback so importing this module never raises just because
# NORTHSTAR_WORKER_TOKEN_SECRET isn't set (e.g. in a test run). A real
# deployment MUST set the environment variable — a fallback that changes on
# every restart would invalidate every outstanding token on every restart,
# which is a real deployment sitting behind a Windows service that does
# restart. This is a footgun warning, not a recommendation to use the
# fallback in production.
_PROCESS_FALLBACK_SECRET = secrets.token_bytes(32)


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _secret() -> bytes:
    """The signing secret for worker capability tokens.

    Deliberately a *different* environment variable than the existing
    NORTHSTAR_QR_SECRET, so a QR-secret compromise and a worker-token-secret
    compromise are independent events — compromising one placard shouldn't
    hand over every worker's session capability, or vice versa.
    """
    configured = os.environ.get("NORTHSTAR_WORKER_TOKEN_SECRET", "").strip()
    if configured:
        return configured.encode("utf-8")
    return _PROCESS_FALLBACK_SECRET


class TokenError(Exception):
    """Raised only for programmer-error inputs (empty checkin_id, non-positive
    ttl). Verification failures are NOT exceptions — they return None, on
    purpose, so a caller can't accidentally leak which check failed to a
    worker's device by forwarding an exception message.
    """


def issue_worker_capability_token(
    checkin_id: str,
    ttl_seconds: int = DEFAULT_TOKEN_TTL_SECONDS,
    *,
    now: float | None = None,
) -> str:
    """Issue a short-lived token bound to exactly one check-in record.

    The token is meant to authorize only the worker-device routes for THIS
    checkin_id (GET status, heartbeat, checkout, raising help) — never an
    operator route. Operator routes stay behind the existing Cloudflare
    Access gate in ieso_backend.py and are entirely out of scope here.
    """
    checkin_id = str(checkin_id or "").strip()
    if not checkin_id:
        raise TokenError("checkin_id is required")
    if ttl_seconds <= 0:
        raise TokenError("ttl_seconds must be positive")
    issued_at = int(now if now is not None else time.time())
    payload = {
        "v": 1,
        "cid": checkin_id,
        "iat": issued_at,
        "exp": issued_at + int(ttl_seconds),
        "jti": secrets.token_hex(8),
    }
    encoded = _b64(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = _b64(hmac.new(_secret(), encoded.encode("ascii"), hashlib.sha256).digest())
    return f"{TOKEN_PREFIX}.{encoded}.{signature}"


@dataclass(frozen=True)
class VerifiedToken:
    checkin_id: str
    issued_at: int
    expires_at: int
    token_id: str


def verify_worker_capability_token(
    token: str,
    expected_checkin_id: str,
    *,
    now: float | None = None,
) -> VerifiedToken | None:
    """Return the verified payload, or None if the token does not currently
    authorize `expected_checkin_id`.

    None covers every rejection reason on purpose — malformed, wrong
    signature, wrong record, expired all look the same to the caller. Log
    the reason server-side if you need it for an audit trail; do not return
    it to the device, so a guesser can't use the error message to learn
    which part of their forged token was wrong.
    """
    text = str(token or "").strip()
    expected_checkin_id = str(expected_checkin_id or "").strip()
    if not text or not expected_checkin_id:
        return None
    parts = text.split(".", 2)
    if len(parts) != 3:
        return None
    prefix, encoded, signature = parts
    if prefix != TOKEN_PREFIX:
        return None
    expected_signature = _b64(hmac.new(_secret(), encoded.encode("ascii"), hashlib.sha256).digest())
    if not hmac.compare_digest(signature, expected_signature):
        return None
    try:
        payload = json.loads(_unb64(encoded).decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or payload.get("v") != 1:
        return None
    if payload.get("cid") != expected_checkin_id:
        return None
    current_time = now if now is not None else time.time()
    expires_at = payload.get("exp")
    if not isinstance(expires_at, (int, float)) or current_time >= expires_at:
        return None
    issued_at = payload.get("iat")
    token_id = payload.get("jti")
    if not isinstance(issued_at, (int, float)) or not isinstance(token_id, str) or not token_id:
        return None
    return VerifiedToken(
        checkin_id=payload["cid"],
        issued_at=int(issued_at),
        expires_at=int(expires_at),
        token_id=token_id,
    )


# ---------------------------------------------------------------------------
# Phone-verification request throttling
# ---------------------------------------------------------------------------

@dataclass
class ThrottleDecision:
    allowed: bool
    retry_after_seconds: float = 0.0
    reason: str = ""


class SlidingWindowThrottle:
    """In-memory, single-process, fixed-key sliding-window limiter.

    In-memory and per-process is a deliberate, stated limitation, not an
    oversight: ieso_backend.py runs as a single Python process today
    (ADR-013-python-standard-library-single-process.md). A single shared
    dict is consistent with that, not a shortcut around it. If the backend
    ever becomes multi-process, this needs a shared store (e.g. the SQLite
    database itself, or something external) instead — flagging that here is
    cheaper than a rate limiter that silently stops working under load.
    """

    def __init__(self, *, limit: int, window_seconds: float):
        if limit <= 0:
            raise ValueError("limit must be positive")
        if window_seconds <= 0:
            raise ValueError("window_seconds must be positive")
        self.limit = limit
        self.window_seconds = window_seconds
        self._hits: dict[str, list[float]] = {}
        self._lock = Lock()

    def check(self, key: str, *, now: float | None = None) -> ThrottleDecision:
        current_time = now if now is not None else time.time()
        cutoff = current_time - self.window_seconds
        with self._lock:
            hits = [t for t in self._hits.get(key, []) if t > cutoff]
            if len(hits) >= self.limit:
                oldest = min(hits)
                retry_after = max(0.0, (oldest + self.window_seconds) - current_time)
                self._hits[key] = hits
                return ThrottleDecision(
                    allowed=False,
                    retry_after_seconds=retry_after,
                    reason=f"{len(hits)}/{self.limit} requests in the last {self.window_seconds:g}s",
                )
            hits.append(current_time)
            self._hits[key] = hits
            return ThrottleDecision(allowed=True)

    def reset(self, key: str | None = None) -> None:
        """Test/ops helper. Never called by this module itself."""
        with self._lock:
            if key is None:
                self._hits.clear()
            else:
                self._hits.pop(key, None)


def normalize_phone(raw: str) -> str:
    """Digits only. Not a validator — a real phone-format check still needs
    to happen elsewhere. This only makes different spellings of the same
    number ("+1 (705) 555-0100" vs "7055550100") hash to the same
    throttle key, so someone can't dodge the phone-dimension limit just by
    reformatting.
    """
    return "".join(ch for ch in str(raw or "") if ch.isdigit())


class PhoneVerificationThrottle:
    """Token + phone + source-address throttling for phone-verification
    requests, per Packet 18 §18.1: "Add request throttling for
    phone-verification requests by token, phone, source, and time window."

    A request is allowed only if every configured dimension allows it — any
    one dimension tripping is enough to refuse. The *reason* reported is
    for a server-side/operator log; the caller-facing response should stay
    generic (e.g. a flat 429), same reasoning as verify_worker_capability_token.
    """

    def __init__(
        self,
        *,
        per_token: SlidingWindowThrottle | None = None,
        per_phone: SlidingWindowThrottle | None = None,
        per_source: SlidingWindowThrottle | None = None,
    ):
        # Conservative placeholder numbers, not a researched-and-approved
        # rate. Tune with whoever owns the SMS budget before relying on
        # these specific values operationally.
        self.per_token = per_token or SlidingWindowThrottle(limit=5, window_seconds=600)
        self.per_phone = per_phone or SlidingWindowThrottle(limit=5, window_seconds=600)
        self.per_source = per_source or SlidingWindowThrottle(limit=20, window_seconds=600)

    def check(
        self,
        *,
        token: str,
        phone: str,
        source_address: str,
        now: float | None = None,
    ) -> ThrottleDecision:
        phone_key = normalize_phone(phone)
        dimensions = (
            ("token", self.per_token, str(token or "").strip()),
            ("phone", self.per_phone, phone_key),
            ("source", self.per_source, str(source_address or "").strip()),
        )
        worst: ThrottleDecision | None = None
        for label, throttle, key in dimensions:
            if not key:
                continue
            decision = throttle.check(key, now=now)
            if not decision.allowed:
                labeled = ThrottleDecision(
                    allowed=False,
                    retry_after_seconds=decision.retry_after_seconds,
                    reason=f"{label}: {decision.reason}",
                )
                if worst is None or labeled.retry_after_seconds > worst.retry_after_seconds:
                    worst = labeled
        return worst if worst is not None else ThrottleDecision(allowed=True)
