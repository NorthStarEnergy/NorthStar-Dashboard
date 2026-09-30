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
    data = load_data(ROOT / "dashboard-build-data.js")
    assert data["current"] == data["history"][0]
    version = data["current"]["version"]
    assert f"dashboard-build-data.js?v=build-{version}" in html
    assert f"dashboard-build.js?v=build-{version}" in html
    assert f"dashboard-build.css?v=build-{version}" in html
    assert f"market-workspace.js?v=build-{version}" in html
    assert f"market-workspace.css?v=build-{version}" in html


def test_bump_script_increments_and_records_a_single_line_summary(tmp_path: Path) -> None:
    shutil.copy2(ROOT / "dashboard-build-data.js", tmp_path / "dashboard-build-data.js")
    shutil.copy2(ROOT / "BUILD-VERSION.txt", tmp_path / "BUILD-VERSION.txt")
    shutil.copy2(ROOT / "northstar-clean.html", tmp_path / "northstar-clean.html")
    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--root",
            str(tmp_path),
        "--date",
        "2026-09-16",
        "--timestamp",
        "2026-09-16T14:30:00-04:00",
            "--summary",
            "Automated test build",
        ],
        capture_output=True,
        check=True,
        text=True,
    )
    data_before = load_data(ROOT / "dashboard-build-data.js")
    expected_version = f"v{data_before['current']['version'][1:].rsplit('.', 1)[0]}.{int(data_before['current']['version'].rsplit('.', 1)[1]) + 1:02d}"
    assert result.stdout.startswith(f"{expected_version} — 2026-09-16 — Automated test build")
    data = load_data(tmp_path / "dashboard-build-data.js")
    assert data["current"] == {
        "version": expected_version,
        "published": "2026-09-16",
        "publishedAt": "2026-09-16T14:30:00-04:00",
        "summary": "Automated test build",
    }
    assert data["history"][0] == data["current"]
    assert (tmp_path / "BUILD-VERSION.txt").read_text(encoding="utf-8") == (
        f"{expected_version}\n2026-09-16\n2026-09-16T14:30:00-04:00\nAutomated test build\n"
    )
    html = (tmp_path / "northstar-clean.html").read_text(encoding="utf-8")
    assert f"dashboard-build-data.js?v=build-{expected_version}" in html
    assert f"market-workspace.js?v=build-{expected_version}" in html
    assert f"market-workspace.css?v=build-{expected_version}" in html
