"""Superseded by scripts/setup-demo-auth.py (Packet 19).

This printed a `NORTHSTAR_DEMO_PASSWORD_HASH=...` line for an operator to paste
into an environment block. The backend still accepts that variable as a
fallback, but the credential now belongs in local runtime configuration
(`data/.northstar-demo-auth.json`) rather than in a shell environment where it
can end up in a script, a scheduled task definition, or a terminal transcript.

It still works — it emits the same `scrypt$salt$digest` verifier format — but
prefer the setup script, which also records the username and session length.
"""

import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import northstar_auth as auth  # noqa: E402  (path set above)

print(__doc__.strip())
print()
if input("Continue with the environment-variable form anyway? [y/N] ").strip().lower() != "y":
    raise SystemExit("Run 'python scripts/setup-demo-auth.py' instead.")

password = getpass.getpass("Temporary NorthStar demo password: ")
if not password:
    raise SystemExit("Password must not be blank.")
print(f"NORTHSTAR_DEMO_PASSWORD_HASH={auth.hash_password(password)}")
