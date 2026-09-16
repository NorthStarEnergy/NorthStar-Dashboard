"""Increment the visible NorthStar dashboard build and record one release note."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = "dashboard-build-data.js"
VERSION_FILE = "BUILD-VERSION.txt"
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


def bump(root: Path, summary: str, published: str) -> dict[str, str]:
    data_path = root / DATA_FILE
    version_path = root / VERSION_FILE
    data = parse_data(data_path)
    version = next_version(data["current"].get("version"))
    record = {"version": version, "published": published, "summary": summary}
    old_history = [entry for entry in data["history"] if isinstance(entry, dict)]
    data["current"] = record
    data["history"] = [record, *[entry for entry in old_history if entry.get("version") != version]]
    write_atomic(data_path, COMMENT + ASSIGNMENT + json.dumps(data, indent=2) + ";\n")
    write_atomic(version_path, f"{version}\n{published}\n{summary}\n")
    return record


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--summary", required=True, help="single-line summary for the build history")
    parser.add_argument("--date", dest="published", default=date.today().isoformat(), help="publication date (YYYY-MM-DD)")
    parser.add_argument("--root", type=Path, default=ROOT, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    try:
        published = date.fromisoformat(args.published).isoformat()
        record = bump(args.root.resolve(), clean_summary(args.summary), published)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    print(f"{record['version']} — {record['published']} — {record['summary']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
