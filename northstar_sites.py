"""Canonical generating-station identity.

Library names and ``site:{slug}`` ids are the single identity for operator
dropdowns, outage writes, and station event matching. Historical display
aliases are accepted on match; they are not new stations. Extra sites with
live check-ins still display. This module imports neither the library nor
the store.
"""
from __future__ import annotations

import re
from typing import Any

AREA_NAMES = {"west": "West", "east": "East", "quebec": "Quebec"}
AREA_ORDER = ("west", "east", "quebec")

# Catalog order is load-bearing: West, East, Quebec. Known voltages only.
STATION_SPECS: tuple[tuple[str, str, str], ...] = (
    ("west", "Fort Frances", "115 kV"),
    ("west", "Calm Lake", ""),
    ("west", "Sturgeon Falls", "115 kV"),
    ("west", "Kenora", "115 kV"),
    ("west", "Norman", ""),
    ("east", "Twin Falls", ""),
    ("east", "Iroquois Falls", "230 kV"),
    ("east", "Island Falls", "115 kV"),
    ("east", "Old Woman Falls", ""),
    ("east", "White Otter Rapids", ""),
    ("east", "Camp Three Rapids", ""),
    ("east", "Big Beaver Falls", ""),
    ("east", "Okikendawt GS", ""),
    ("quebec", "McDougal", ""),
    ("quebec", "Bird GS", ""),
    ("quebec", "Cogent", ""),
    ("quebec", "Aiyers 1", ""),
    ("quebec", "Aiyers 2", ""),
)

SYSTEM_ID = "site:system-transmission"
SYSTEM_NAME = "System / transmission"

# Historical labels only. Do not add Timmins, Carmichael, or Smooth Rock.
# Kenora / Norman grouped crew cards under Kenora; Norman remains its own station.
ALIAS_LABELS: dict[str, str] = {
    "Fort Frances GS": "site:fort-frances",
    "Calm Lake GS": "site:calm-lake",
    "Sturgeon Falls GS": "site:sturgeon-falls",
    "Kenora GS": "site:kenora",
    "Kenora / Norman": "site:kenora",
    "Norman GS": "site:norman",
    "Twin Falls GS": "site:twin-falls",
    "Iroquois Falls GS": "site:iroquois-falls",
    "Iroquois Falls 230 kV": "site:iroquois-falls",
    "IROQUOIS FALLS": "site:iroquois-falls",
    "Island Falls GS": "site:island-falls",
    "Old Woman Falls GS": "site:old-woman-falls",
    "White Otter Rapids GS": "site:white-otter-rapids",
    "Camp Three Rapids GS": "site:camp-three-rapids",
    "Big Beaver Falls GS": "site:big-beaver-falls",
    "McDougal GS": "site:mcdougal",
    "Cogent GS": "site:cogent",
    "System": SYSTEM_ID,
    "transmission": SYSTEM_ID,
    "System/transmission": SYSTEM_ID,
}


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")


def _norm(value: str) -> str:
    return re.sub(r"[\s_/]+", " ", str(value or "").strip().lower())


def _record(area_key: str, name: str, voltage: str = "") -> dict[str, str]:
    return {
        "id": f"site:{slug(name)}",
        "name": name,
        "area": AREA_NAMES[area_key],
        "areaId": f"area:{area_key}",
        "voltage": voltage,
        "kind": "site",
    }


def stations() -> list[dict[str, str]]:
    return [_record(*spec) for spec in STATION_SPECS]


def system_site() -> dict[str, str]:
    return {
        "id": SYSTEM_ID,
        "name": SYSTEM_NAME,
        "area": "",
        "areaId": "",
        "voltage": "",
        "kind": "system",
    }


def known() -> list[dict[str, str]]:
    return [*stations(), system_site()]


def _index() -> tuple[dict[str, dict[str, str]], dict[str, dict[str, str]]]:
    by_id = {row["id"]: row for row in known()}
    by_key: dict[str, dict[str, str]] = {}
    for row in known():
        by_key[_norm(row["name"])] = row
        by_key[_norm(row["id"])] = row
        by_key[_norm(row["id"].removeprefix("site:"))] = row
    for label, site_id in ALIAS_LABELS.items():
        if site_id in by_id:
            by_key[_norm(label)] = by_id[site_id]
    return by_id, by_key


def resolve(value: str) -> dict[str, str] | None:
    text = str(value or "").strip()
    if not text:
        return None
    by_id, by_key = _index()
    if text in by_id:
        return dict(by_id[text])
    found = by_key.get(_norm(text))
    return dict(found) if found else None


def bind(site: str = "", site_id: str = "") -> dict[str, str]:
    """Return canonical ``site`` / ``siteId``. Unknown strings pass through."""
    found = resolve(site_id) or resolve(site)
    if found:
        return {"site": found["name"], "siteId": found["id"]}
    return {"site": str(site or "").strip(), "siteId": ""}


def match_names(site_id: str) -> list[str]:
    """Names that identify this station on historical rows, including aliases."""
    found = resolve(site_id)
    if not found:
        text = str(site_id or "").strip()
        return [text] if text and not text.startswith("site:") else []
    names = [found["name"]]
    for label, target in ALIAS_LABELS.items():
        if target == found["id"] and label not in names:
            names.append(label)
    return names


def options(*, include_system: bool = True) -> list[dict[str, str]]:
    rows = list(stations())
    if include_system:
        rows.append(system_site())
    return [{"id": row["id"], "name": row["name"], "area": row["area"]} for row in rows]


def payload() -> dict[str, Any]:
    return {
        "stations": stations(),
        "system": system_site(),
        "options": options(include_system=True),
        "crewOptions": options(include_system=False),
        "note": (
            "Canonical generating-station identity. "
            "Historical aliases are accepted on match."
        ),
    }
