"""Release pre-flight check — Packet 18 §18.4 (Packet 15: release evaluator).

STATUS AS OF 2026-08-12: written, NOT executed, NOT wired into start-northstar.ps1,
NOT wired into any build or startup path. A human runs this manually and decides
whether/how to enable it. See README.md in this folder.

What this is: `scripts/prepare-sites.mjs` already does a narrow version of this idea
for the Sites build specifically (refuses a dirty checkout, refuses a HEAD/
NORTHSTAR_RELEASE_SHA mismatch, stamps a release.json manifest). This script covers
the same ground for the *primary* deployment path (the Python backend /
start-northstar.ps1 / Cloudflare Tunnel), which has no equivalent gate today, plus a
handful of safety-invariant checks specific to this project.

This script only reads files and runs `git status`/`git rev-parse` — both read-only
git commands. It does not modify anything, does not start or stop any service, and
does not touch the live database or QR secret.

Exit code 0 = every check passed. Exit code 1 = at least one check failed. Designed to
be easy for a human to read top to bottom and verify by eye before ever wiring it into
anything that actually blocks a startup or deploy.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent


class CheckResult:
    def __init__(self, name: str, passed: bool, detail: str) -> None:
        self.name = name
        self.passed = passed
        self.detail = detail


def _git(args: list[str]) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def check_clean_checkout() -> CheckResult:
    try:
        dirty = _git(["status", "--porcelain", "--untracked-files=all"])
    except RuntimeError as exc:
        return CheckResult("clean checkout", False, str(exc))
    if dirty:
        lines = dirty.splitlines()
        preview = "\n".join(lines[:10])
        more = f" (+{len(lines) - 10} more)" if len(lines) > 10 else ""
        return CheckResult(
            "clean checkout", False,
            f"{len(lines)} uncommitted change(s):\n{preview}{more}",
        )
    return CheckResult("clean checkout", True, "no uncommitted or untracked changes")


def check_release_sha(expected_sha: str | None) -> CheckResult:
    try:
        head = _git(["rev-parse", "HEAD"])
    except RuntimeError as exc:
        return CheckResult("release SHA match", False, str(exc))
    if expected_sha is None:
        return CheckResult(
            "release SHA match", True,
            f"NORTHSTAR_RELEASE_SHA not set — skipped; HEAD is {head}",
        )
    if expected_sha.strip() != head:
        return CheckResult(
            "release SHA match", False,
            f"NORTHSTAR_RELEASE_SHA={expected_sha.strip()} does not match HEAD {head}",
        )
    return CheckResult("release SHA match", True, f"HEAD matches expected {head}")


def check_operator_gate_default() -> CheckResult:
    launcher = ROOT / "start-northstar.ps1"
    if not launcher.exists():
        return CheckResult("operator gate default", False, "start-northstar.ps1 not found")
    text = launcher.read_text(encoding="utf-8")
    # Looks for the specific default-forcing pattern, not just any mention of the var —
    # a bare mention without the "force to access if unset" logic would be a regression.
    pattern = re.compile(
        r"NORTHSTAR_OPERATOR_GATE\s*\)\s*\{\s*\$env:NORTHSTAR_OPERATOR_GATE\s*=\s*['\"]access['\"]",
        re.MULTILINE,
    )
    if pattern.search(text):
        return CheckResult(
            "operator gate default", True,
            "start-northstar.ps1 forces NORTHSTAR_OPERATOR_GATE to 'access' when unset",
        )
    return CheckResult(
        "operator gate default", False,
        "did not find the expected default-forcing line in start-northstar.ps1 — "
        "the operator gate may not be on by default. Check this by hand before deploying.",
    )


def check_loopback_guard() -> CheckResult:
    backend = ROOT / "ieso_backend.py"
    if not backend.exists():
        return CheckResult("loopback-bind guard", False, "ieso_backend.py not found")
    text = backend.read_text(encoding="utf-8")
    if "SystemExit" in text and "127.0.0.1" in text and "CHECKIN_ORIGIN" in text:
        return CheckResult(
            "loopback-bind guard", True,
            "ieso_backend.py appears to still contain the startup refusal guard for "
            "non-loopback bind + public checkin origin (text match only — not a "
            "substitute for reading the actual logic by hand)",
        )
    return CheckResult(
        "loopback-bind guard", False,
        "expected guard text not found in ieso_backend.py — read the startup path by "
        "hand before deploying, this may be a real regression",
    )


def check_data_gitignored() -> CheckResult:
    gitignore = ROOT / ".gitignore"
    if not gitignore.exists():
        return CheckResult("data/ gitignored", False, ".gitignore not found")
    lines = {line.strip() for line in gitignore.read_text(encoding="utf-8").splitlines()}
    if "data/" in lines:
        return CheckResult("data/ gitignored", True, "data/ is excluded")
    return CheckResult(
        "data/ gitignored", False,
        "data/ is not listed verbatim in .gitignore — the database, QR secret, or "
        "backups could end up committed. Check this by hand; the entry may have been "
        "reworded rather than removed, which this exact-match check can't tell apart "
        "from a real regression.",
    )


def check_regression_tests_present() -> CheckResult:
    test_file = ROOT / "tests" / "test_api_workflows.py"
    if not test_file.exists():
        return CheckResult("named regression tests present", False, "tests/test_api_workflows.py not found")
    text = test_file.read_text(encoding="utf-8")
    required = [
        "test_operator_gate_covers_help_subroutes_but_not_the_workers_alarm",
        "test_static_tree_does_not_serve_secrets_or_the_database",
        "test_forged_access_header_cannot_open_the_roster_on_the_public_host",
        "test_forged_access_header_cannot_clear_a_distress_call",
    ]
    missing = [name for name in required if f"def {name}" not in text]
    if missing:
        return CheckResult(
            "named regression tests present", False,
            f"missing test function(s): {', '.join(missing)}",
        )
    return CheckResult(
        "named regression tests present", True,
        f"all {len(required)} named security regression tests are present in source "
        "(presence only — this does not run them; run `python -m pytest tests -q` "
        "separately and confirm it's green)",
    )


def run_all(expected_sha: str | None) -> list[CheckResult]:
    return [
        check_clean_checkout(),
        check_release_sha(expected_sha),
        check_operator_gate_default(),
        check_loopback_guard(),
        check_data_gitignored(),
        check_regression_tests_present(),
    ]


def main(argv: list[str]) -> int:
    import os

    expected_sha = os.environ.get("NORTHSTAR_RELEASE_SHA")
    results = run_all(expected_sha)

    print("NorthStar release pre-flight check")
    print("=" * 60)
    all_passed = True
    for result in results:
        status = "PASS" if result.passed else "FAIL"
        if not result.passed:
            all_passed = False
        print(f"[{status}] {result.name}")
        for line in result.detail.splitlines():
            print(f"       {line}")
    print("=" * 60)

    if all_passed:
        print("RESULT: PASS — every pre-flight check succeeded.")
        print(
            "This does NOT run the test suite. Run `python -m pytest tests -q` "
            "separately and confirm it matches the baseline in AGENTS.md before "
            "treating a deploy as verified."
        )
        return 0

    print("RESULT: FAIL — at least one pre-flight check failed. See above.")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
