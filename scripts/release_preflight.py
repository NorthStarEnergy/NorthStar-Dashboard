"""Read-only release gate for the NorthStar primary deployment path."""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def git(*args: str) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=False)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or f"git {' '.join(args)} failed")
    return result.stdout.strip()


def check(name: str, passed: bool, detail: str) -> tuple[str, bool, str]:
    return name, passed, detail


def run() -> list[tuple[str, bool, str]]:
    results: list[tuple[str, bool, str]] = []
    try:
        dirty = git("status", "--porcelain", "--untracked-files=all")
        results.append(check("clean checkout", not dirty, dirty or "no uncommitted changes"))
    except RuntimeError as exc:
        results.append(check("clean checkout", False, str(exc)))
    try:
        head = git("rev-parse", "HEAD")
        expected = os.environ.get("NORTHSTAR_RELEASE_SHA", "").strip()
        results.append(check("release SHA", not expected or expected == head,
                             f"HEAD={head}" if not expected else f"expected={expected}, HEAD={head}"))
    except RuntimeError as exc:
        results.append(check("release SHA", False, str(exc)))
    launcher = ROOT / "start-northstar.ps1"
    launcher_text = launcher.read_text(encoding="utf-8") if launcher.exists() else ""
    results.append(check("operator gate default", bool(re.search(
        r"NORTHSTAR_OPERATOR_GATE\s*=\s*['\"]access['\"]", launcher_text)),
        "launcher defaults to access" if launcher_text else "launcher missing"))
    backend = ROOT / "ieso_backend.py"
    backend_text = backend.read_text(encoding="utf-8") if backend.exists() else ""
    results.append(check("loopback bind guard", "CHECKIN_ORIGIN" in backend_text and "127.0.0.1" in backend_text,
                         "expected bind/origin guard markers found" if backend_text else "backend missing"))
    gitignore = ROOT / ".gitignore"
    ignored = {line.strip() for line in gitignore.read_text(encoding="utf-8").splitlines()} if gitignore.exists() else set()
    results.append(check("data gitignored", "data/" in ignored, "data/ is excluded" if "data/" in ignored else "data/ missing"))
    required = [
        ROOT / "tests" / "test_correlation_ids.py",
        ROOT / "tests" / "test_api_workflows.py",
        ROOT / "northstar_events.py",
    ]
    results.append(check("Packet 27 files present", all(path.exists() for path in required),
                         ", ".join(str(path.relative_to(ROOT)) for path in required if not path.exists()) or "correlation source and tests present"))
    return results


def main() -> int:
    results = run()
    print("NorthStar release pre-flight check")
    print("=" * 60)
    passed = True
    for name, ok, detail in results:
        passed &= ok
        print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}")
    print("=" * 60)
    print(f"RESULT: {'PASS' if passed else 'FAIL'}")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
