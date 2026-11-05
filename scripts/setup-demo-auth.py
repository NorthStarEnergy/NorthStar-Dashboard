"""Create the local demo operator credential for the NorthStar dashboard.

Run this on the PC that hosts the dashboard:

    python scripts/setup-demo-auth.py

It asks for the owner-supplied temporary password, stores a salted one-way
verifier in `data/.northstar-demo-auth.json`, and prints nothing that could be
turned back into the password. The password is never written to disk, to the
logs, to the shell history, or to any file that Git or Drive can see: the file
it writes lives under `data/`, which is gitignored, denied by the static server,
and starts with a dot.

Options:
    --username NAME   default 'ron'
    --hours N         session lifetime in hours, default 9 (one workday)
    --force           replace an existing credential
"""

from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import northstar_auth as auth  # noqa: E402  (path set above)

MIN_PASSWORD_LENGTH = 8


def main() -> int:
    parser = argparse.ArgumentParser(description="Configure the NorthStar demo operator login.")
    parser.add_argument("--username", default="ron")
    parser.add_argument("--hours", type=float, default=9.0)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    target = auth.config_path()
    if target.exists() and not args.force:
        print(f"{target} already exists. Re-run with --force to replace it.")
        return 1

    username = args.username.strip()
    if not username:
        print("Username must not be blank.")
        return 1

    if sys.stdin.isatty():
        password = getpass.getpass("Temporary NorthStar demo password: ")
        confirm = getpass.getpass("Confirm password: ")
    else:  # piped input, for an unattended reinstall
        password = sys.stdin.readline().rstrip("\n")
        confirm = password

    if not password:
        print("Password must not be blank.")
        return 1
    if password != confirm:
        print("The two entries did not match.")
        return 1
    if len(password) < MIN_PASSWORD_LENGTH:
        print(
            f"Password must be at least {MIN_PASSWORD_LENGTH} characters."
            " This login is reachable from the internet on the operator hostname."
        )
        return 1

    seconds = int(max(0.25, args.hours) * 3600)
    config = auth.build_config(username, password, seconds)
    del password, confirm
    written = auth.save_config(config)

    print(f"Demo operator credential written to {written}")
    print(f"  username        {config['username']}")
    print(f"  session length  {config['sessionSeconds'] // 3600}h")
    print("  password        stored as a salted scrypt verifier only")
    print()
    print("Next: set NORTHSTAR_OPERATOR_GATE=demo (start-northstar.ps1 -DemoLogin does this)")
    print("and restart the backend. Never commit or copy this file.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
