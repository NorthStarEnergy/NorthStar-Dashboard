"""Populate the local NorthStar database with safe demo-only records."""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import northstar_store as store


def main() -> None:
    os.environ.setdefault("NORTHSTAR_DB", str(store.ROOT / "data" / "northstar.db"))
    existing = store.list_checkins(include_closed=False)
    if not existing:
        for payload in (
            {"name": "Alex Morgan", "site": "Iroquois Falls GS", "kind": "Northstar", "alone": False},
            {"name": "Jamie Chen", "site": "Kenora GS", "kind": "Northstar", "alone": True},
            {"name": "Taylor Reed", "site": "Island Falls GS", "kind": "Contractor", "company": "Demo Services", "alone": False},
        ):
            store.create_checkin(payload)
    if not store.list_outages():
        for payload in (
            {"title": "APIROQ Unit 2 inspection", "asset": "APIROQ U2", "site": "Iroquois Falls GS", "severity": "Monitor", "type": "Planned", "details": "Demo maintenance window."},
            {"title": "North transmission line alarm", "asset": "T-Line 230 kV", "site": "Kenora GS", "severity": "Advisory", "type": "Unplanned", "details": "Demo outage for operator workflow testing."},
        ):
            store.create_outage(payload, actor="demo-seed")
    print(f"Demo field records ready: {len(store.list_checkins(include_closed=False))}")


if __name__ == "__main__":
    main()
