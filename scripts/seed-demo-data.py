"""Populate the local NorthStar database with safe demo-only records."""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import northstar_store as store


DEMO_FIELD_STAFF = (
    {"name": "Alex Morgan", "site": "Iroquois Falls GS", "kind": "Northstar", "alone": False, "latitude": 48.7684, "longitude": -80.6677},
    {"name": "Jamie Chen", "site": "Kenora GS", "kind": "Northstar", "alone": True, "latitude": 49.7670, "longitude": -94.4890},
    {"name": "Taylor Reed", "site": "Island Falls GS", "kind": "Contractor", "company": "Demo Services", "alone": False, "latitude": 49.5888, "longitude": -86.5434},
    {"name": "Morgan Ellis", "site": "Fort Frances GS", "kind": "Northstar", "alone": False, "latitude": 48.6087, "longitude": -93.3983},
    {"name": "Casey Bell", "site": "Timmins GS", "kind": "Contractor", "company": "Northern Field Services", "alone": False, "latitude": 48.4758, "longitude": -81.3305},
    {"name": "Jordan Lee", "site": "Sturgeon Falls GS", "kind": "Northstar", "alone": True, "latitude": 46.3643, "longitude": -79.9327},
)


def refresh_demo_field_staff() -> int:
    """Create missing demo workers and refresh their mock device locations."""
    active = store.list_checkins(include_closed=False)
    by_identity = {(row["name"], row["site"]): row for row in active}
    for profile in DEMO_FIELD_STAFF:
        row = by_identity.get((profile["name"], profile["site"]))
        if row is None:
            row = store.create_checkin(profile, actor="demo-seed")
        store.record_heartbeat(
            row["id"],
            latitude=profile["latitude"],
            longitude=profile["longitude"],
            actor="demo-seed",
        )
    return len(DEMO_FIELD_STAFF)


def main() -> None:
    os.environ.setdefault("NORTHSTAR_DB", str(store.ROOT / "data" / "northstar.db"))
    refreshed = refresh_demo_field_staff()
    if not store.list_outages():
        for payload in (
            {"title": "APIROQ Unit 2 inspection", "asset": "APIROQ U2", "site": "Iroquois Falls GS", "severity": "Monitor", "type": "Planned", "details": "Demo maintenance window."},
            {"title": "North transmission line alarm", "asset": "T-Line 230 kV", "site": "Kenora GS", "severity": "Advisory", "type": "Unplanned", "details": "Demo outage for operator workflow testing."},
        ):
            store.create_outage(payload, actor="demo-seed")
    print(
        f"Demo field tracker refreshed: {refreshed} workers; "
        f"{len(store.list_checkins(include_closed=False))} active records total"
    )


if __name__ == "__main__":
    main()
