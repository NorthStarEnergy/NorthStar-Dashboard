"""Ephemeral roster for platform-demo sessions; never reads or writes the store."""
from datetime import datetime, timedelta, timezone


def roster(station_names, system_id, now=None):
    now = now or datetime.now(timezone.utc)
    # Half the sites have 1–3 staff; four of twenty also have 2–5 contractors.
    counts = (1, 0, 2, 0, 3, 0, 1, 0, 2, 0, 3, 0, 1, 0, 2, 0, 3, 0, 1, 0)
    contractor_counts = {0: 2, 4: 3, 10: 4, 16: 5}
    first_names = ("Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Avery", "Cameron")
    last_names = ("Reed", "Bennett", "Parker", "Ellis", "Hayes", "Brooks", "Foster", "Quinn")
    rows = []
    stations = [(sid, name) for sid, name in station_names.items() if sid != system_id]
    for index, (site_id, site_name) in enumerate(stations):
        staff_count = counts[index % len(counts)]
        count = staff_count + contractor_counts.get(index % len(counts), 0)
        for person in range(count):
            number = len(rows)
            contractor = person >= staff_count
            rows.append({
                "id": f"platform-crew-{index + 1:02d}-{person + 1:02d}",
                "name": f"{first_names[number % len(first_names)]} {last_names[(number // len(first_names)) % len(last_names)]}",
                "siteId": site_id, "site": site_name,
                "kind": "Contractor" if contractor else "Northstar",
                "company": "Cedar Technical" if contractor else "NorthStar",
                "status": "on-site", "alone": count == 1,
                "checkedIn": (now - timedelta(minutes=75 + index * 7 + person * 3)).isoformat(),
                "lastHeard": (now - timedelta(minutes=2 + (index + person) % 12)).isoformat(),
                "needsHelp": False, "overdue": False, "helpState": "none",
                "expectedMinutes": 480, "latitude": None, "longitude": None,
            })
    return rows
