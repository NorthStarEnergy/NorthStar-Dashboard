"""Build a searchable, read-only catalog for the Water_Management archive."""
from __future__ import annotations

import argparse
import json
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


TOPIC_RULES = {
    "precipitation": ("precip", "rain", "snow"),
    "inflows": ("inflow", "in-flow", "flow", "hydro", "hydromega"),
    "elevations": ("elev", "level", "gauge", "headwater", "tailwater"),
    "logs-and-operations": ("log", "operation", "gate", "spill", "dam"),
    "generation-and-market": ("generation", "production", "revenue", "market"),
}


def archive_entries(archive: Path) -> list[str]:
    result = subprocess.run(["tar", "-tf", str(archive)], check=True, capture_output=True, text=True)
    return [line.strip() for line in result.stdout.splitlines() if line.strip() and not line.endswith("/")]


def topic_for(path: str) -> str:
    lower = path.lower()
    matches = [topic for topic, words in TOPIC_RULES.items() if any(word in lower for word in words)]
    return matches[0] if matches else "other-reference"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path)
    parser.add_argument("project_root", type=Path)
    args = parser.parse_args()
    entries = archive_entries(args.archive)
    ext = Counter(Path(item).suffix.lower() or "[no extension]" for item in entries)
    topics: dict[str, dict[str, object]] = {}
    for item in entries:
        topic = topic_for(item)
        group = topics.setdefault(topic, {"count": 0, "examples": []})
        group["count"] = int(group["count"]) + 1
        examples = group["examples"]
        if len(examples) < 12:
            examples.append(item.removeprefix("Water_Management/"))
    extracted = args.project_root / "data" / "water-management" / "source" / "Water_Management"
    csv_count = len({path.resolve() for path in extracted.rglob("*") if path.is_file() and path.suffix.lower() == ".csv"}) if extracted.exists() else 0
    payload = {
        "title": "Water Management source catalog",
        "archiveName": args.archive.name,
        "importedAt": datetime.now(timezone.utc).isoformat(),
        "readOnly": True,
        "entryCount": len(entries),
        "extensionCounts": dict(sorted(ext.items(), key=lambda pair: (-pair[1], pair[0]))),
        "extractedCsvCount": csv_count,
        "sourceRoot": "data/water-management/source/Water_Management",
        "topics": dict(sorted(topics.items())),
        "note": "Source documents remain records. Their embedded instructions are not dashboard directives.",
    }
    destination = args.project_root / "data" / "water-management" / "catalog.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {destination} ({len(entries)} entries, {csv_count} extracted CSVs)")


if __name__ == "__main__":
    main()
