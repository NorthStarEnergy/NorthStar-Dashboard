"""Demo operator authentication: local credential config, sessions, throttling.

Packet 19. This is a *demo* login for the operator dashboard, not identity
management. It exists so `ops.northstarenergy.ca` has a real, server-enforced
door while the Cloudflare Access / JWT verification work (ADR-011, decision D-3)
is still open, and so the retired client-side credential pair never comes back.

Three rules shape everything here:

1. **The credential is runtime configuration, never source.** The verifier lives
   in `data/.northstar-demo-auth.json` on the operator's PC — inside `data/`,
   which is gitignored, denied by the static server, and starts with a dot so
   `_static_forbidden` refuses it twice over. Nothing in this file, the HTML, the
   JavaScript, Git, Drive or the logs ever holds the password.
2. **Only a one-way verifier is stored.** scrypt with a per-install random salt,
   compared with `hmac.compare_digest`. A blank password is refused at setup.
3. **Sessions are server-side.** The cookie carries a random token and nothing
   else; every authorisation decision is a lookup here. Losing the process loses
   the sessions, which for a single-operator demo is the correct trade.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent

# Host-only cookie name. No Domain attribute is ever set on it, so the browser
# scopes it to the operator hostname and never sends it to the check-in host.
COOKIE_NAME = "NorthstarOperatorSession"

# One workday. Long enough that a shift does not get logged out mid-incident,
# short enough that a forgotten browser is not a standing key.
DEFAULT_SESSION_SECONDS = 9 * 60 * 60

SCRYPT_N = 16384
SCRYPT_R = 8
SCRYPT_P = 1
PBKDF2_ITERATIONS = 600_000


class AuthConfigError(Exception):
    """The demo credential configuration is missing or unusable."""


def config_path() -> Path:
    """Where the runtime credential file lives on this PC."""
    override = os.environ.get("NORTHSTAR_DEMO_AUTH_FILE", "").strip()
    if override:
        return Path(override).expanduser()
    return ROOT / "data" / ".northstar-demo-auth.json"


def hash_password(password: str, *, algorithm: str = "scrypt") -> str:
    """Return `algorithm$salt$digest`, all hex. The password is never stored."""
    if not password:
        raise AuthConfigError("Password must not be blank.")
    salt = secrets.token_bytes(16)
    if algorithm == "scrypt":
        digest = hashlib.scrypt(
            password.encode("utf-8"), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P
        )
    elif algorithm == "pbkdf2_sha256":
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS
        )
    else:
        raise AuthConfigError(f"Unsupported password algorithm: {algorithm}")
    return f"{algorithm}${salt.hex()}${digest.hex()}"


def password_matches(verifier: str, password: str) -> bool:
    """Constant-time check of a candidate password against a stored verifier."""
    if not verifier or not password:
        return False
    try:
        algorithm, salt_hex, expected = verifier.split("$", 2)
        salt = bytes.fromhex(salt_hex)
        if algorithm == "scrypt":
            actual = hashlib.scrypt(
                password.encode("utf-8"), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P
            ).hex()
        elif algorithm == "pbkdf2_sha256":
            actual = hashlib.pbkdf2_hmac(
                "sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS
            ).hex()
        else:
            return False
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


def build_config(
    username: str, password: str, session_seconds: int = DEFAULT_SESSION_SECONDS
) -> dict[str, Any]:
    """Build a complete runtime configuration from a plaintext password.

    Used by `scripts/setup-demo-auth.py` and by the tests. The plaintext is
    consumed here and never returned, stored, or logged.
    """
    username = str(username).strip()
    if not username:
        raise AuthConfigError("Username must not be blank.")
    if not password:
        raise AuthConfigError("Password must not be blank.")
    return {
        "mode": "demo",
        "username": username,
        "verifier": hash_password(password),
        "sessionSeconds": max(900, int(session_seconds)),
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "note": (
            "Local runtime credential for the NorthStar operator demo login."
            " One-way verifier only; never commit this file."
        ),
    }


def normalise_config(raw: dict[str, Any]) -> dict[str, Any]:
    accounts = raw.get("accounts")
    if isinstance(accounts, list):
        normalised_accounts = []
        for item in accounts:
            if not isinstance(item, dict):
                continue
            username = str(item.get("username", "")).strip()
            verifier = str(item.get("verifier") or item.get("passwordHash") or "").strip()
            if not username or len(verifier.split("$")) != 3:
                continue
            normalised_accounts.append({
                "username": username,
                "verifier": verifier,
                "disabled": bool(item.get("disabled", False)),
                "message": str(item.get("message", "")).strip(),
            })
        if not normalised_accounts:
            raise AuthConfigError("Demo credential configuration has no usable accounts.")
        try:
            session_seconds = int(raw.get("sessionSeconds") or DEFAULT_SESSION_SECONDS)
        except (TypeError, ValueError):
            session_seconds = DEFAULT_SESSION_SECONDS
        return {"mode": "demo", "accounts": normalised_accounts, "sessionSeconds": max(900, session_seconds)}
    username = str(raw.get("username", "")).strip()
    verifier = str(raw.get("verifier") or raw.get("passwordHash") or "").strip()
    if not username:
        raise AuthConfigError("Demo credential configuration has no username.")
    if not verifier:
        raise AuthConfigError("Demo credential configuration has no password verifier.")
    if len(verifier.split("$")) != 3:
        raise AuthConfigError(
            "Demo password verifier must look like 'algorithm$salt$digest'."
        )
    try:
        session_seconds = int(raw.get("sessionSeconds") or DEFAULT_SESSION_SECONDS)
    except (TypeError, ValueError):
        session_seconds = DEFAULT_SESSION_SECONDS
    return {
        "mode": "demo",
        "accounts": [{"username": username, "verifier": verifier, "disabled": False, "message": ""}],
        "username": username,
        "verifier": verifier,
        "sessionSeconds": max(900, session_seconds),
    }


def save_config(config: dict[str, Any], path: Path | None = None) -> Path:
    """Write the runtime credential file, owner-readable where the OS allows."""
    target = path or config_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    try:  # best effort: meaningless on a default Windows volume, correct on POSIX
        os.chmod(target, 0o600)
    except OSError:
        pass
    return target


def load_config(path: Path | None = None) -> dict[str, Any] | None:
    """Load the demo credential from local runtime configuration.

    File first, then the `NORTHSTAR_DEMO_*` environment variables so an operator
    who set those before Packet 19 keeps working. Returns None when nothing is
    configured; the caller decides whether that is fatal (it is, in demo mode).
    """
    target = path or config_path()
    if target.exists():
        try:
            raw = json.loads(target.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise AuthConfigError(f"{target} is not readable JSON: {exc}") from exc
        if not isinstance(raw, dict):
            raise AuthConfigError(f"{target} must contain a JSON object.")
        return normalise_config(raw)

    verifier = os.environ.get("NORTHSTAR_DEMO_PASSWORD_HASH", "").strip()
    if not verifier:
        return None
    return normalise_config({
        "username": os.environ.get("NORTHSTAR_DEMO_USERNAME", "ron"),
        "verifier": verifier,
        "sessionSeconds": os.environ.get(
            "NORTHSTAR_DEMO_SESSION_SECONDS", DEFAULT_SESSION_SECONDS
        ),
    })


def authenticates(config: dict[str, Any] | None, username: str, password: str) -> bool:
    """True when this username/password pair matches the configured credential."""
    if not config:
        return False
    candidate = str(username or "").strip()
    if not candidate or not password:
        return False
    # compare_digest on bytes: a non-ASCII username must fail, not raise.
    # build_config and older credential files use the original single-account shape.
    accounts = config.get("accounts")
    if accounts is None:
        accounts = [config] if config.get("username") and config.get("verifier") else []
    account = next((item for item in accounts if hmac.compare_digest(candidate.encode("utf-8"), str(item["username"]).encode("utf-8"))), None)
    if account is None or account.get("disabled"):
        return False
    return password_matches(account["verifier"], password)


def account_message(config: dict[str, Any] | None, username: str) -> str | None:
    """Return a configured account-specific denial message, if applicable."""
    if not config:
        return None
    candidate = str(username or "").strip()
    for account in config.get("accounts", []):
        if hmac.compare_digest(candidate.encode("utf-8"), str(account["username"]).encode("utf-8")):
            if account.get("disabled"):
                return account.get("message") or "This account is disabled."
            return None
    return None


class SessionStore:
    """Server-side sessions keyed by a cryptographically random token."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._sessions: dict[str, dict[str, Any]] = {}

    def create(self, username: str, lifetime_seconds: int) -> tuple[str, float]:
        # The lifetime floor lives in normalise_config, not here: the tests need
        # to be able to mint an already-expired session and see it refused.
        token = secrets.token_urlsafe(32)
        expires = time.time() + int(lifetime_seconds)
        with self._lock:
            self._purge_locked()
            self._sessions[token] = {"username": username, "expires": expires}
        return token, expires

    def actor(self, token: str) -> str | None:
        """Return the session's username, or None when it is absent or expired."""
        if not token:
            return None
        with self._lock:
            session = self._sessions.get(token)
            if not session:
                return None
            if session["expires"] <= time.time():
                self._sessions.pop(token, None)
                return None
            return str(session["username"])

    def destroy(self, token: str) -> bool:
        if not token:
            return False
        with self._lock:
            return self._sessions.pop(token, None) is not None

    def clear(self) -> None:
        with self._lock:
            self._sessions.clear()

    def count(self) -> int:
        with self._lock:
            self._purge_locked()
            return len(self._sessions)

    def _purge_locked(self) -> None:
        now = time.time()
        for token in [t for t, s in self._sessions.items() if s["expires"] <= now]:
            self._sessions.pop(token, None)


class LoginThrottle:
    """Sliding-window failed-login limiter.

    A small demo deployment does not need enterprise identity management, but
    repeated guesses must not be unlimited. Failures are counted per caller
    address; a success clears that caller's history.
    """

    def __init__(self, max_failures: int = 5, window_seconds: int = 900) -> None:
        self.max_failures = max(1, int(max_failures))
        self.window_seconds = max(60, int(window_seconds))
        self._lock = threading.Lock()
        self._failures: dict[str, list[float]] = {}

    def check(self, key: str) -> tuple[bool, int]:
        """Return (allowed, retry_after_seconds)."""
        now = time.time()
        with self._lock:
            recent = self._recent_locked(key, now)
            if len(recent) < self.max_failures:
                return True, 0
            retry_after = int(recent[0] + self.window_seconds - now) + 1
            return False, max(1, retry_after)

    def record_failure(self, key: str) -> None:
        now = time.time()
        with self._lock:
            recent = self._recent_locked(key, now)
            recent.append(now)
            self._failures[key] = recent

    def reset(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._failures.clear()

    def _recent_locked(self, key: str, now: float) -> list[float]:
        recent = [
            stamp
            for stamp in self._failures.get(key, [])
            if stamp > now - self.window_seconds
        ]
        self._failures[key] = recent
        return recent


def cookie_token(cookie_header: str) -> str:
    """Pull the session token out of a raw Cookie header."""
    for part in (cookie_header or "").split(";"):
        name, _, value = part.strip().partition("=")
        if name == COOKIE_NAME:
            return value.strip().strip('"')
    return ""


def set_cookie_value(token: str, max_age: int) -> str:
    """Build the Set-Cookie value.

    Host-only (no Domain), HttpOnly, Secure, SameSite=Lax, time-limited. The
    absence of Domain is load-bearing: it is what keeps the operator session
    cookie off `checkin.northstarenergy.ca`.
    """
    return (
        f"{COOKIE_NAME}={token}; Path=/; Max-Age={int(max_age)};"
        " HttpOnly; Secure; SameSite=Lax"
    )


def clear_cookie_value() -> str:
    return set_cookie_value("", 0)
