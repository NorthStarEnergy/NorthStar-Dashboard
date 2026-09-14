"""Read-only Maximo connection for generating-station library records.

Each library site is a Maximo query target (siteid + location). This module
does not write work orders, change asset status, or acknowledge alarms.

Credentials are local runtime configuration, never source. Configuration
alone is not a successful connection.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlparse
from urllib.request import Request, urlopen

import northstar_device_library as library

ROOT = Path(__file__).resolve().parent
CONFIG_NOTE = (
    "Maximo is the station asset source. This origin does not write work orders, "
    "change asset status, or acknowledge alarms."
)
DEFAULT_ASSET_OS = "mxapiasset"
DEFAULT_WO_OS = "mxapiwo"
MAX_BODY = 1_000_000
FETCH_TIMEOUT = 15

_FETCH: Callable[[str, dict[str, str]], dict[str, Any]] | None = None


def config_path() -> Path:
    override = os.environ.get("NORTHSTAR_MAXIMO_CONFIG", "").strip()
    if override:
        return Path(override).expanduser()
    return ROOT / "data" / ".northstar-maximo.json"


def _strip_secret(value: str) -> str:
    return str(value or "").strip()


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
