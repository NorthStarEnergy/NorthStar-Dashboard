"""Read-only Maximo connection for generating-station library records.

Each library site is a Maximo query target (siteid + location). This module
does not write work orders, change asset status, or acknowledge alarms.

Credentials are local runtime configuration, never source. Configuration
alone is not a successful connection.
"""
from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlparse
from urllib.request import Request, urlopen

import northstar_device_library as library
from northstar_paths import app_root

ROOT = app_root(__file__)
CONFIG_NOTE = (
    "Maximo is the station asset source. This origin does not write work orders, "
    "change asset status, or acknowledge alarms."
)
DEFAULT_ASSET_OS = "mxapiasset"
DEFAULT_WO_OS = "mxapiwo"
MAX_BODY = 1_000_000
FETCH_TIMEOUT = 15
EQUIPMENT_SNAPSHOT_FILENAME = "equipment-master.json"
EQUIPMENT_PAGE_SIZE = 50
EQUIPMENT_PAGE_LIMIT = 100
EQUIPMENT_SEARCH_LIMIT = 200

_FETCH: Callable[[str, dict[str, str]], dict[str, Any]] | None = None
_SNAPSHOT_CACHE: tuple[tuple[str, int, int] | None, dict[str, Any] | None] | None = None


def config_path() -> Path:
    override = os.environ.get("NORTHSTAR_MAXIMO_CONFIG", "").strip()
    if override:
        return Path(override).expanduser()
    return ROOT / "data" / ".northstar-maximo.json"


def equipment_snapshot_path() -> Path:
    """Return the local, operator-only Maximo equipment snapshot path."""
    override = os.environ.get("NORTHSTAR_MAXIMO_SNAPSHOT", "").strip()
    if override:
        return Path(override).expanduser()
    return ROOT / "data" / "maximo" / EQUIPMENT_SNAPSHOT_FILENAME


def _strip_secret(value: str) -> str:
    return str(value or "").strip()


def _text(value: Any, limit: int = 2_000) -> str:
    return str(value or "").strip()[:limit]


def _snapshot_fingerprint(path: Path) -> tuple[str, int, int] | None:
    try:
        stat = path.stat()
    except OSError:
        return None
    return (str(path), stat.st_mtime_ns, stat.st_size)


def _load_equipment_snapshot() -> dict[str, Any] | None:
    """Load a validated local import without ever exposing its filesystem path."""
    global _SNAPSHOT_CACHE
    path = equipment_snapshot_path()
    fingerprint = _snapshot_fingerprint(path)
    if _SNAPSHOT_CACHE and _SNAPSHOT_CACHE[0] == fingerprint:
        return _SNAPSHOT_CACHE[1]
    snapshot: dict[str, Any] | None = None
    if fingerprint:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            raw = {}
        if isinstance(raw, dict) and isinstance(raw.get("assets"), list):
            assets = []
            for candidate in raw["assets"]:
                if not isinstance(candidate, dict):
                    continue
                asset_num = _text(candidate.get("assetNum"), 160)
                site = _text(candidate.get("site"), 80)
                if not asset_num or not site:
                    continue
                assets.append({
                    "assetNum": asset_num,
                    "description": _text(candidate.get("description")),
                    "location": _text(candidate.get("location"), 320),
                    "locationDescription": _text(candidate.get("locationDescription")),
                    "parent": _text(candidate.get("parent"), 160),
                    "rotatingItem": _text(candidate.get("rotatingItem"), 320),
                    "site": site,
                })
            source = raw.get("source") if isinstance(raw.get("source"), dict) else {}
            site_counts: dict[str, int] = {}
            for asset in assets:
                site_counts[asset["site"]] = site_counts.get(asset["site"], 0) + 1
            snapshot = {
                "assets": assets,
                "source": {
                    "filename": Path(_text(source.get("filename"), 255)).name,
                    "sha256": _text(source.get("sha256"), 128),
                    "sheetName": _text(source.get("sheetName"), 255),
                    "importedAt": _text(source.get("importedAt"), 80),
                    "headers": [
                        _text(value, 120) for value in source.get("headers", [])
                        if isinstance(value, (str, int, float))
                    ][:20],
                },
                "siteCounts": [
                    {"code": code, "assets": count}
                    for code, count in sorted(site_counts.items())
                ],
            }
    _SNAPSHOT_CACHE = (fingerprint, snapshot)
    return snapshot


def equipment_master_status() -> dict[str, Any]:
    """Describe the locally imported master list without reading Maximo remotely."""
    snapshot = _load_equipment_snapshot()
    if not snapshot:
        return {
            "available": False,
            "state": "No imported equipment master",
            "readOnly": True,
            "href": "/api/maximo/equipment",
            "assetCount": 0,
            "siteCount": 0,
        }
    return {
        "available": True,
        "state": "Loaded local equipment master",
        "readOnly": True,
        "href": "/api/maximo/equipment",
        "assetCount": len(snapshot["assets"]),
        "siteCount": len(snapshot["siteCounts"]),
        "source": snapshot["source"],
    }


def _bounded_int(value: Any, *, name: str, default: int, maximum: int) -> int:
    if value in (None, ""):
        return default
    try:
        parsed = int(str(value))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a whole number") from exc
    if parsed < 1 or parsed > maximum:
        raise ValueError(f"{name} must be between 1 and {maximum}")
    return parsed


def equipment(query: str = "", site: str = "", page: Any = 1, limit: Any = EQUIPMENT_PAGE_SIZE) -> dict[str, Any]:
    """Search the complete, local equipment list with bounded pagination."""
    requested_query = _text(query, EQUIPMENT_SEARCH_LIMIT)
    requested_site = _text(site, 80)
    page_number = _bounded_int(page, name="page", default=1, maximum=1_000_000)
    page_limit = _bounded_int(limit, name="limit", default=EQUIPMENT_PAGE_SIZE, maximum=EQUIPMENT_PAGE_LIMIT)
    snapshot = _load_equipment_snapshot()
    status = equipment_master_status()
    base = {
        **status,
        "query": requested_query,
        "site": requested_site,
        "page": page_number,
        "limit": page_limit,
        "total": 0,
        "pages": 0,
        "sites": [],
        "assets": [],
    }
    if not snapshot:
        return base
    terms = [term.casefold() for term in requested_query.split()]
    rows = []
    for asset in snapshot["assets"]:
        if requested_site and asset["site"] != requested_site:
            continue
        searchable = " ".join(asset.values()).casefold()
        if terms and not all(term in searchable for term in terms):
            continue
        rows.append(asset)
    total = len(rows)
    pages = math.ceil(total / page_limit) if total else 0
    start = (page_number - 1) * page_limit
    base.update({
        "source": snapshot["source"],
        "sites": snapshot["siteCounts"],
        "total": total,
        "pages": pages,
        "assets": [dict(asset) for asset in rows[start:start + page_limit]],
    })
    return base


def _load_file() -> dict[str, Any]:
    path = config_path()
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return raw if isinstance(raw, dict) else {}


def config() -> dict[str, Any]:
    """Return sanitized connection settings. Secrets stay server-side."""
    stored = _load_file()
    url = _strip_secret(os.environ.get("NORTHSTAR_MAXIMO_URL") or stored.get("url"))
    api_key = _strip_secret(os.environ.get("NORTHSTAR_MAXIMO_APIKEY") or stored.get("apiKey"))
    username = _strip_secret(os.environ.get("NORTHSTAR_MAXIMO_USER") or stored.get("username"))
    password = _strip_secret(os.environ.get("NORTHSTAR_MAXIMO_PASSWORD") or stored.get("password"))
    parsed = urlparse(url)
    configured = bool(
        url
        and parsed.scheme == "https"
        and parsed.hostname
        and not parsed.username
        and (api_key or (username and password))
    )
    return {
        "url": url if configured or (url and parsed.scheme == "https" and parsed.hostname) else "",
        "apiKey": api_key,
        "username": username,
        "password": password,
        "assetObjectStructure": _strip_secret(stored.get("assetObjectStructure")) or DEFAULT_ASSET_OS,
        "workOrderObjectStructure": _strip_secret(stored.get("workOrderObjectStructure")) or DEFAULT_WO_OS,
        "sites": stored.get("sites") if isinstance(stored.get("sites"), dict) else {},
        "configured": configured,
        "host": parsed.hostname if parsed.scheme == "https" else "",
    }


def _area_siteid(area: str) -> str:
    return {"West": "WEST", "East": "EAST", "Quebec": "QUEBEC"}.get(area, "")


def station_map(site_id: str) -> dict[str, str]:
    record = library.catalog()["items"].get(str(site_id or "").strip())
    if not record or record.get("kind") != "site":
        raise LookupError("Library station not found")
    override = config().get("sites") or {}
    override = override.get(record["id"]) if isinstance(override, dict) else None
    override = override if isinstance(override, dict) else {}
    location = _strip_secret(override.get("location")) or record["name"].upper()
    siteid = _strip_secret(override.get("siteid")) or _area_siteid(record.get("area", ""))
    return {
        "id": record["id"],
        "name": record["name"],
        "area": record.get("area") or "",
        "maximoSiteId": siteid,
        "maximoLocation": location,
    }


def reference(site_id: str) -> dict[str, Any]:
    """Pointer only. Does not call Maximo."""
    settings = config()
    try:
        station = station_map(site_id)
    except LookupError:
        raise
    return {
        "state": "Configured — not yet verified" if settings["configured"] else "Setup pending",
        "configured": settings["configured"],
        "connected": False,
        "readOnly": True,
        "href": f"/api/maximo/station?id={station['id']}",
        "maximoSiteId": station["maximoSiteId"],
        "maximoLocation": station["maximoLocation"],
        "note": CONFIG_NOTE,
    }


def status() -> dict[str, Any]:
    settings = config()
    stations = []
    for item in library.catalog()["items"].values():
        if item.get("kind") != "site":
            continue
        stations.append({
            "id": item["id"],
            "name": item["name"],
            "area": item.get("area") or "",
            "href": f"/api/maximo/station?id={item['id']}",
        })
    stations.sort(key=lambda row: (row["area"], row["name"]))
    return {
        "state": "Configured — not yet verified" if settings["configured"] else "Setup pending",
        "configured": settings["configured"],
        "connected": False,
        "readOnly": True,
        "host": settings["host"],
        "note": CONFIG_NOTE,
        "stations": stations,
    }


def _field(row: dict[str, Any], *names: str) -> str:
    for name in names:
        if name in row and row[name] not in (None, ""):
            return str(row[name])
        prefixed = f"spi:{name}"
        if prefixed in row and row[prefixed] not in (None, ""):
            return str(row[prefixed])
    return ""


def _members(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    rows = payload.get("member") or payload.get("rdfs:member") or payload.get("members") or []
    return [row for row in rows if isinstance(row, dict)]


def _assets(rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    assets = []
    for row in rows:
        asset_num = _field(row, "assetnum", "assetNum")
        if not asset_num:
            continue
        assets.append({
            "assetNum": asset_num[:80],
            "description": _field(row, "description")[:300],
            "status": _field(row, "status")[:40],
            "location": _field(row, "location")[:80],
            "siteId": _field(row, "siteid", "siteId")[:40],
        })
    return assets


def _work_orders(rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    orders = []
    for row in rows:
        wo_num = _field(row, "wonum", "woNum")
        if not wo_num:
            continue
        orders.append({
            "woNum": wo_num[:80],
            "description": _field(row, "description")[:300],
            "status": _field(row, "status")[:40],
            "location": _field(row, "location")[:80],
            "siteId": _field(row, "siteid", "siteId")[:40],
        })
    return orders


def _headers(settings: dict[str, Any]) -> dict[str, str]:
    headers = {"Accept": "application/json", "User-Agent": "Northstar-Control-Room/1.0"}
    if settings["apiKey"]:
        headers["apikey"] = settings["apiKey"]
    elif settings["username"] and settings["password"]:
        import base64
        token = base64.b64encode(f"{settings['username']}:{settings['password']}".encode()).decode()
        headers["maxauth"] = token
    return headers


def _redact(text: str, settings: dict[str, Any]) -> str:
    cleaned = str(text or "")
    for secret in (settings.get("apiKey"), settings.get("password"), settings.get("username")):
        if secret:
            cleaned = cleaned.replace(secret, "[redacted]")
    return cleaned[:300]


def _oslc_where(station: dict[str, str]) -> str:
    location = station["maximoLocation"].replace('"', "")
    siteid = station["maximoSiteId"].replace('"', "")
    if siteid and location:
        return f'siteid="{siteid}" and location="{location}"'
    if location:
        return f'location="{location}"'
    return f'siteid="{siteid}"'


def _endpoint(settings: dict[str, Any], object_structure: str, station: dict[str, str]) -> str:
    base = settings["url"].rstrip("/") + "/"
    path = urljoin(base, f"os/{object_structure}")
    parsed = urlparse(path)
    if parsed.scheme != "https" or parsed.hostname != settings["host"]:
        raise ValueError("Maximo URL is not the configured HTTPS host")
    query = urlencode({
        "oslc.select": "assetnum,wonum,description,status,location,siteid",
        "oslc.where": _oslc_where(station),
        "oslc.pageSize": "50",
    })
    return f"{path}?{query}"


def _http_get(url: str, headers: dict[str, str]) -> dict[str, Any]:
    if _FETCH:
        return _FETCH(url, headers)
    request = Request(url, headers=headers, method="GET")
    with urlopen(request, timeout=FETCH_TIMEOUT) as response:
        if response.geturl():
            final = urlparse(response.geturl())
            allowed = urlparse(url)
            if final.hostname != allowed.hostname or final.scheme != "https":
                raise ValueError("Maximo redirected off the configured host")
        body = response.read(MAX_BODY + 1)
    if len(body) > MAX_BODY:
        raise ValueError("Maximo response exceeded the read limit")
    payload = json.loads(body.decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Maximo returned an unreadable object")
    return payload


def _read(object_structure: str, station: dict[str, str]) -> list[dict[str, Any]]:
    settings = config()
    url = _endpoint(settings, object_structure, station)
    try:
        payload = _http_get(url, _headers(settings))
    except HTTPError as exc:
        raise ValueError(_redact(f"Maximo returned HTTP {exc.code}", settings)) from exc
    except URLError as exc:
        raise ValueError(_redact(f"Maximo is unreachable: {exc.reason}", settings)) from exc
    except json.JSONDecodeError as exc:
        raise ValueError("Maximo returned unreadable JSON") from exc
    return _members(payload)


def station(site_id: str) -> dict[str, Any]:
    site_id = str(site_id or "").strip()
    if not site_id:
        raise ValueError("A library station id is required")
    settings = config()
    mapped = station_map(site_id)
    payload = {
        "station": mapped,
        "state": "Configured — not yet verified" if settings["configured"] else "Setup pending",
        "configured": settings["configured"],
        "connected": False,
        "readOnly": True,
        "note": CONFIG_NOTE,
        "assets": [],
        "workOrders": [],
        "fetchedAt": None,
    }
    if not settings["configured"]:
        return payload
    from datetime import datetime, timezone
    try:
        assets = _assets(_read(settings["assetObjectStructure"], mapped))
        work_orders = _work_orders(_read(settings["workOrderObjectStructure"], mapped))
    except ValueError as exc:
        payload["state"] = "failed"
        payload["error"] = _redact(str(exc), settings)
        return payload
    payload.update({
        "state": "connected",
        "connected": True,
        "assets": assets,
        "workOrders": work_orders,
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
    })
    return payload
