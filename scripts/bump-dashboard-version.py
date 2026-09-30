"""Increment the visible NorthStar dashboard build and record one release note."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = "dashboard-build-data.js"
VERSION_FILE = "BUILD-VERSION.txt"
HTML_FILE = "northstar-clean.html"
ASSIGNMENT = "window.NORTHSTAR_BUILD_DATA = "
COMMENT = (
    "/* Source of truth for the operator-dashboard build badge and release history.\n"
    " * Use `python scripts/bump-dashboard-version.py --summary \"...\"` for future releases.\n"
    " */\n"
)


def parse_data(path: Path) -> dict[str, object]:
    raw = path.read_text(encoding="utf-8")
    try:
        start = raw.index(ASSIGNMENT) + len(ASSIGNMENT)
        payload = raw[start:].strip()
        if payload.endswith(";"):
            payload = payload[:-1]
        data = json.loads(payload)
    except (ValueError, json.JSONDecodeError) as exc:
        raise ValueError(f"{path.name} does not contain valid build data") from exc
    if not isinstance(data, dict) or not isinstance(data.get("current"), dict) or not isinstance(data.get("history"), list):
        raise ValueError(f"{path.name} has an invalid build-data shape")
    return data


def next_version(value: object) -> str:
    match = re.fullmatch(r"v(\d+)\.(\d+)", str(value))
    if not match:
        raise ValueError(f"current version {value!r} must look like v0.41")
    return f"v{match.group(1)}.{int(match.group(2)) + 1:02d}"


def clean_summary(value: str) -> str:
    summary = " ".join(value.split())
    if not summary:
        raise ValueError("--summary cannot be blank")
    if len(summary) > 160:
        raise ValueError("--summary must be 160 characters or fewer")
    return summary


def write_atomic(path: Path, content: str) -> None:
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)


def refresh_release_asset_urls(root: Path, version: str) -> None:
    """Bust the dashboard assets that carry the release and current shell UI."""
    html_path = root / HTML_FILE
    content = html_path.read_text(encoding="utf-8")
    assets = (
        "dashboard-build-data.js", "dashboard-build.js", "dashboard-build.css",
        "overview-modules.js", "overview-modules.css", "overview-layout.css",
        "dashboard-layout-default.js", "module-layout.js",
        "generating-station-cards.css", "generating-stations.js",
        "hover-window.css", "hover-window.js",
        "ai-assistant-workspace.js", "ai-assistant-workspace.css",
        "market-trends.js", "market-workspace.js", "market-workspace.css",
        "module-workspace.js", "module-workspace.css", "dashboard-polish.css",
        "module-asset-editor.js", "module-asset-editor.css",
        "dashboard-chrome.js", "web-toolbar.js",
        "development-workspace.js", "development-workspace.css",
        "demo-overview.js", "demo-overview.css", "alarm-indicator.js",
    )
    for asset in assets:
        pattern = rf"({re.escape(asset)}\?v=)[^\"'\s<>]+"
        replacement = rf"\g<1>build-{version}"
        content, count = re.subn(pattern, replacement, content)
        if count != 1:
            raise ValueError(f"{HTML_FILE} must include exactly one versioned asset: {asset}")
    # Older shells may include this optional client release loader.
    content = re.sub(
        r"(client-release-update\.js\?v=)[^\"'\s<>]+",
        rf"\g<1>client-release-{version}",
        content,
    )
    write_atomic(html_path, content)
    toolbar_path = root / "web-toolbar.js"
    if toolbar_path.exists():
        toolbar = toolbar_path.read_text(encoding="utf-8")
        toolbar, count = re.subn(
            r"(web-toolbar\.css\?v=)[^'\"\s]+",
            rf"\g<1>build-{version}",
            toolbar,
        )
        if count != 1:
            raise ValueError("web-toolbar.js must include exactly one versioned stylesheet reference")
        write_atomic(toolbar_path, toolbar)


def bump(root: Path, summary: str, published: str, published_at: str) -> dict[str, str]:
    data_path = root / DATA_FILE
    version_path = root / VERSION_FILE
    data = parse_data(data_path)
    version = next_version(data["current"].get("version"))
    record = {
        "version": version,
        "published": published,
        "publishedAt": published_at,
        "summary": summary,
    }
    old_history = [entry for entry in data["history"] if isinstance(entry, dict)]
    data["current"] = record
    data["history"] = [record, *[entry for entry in old_history if entry.get("version") != version]]
    write_atomic(data_path, COMMENT + ASSIGNMENT + json.dumps(data, indent=2) + ";\n")
    write_atomic(version_path, f"{version}\n{published}\n{published_at}\n{summary}\n")
    refresh_release_asset_urls(root, version)
    return record


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--summary", required=True, help="single-line summary for the build history")
    parser.add_argument("--date", dest="published", default=date.today().isoformat(), help="publication date (YYYY-MM-DD)")
    parser.add_argument("--timestamp", dest="published_at", default=None, help="publication timestamp (ISO 8601; defaults to now)")
    parser.add_argument("--root", type=Path, default=ROOT, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    try:
        published = date.fromisoformat(args.published).isoformat()
        published_at = datetime.fromisoformat(args.published_at).astimezone().isoformat(timespec="seconds") if args.published_at else datetime.now().astimezone().isoformat(timespec="seconds")
        record = bump(args.root.resolve(), clean_summary(args.summary), published, published_at)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    print(f"{record['version']} — {record['published']} — {record['summary']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
