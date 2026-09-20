from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "bump-dashboard-version.py"


def load_data(path: Path) -> dict[str, object]:
    raw = path.read_text(encoding="utf-8")
    payload = raw.split("window.NORTHSTAR_BUILD_DATA = ", 1)[1].strip().removesuffix(";")
    return json.loads(payload)


def test_dashboard_build_sources_are_wired() -> None:
    html = (ROOT / "northstar-clean.html").read_text(encoding="utf-8")
    assert "dashboard-build-data.js?v=20260915-build-history-1" in html
    assert "dashboard-build.js?v=20260916-ai-icon-1" in html
    assert "dashboard-build.css?v=20260916-ai-icon-1" in html
    data = load_data(ROOT / "dashboard-build-data.js")
    assert data["current"] == data["history"][0]
    assert data["current"]["version"] == "v0.50"


def test_bump_script_increments_and_records_a_single_line_summary(tmp_path: Path) -> None:
    shutil.copy2(ROOT / "dashboard-build-data.js", tmp_path / "dashboard-build-data.js")
    shutil.copy2(ROOT / "BUILD-VERSION.txt", tmp_path / "BUILD-VERSION.txt")
    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--root",
            str(tmp_path),
            "--date",
            "2026-09-16",
            "--summary",
            "Automated test build",
        ],
        capture_output=True,
        check=True,
        text=True,
    )
    assert result.stdout.startswith("v0.51 — 2026-09-16 — Automated test build")
    data = load_data(tmp_path / "dashboard-build-data.js")
    assert data["current"] == {
        "version": "v0.51",
        "published": "2026-09-16",
        "summary": "Automated test build",
    }
    assert data["history"][0] == data["current"]
    assert (tmp_path / "BUILD-VERSION.txt").read_text(encoding="utf-8") == (
        "v0.51\n2026-09-16\nAutomated test build\n"
    )
