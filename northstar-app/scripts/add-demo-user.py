"""Add a local NorthStar demo account without replacing existing accounts.

Example:
    python scripts/add-demo-user.py --username demo --role site_viewer

The password is prompted securely on a terminal, becomes a salted one-way
verifier in the local runtime config, and is never printed or added to source.
"""

from __future__ import annotations

import argparse
import getpass
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import northstar_auth as auth  # noqa: E402  (path set above)

MIN_PASSWORD_LENGTH = 12


def _read_password() -> str:
    if sys.stdin.isatty():
        password = getpass.getpass("Demo account password: ")
        confirm = getpass.getpass("Confirm password: ")
        if password != confirm:
            raise ValueError("The two passwords did not match.")
        return password
    return sys.stdin.readline().rstrip("\r\n")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Add a local NorthStar demo account without replacing other accounts."
    )
    parser.add_argument("--username", default="demo")
    parser.add_argument("--role", choices=sorted(auth.VALID_ROLES), default=auth.ROLE_SITE_VIEWER)
    parser.add_argument("--replace", action="store_true", help="replace the matching account")
    args = parser.parse_args()

    username = args.username.strip()
    if not username or len(username) > 80 or any(char in username for char in "\r\n"):
        print("Username must be between 1 and 80 characters.", file=sys.stderr)
        return 1

    target = auth.config_path()
    if not target.exists():
        print("No NorthStar demo credential configuration exists yet.", file=sys.stderr)
        return 1
    try:
        raw = json.loads(target.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError("configuration must be a JSON object")
        config = auth.normalise_config(raw)
    except (OSError, ValueError, json.JSONDecodeError, auth.AuthConfigError) as exc:
        print(f"Could not read NorthStar credential configuration: {exc}", file=sys.stderr)
        return 1

    try:
        password = _read_password()
        if len(password) < MIN_PASSWORD_LENGTH:
            raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
        built = auth.build_config(username, password, role=args.role)
    except (ValueError, auth.AuthConfigError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    finally:
        password = ""

    account = {
        "username": built["username"],
        "verifier": built["verifier"],
        "role": built["role"],
        "disabled": False,
        "message": "",
    }
    accounts = [dict(item) for item in config["accounts"]]
    match = next((index for index, item in enumerate(accounts) if item["username"] == username), None)
    if match is not None and not args.replace:
        print("That username already exists. Re-run with --replace to rotate it.", file=sys.stderr)
        return 1
    if match is None:
        accounts.append(account)
    else:
        accounts[match] = account

    output = {
        key: value
        for key, value in raw.items()
        if key not in {"username", "verifier", "passwordHash", "role", "disabled", "message", "accounts", "sessionSeconds"}
    }
    output.update({
        "mode": "demo",
        "accounts": accounts,
        "sessionSeconds": config["sessionSeconds"],
    })
    try:
        auth.save_config(output, target)
    except OSError as exc:
        print(f"Could not save NorthStar credential configuration: {exc}", file=sys.stderr)
        return 1

    print(f"NorthStar demo account '{username}' saved with role '{args.role}'.")
    print("Restart the backend before using the new account.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
