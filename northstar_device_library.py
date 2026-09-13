"""Company device library: area → site → generating-station components.

This is a reference repository. It does not command equipment, change SCADA
state, or acknowledge alarms. Operator notes are append-only.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone

import northstar_events as events
import northstar_store as store

SCHEMA = """
CREATE TABLE IF NOT EXISTS device_library_notes (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_device_library_notes_item
    ON device_library_notes(item_id, created_at);
"""


def init_schema(connection) -> None:
    connection.executescript(SCHEMA)


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def _device(site_id: str, folder: str, name: str, klass: str, **fields) -> dict:
    item_id = f"device:{site_id}:{_slug(folder)}:{_slug(name)}"
    record = {
        "id": item_id,
        "kind": "device",
        "name": name,
        "className": klass,
        "folder": folder,
        **fields,
    }
    return record


def _station_devices(site_id: str, site: str, voltage: str, units: int = 1) -> list[dict]:
    devices = []
    for index in range(1, units + 1):
        devices.extend([
            _device(site_id, "Powerhouse", f"Unit {index} Turbine", "Turbine",
                    rating="Hydro turbine", voltage=voltage, description=f"{site} hydraulic turbine, unit {index}."),
            _device(site_id, "Powerhouse", f"Unit {index} Generator", "Generator",
                    rating="Synchronous generator", voltage=voltage, description=f"{site} generator, unit {index}."),
            _device(site_id, "Powerhouse", f"Unit {index} Governor", "Governor",
                    rating="Speed / load governor", description=f"Unit {index} governor and actuator."),
            _device(site_id, "Powerhouse", f"Unit {index} Excitation", "Excitation",
                    rating="Static exciter", description=f"Unit {index} excitation and AVR."),
        ])
    devices.extend([
        _device(site_id, "Switchyard", "GSU Transformer", "Transformer",
                voltage=voltage, rating="Generator step-up", description=f"{site} GSU transformer."),
        _device(site_id, "Switchyard", f"{voltage} Breaker", "Breaker",
                voltage=voltage, rating="SF6 / vacuum breaker", description=f"High-side breaker at {site}."),
        _device(site_id, "Switchyard", "Line Disconnect", "Disconnect",
                voltage=voltage, description="Line disconnect switch."),
        _device(site_id, "Switchyard", f"{voltage} Bus", "Bus",
                voltage=voltage, description="Station high-side bus."),
        _device(site_id, "Switchyard", "Surge Arresters", "Arrester",
                voltage=voltage, description="High-side surge arresters."),
        _device(site_id, "Protection & Control", "Generator Protection", "Relay",
                description="Generator differential, loss-of-field, and backup protection."),
        _device(site_id, "Protection & Control", "Current Transformers", "CT",
                description="Protection and metering CTs."),
        _device(site_id, "Protection & Control", "Voltage Transformers", "VT",
                description="Protection and metering VTs."),
        _device(site_id, "Protection & Control", "SCADA RTU", "RTU",
                description="Station telemetry and control interface. Library record only."),
        _device(site_id, "Protection & Control", "Annunciator", "Annunciator",
                description="Station alarm window and sequence of events."),
        _device(site_id, "Waterways", "Intake Gates", "Gate",
                description="Intake / headgate equipment."),
        _device(site_id, "Waterways", "Trash Racks", "Rack",
                description="Intake trash racks and rakes."),
        _device(site_id, "Waterways", "Penstock", "Penstock",
                description="Penstock and isolation valve."),
        _device(site_id, "Waterways", "Spillway Gates", "Gate",
                description="Spillway gates and hoists."),
        _device(site_id, "Waterways", "Tailrace", "Waterway",
                description="Tailrace and draft-tube area."),
        _device(site_id, "Station Service", "Station Service Transformer", "Transformer",
                voltage="4.16 kV / 600 V", description="Station service supply."),
        _device(site_id, "Station Service", "Station Service MCC", "MCC",
                description="Station service motor-control centre."),
        _device(site_id, "Station Service", "125 V DC Battery", "Battery",
                rating="125 V DC", description="Protection and control DC supply."),
        _device(site_id, "Station Service", "Emergency Diesel", "Diesel",
                description="Black-start / emergency station service."),
        _device(site_id, "Station Service", "Powerhouse Crane", "Crane",
                description="Powerhouse overhead crane."),
    ])
    return devices


def _yard_devices(site_id: str, site: str, voltage: str) -> list[dict]:
    return [
        _device(site_id, "Switchyard", f"{voltage} Bus", "Bus", voltage=voltage, description=f"{site} high-side bus."),
        _device(site_id, "Switchyard", f"{voltage} Breaker", "Breaker", voltage=voltage, description="Transmission breaker."),
        _device(site_id, "Switchyard", "Line Disconnect", "Disconnect", voltage=voltage, description="Line disconnect."),
        _device(site_id, "Protection & Control", "Line Protection", "Relay", description="Line current differential / distance."),
        _device(site_id, "Protection & Control", "SCADA RTU", "RTU", description="Yard telemetry interface. Library record only."),
        _device(site_id, "Station Service", "Station Service Transformer", "Transformer", description="Yard station service."),
        _device(site_id, "Station Service", "125 V DC Battery", "Battery", rating="125 V DC", description="Yard DC supply."),
    ]


def _catalog() -> dict:
    areas = [
        {
            "id": "area:northeast",
            "name": "Northeast Ontario",
            "kind": "area",
            "sites": [
                {"id": "site:iroquois-falls-gs", "name": "Iroquois Falls GS", "voltage": "230 kV", "units": 1},
                {"id": "site:island-falls-gs", "name": "Island Falls GS", "voltage": "115 kV", "units": 1},
                {"id": "site:timmins-gs", "name": "Timmins GS", "voltage": "115 kV", "units": 1},
                {"id": "site:carmichael-gs", "name": "Carmichael GS", "voltage": "115 kV", "units": 1},
                {"id": "site:smooth-rock-falls", "name": "Smooth Rock Falls", "voltage": "115 kV", "units": 1},
                {"id": "site:alder-creek-gs", "name": "Alder Creek GS", "voltage": "115 kV", "units": 1},
            ],
        },
        {
            "id": "area:northwest",
            "name": "Northwest Ontario",
            "kind": "area",
            "sites": [
                {"id": "site:fort-frances-gs", "name": "Fort Frances GS", "voltage": "115 kV", "units": 1},
                {"id": "site:kenora-gs", "name": "Kenora GS", "voltage": "115 kV", "units": 1},
                {"id": "site:silver-falls-gs", "name": "Silver Falls GS", "voltage": "115 kV", "units": 1},
                {"id": "site:pine-river-gs", "name": "Pine River GS", "voltage": "115 kV", "units": 1},
            ],
        },
        {
            "id": "area:central",
            "name": "Nipissing / Central",
            "kind": "area",
            "sites": [
                {"id": "site:sturgeon-falls-gs", "name": "Sturgeon Falls GS", "voltage": "115 kV", "units": 1},
            ],
        },
        {
            "id": "area:transmission",
            "name": "Transmission",
            "kind": "area",
            "sites": [
                {"id": "site:iroquois-falls-230kv", "name": "Iroquois Falls 230 kV", "voltage": "230 kV", "yard": True},
            ],
        },
    ]
    items = {
        "company:northstar": {
            "id": "company:northstar",
            "kind": "company",
            "name": "NorthStar Energy",
            "description": "Company device repository. Reference data only — not a command or release surface.",
        }
    }
    tree = {
        "id": "company:northstar",
        "name": "NorthStar Energy",
        "kind": "company",
        "children": [],
    }
    for area in areas:
        items[area["id"]] = {
            "id": area["id"], "kind": "area", "name": area["name"],
            "description": f"Operating area · {area['name']}",
        }
        area_node = {"id": area["id"], "name": area["name"], "kind": "area", "children": []}
        for site in area["sites"]:
            site_id, site_name, voltage = site["id"], site["name"], site["voltage"]
            items[site_id] = {
                "id": site_id, "kind": "site", "name": site_name, "areaId": area["id"],
                "area": area["name"], "voltage": voltage,
                "description": f"{site_name} · {voltage}",
            }
            devices = _yard_devices(site_id, site_name, voltage) if site.get("yard") else _station_devices(
                site_id, site_name, voltage, site.get("units", 1)
            )
            folders: dict[str, list] = {}
            for device in devices:
                device["siteId"] = site_id
                device["site"] = site_name
                device["areaId"] = area["id"]
                device["area"] = area["name"]
                items[device["id"]] = device
                folders.setdefault(device["folder"], []).append({
                    "id": device["id"], "name": device["name"], "kind": "device",
                    "className": device["className"],
                })
            site_node = {"id": site_id, "name": site_name, "kind": "site", "children": []}
            for folder_name, children in folders.items():
                folder_id = f"folder:{site_id}:{_slug(folder_name)}"
                items[folder_id] = {
                    "id": folder_id, "kind": "folder", "name": folder_name,
                    "siteId": site_id, "site": site_name, "areaId": area["id"], "area": area["name"],
                    "description": f"{site_name} · {folder_name}",
                    "childIds": [child["id"] for child in children],
                }
                site_node["children"].append({
                    "id": folder_id, "name": folder_name, "kind": "folder", "children": children,
                })
            area_node["children"].append(site_node)
        tree["children"].append(area_node)
    return {"tree": tree, "items": items}


_CACHE = None


def catalog() -> dict:
    global _CACHE
    if _CACHE is None:
        _CACHE = _catalog()
    return _CACHE


def _matches(item: dict, query: str) -> bool:
    if not query:
        return True
    blob = " ".join(str(item.get(key, "")) for key in (
        "name", "className", "folder", "site", "area", "description", "voltage", "rating"
    )).lower()
    return query in blob


def tree(query: str = "") -> dict:
    data = catalog()
    query = str(query or "").strip().lower()

    def prune(node):
        item = data["items"][node["id"]]
        children = [child for child in (prune(child) for child in node.get("children") or []) if child]
        if node["kind"] == "device":
            return dict(node) if _matches(item, query) else None
        kept = dict(node)
        kept["children"] = children
        return kept if children or (not query and node["kind"] != "device") or _matches(item, query) else None

    root = prune(data["tree"]) or {**data["tree"], "children": []}
    devices = [item for item in data["items"].values() if item["kind"] == "device"]
    return {
        "company": "NorthStar Energy",
        "note": "Reference library only. Records do not command equipment or acknowledge alarms.",
        "tree": root,
        "counts": {
            "areas": sum(1 for item in data["items"].values() if item["kind"] == "area"),
            "sites": sum(1 for item in data["items"].values() if item["kind"] == "site"),
            "devices": len(devices),
        },
    }


def _notes(item_id: str) -> list[dict]:
    with store._LOCK, store._session() as connection:
        rows = connection.execute(
            "SELECT id, body, created_at, created_by FROM device_library_notes "
            "WHERE item_id=? ORDER BY created_at DESC",
            (item_id,),
        ).fetchall()
    return [{"id": row["id"], "text": row["body"], "createdAt": row["created_at"], "actorId": row["created_by"]} for row in rows]


def item(item_id: str) -> dict:
    item_id = str(item_id or "").strip()
    if not item_id:
        raise ValueError("A library item id is required")
    record = catalog()["items"].get(item_id)
    if not record:
        raise LookupError("Library item not found")
    data = dict(record)
    data["notes"] = _notes(record["id"])
    data["note"] = "Reference record only. Notes do not acknowledge or clear alarms."
    if record["kind"] == "folder":
        data["contents"] = [catalog()["items"][child_id] for child_id in record.get("childIds", [])]
    if record["kind"] in {"site", "area", "company"}:
        data["contents"] = [
            {"id": child["id"], "name": child["name"], "kind": child["kind"]}
            for child in _node(record["id"]).get("children", [])
        ]
    return data


def _node(item_id: str) -> dict:
    def find(node):
        if node["id"] == item_id:
            return node
        for child in node.get("children") or []:
            found = find(child)
            if found:
                return found
        return {}
    return find(catalog()["tree"])


def add_note(item_id: str, text: str, actor: str, request_id: str) -> dict:
    item_id = str(item_id or "").strip()
    text = str(text or "").strip()
    request_id = str(request_id or "").strip()
    actor = str(actor or "").strip()[:160] or "operator console"
    if item_id not in catalog()["items"]:
        raise LookupError("Library item not found")
    if not text or len(text) > 8000:
        raise ValueError("Enter a note of 1–8000 characters")
    if not request_id or len(request_id) > 100:
        raise ValueError("A note request ID is required")
    note_id = "libnote_" + hashlib.sha256(json.dumps([item_id, actor, request_id]).encode()).hexdigest()
    timestamp = datetime.now(timezone.utc).isoformat()
    record = catalog()["items"][item_id]
    with store._LOCK, store._session() as connection:
        prior = connection.execute("SELECT body FROM device_library_notes WHERE id=?", (note_id,)).fetchone()
        if prior:
            if prior["body"] != text:
                raise ValueError("This note request ID was already used")
            return {"id": note_id, "duplicate": True}
        connection.execute(
            "INSERT INTO device_library_notes (id,item_id,body,created_at,created_by) VALUES (?,?,?,?,?)",
            (note_id, item_id, text, timestamp, actor),
        )
        events.append_event(
            connection,
            event_id=note_id,
            event_type="library.note.added",
            occurred_at=timestamp,
            actor_id=actor,
            aggregate_type="device",
            aggregate_id=item_id,
            source="library",
            summary="Library note",
            payload={
                "details": text,
                "recordKind": "note",
                "site": record.get("site") or record.get("name"),
                "equipment": record.get("name"),
                "category": "other",
            },
        )
    return {"id": note_id, "duplicate": False}
