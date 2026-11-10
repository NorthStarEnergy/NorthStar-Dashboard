"""Northstar local web server and resilient IESO market-data adapter."""

from __future__ import annotations

import csv
import hashlib
import io
import json
import mimetypes
import os
import posixpath
import re
import socket
import sys
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, unquote, urlparse
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

import northstar_demo_roster as demo_roster
import northstar_store as store
import northstar_phase1 as phase1
import northstar_voice as voice
import northstar_auth as auth
import northstar_shelf as shelf
import northstar_shelf_mobile as shelf_mobile
import northstar_scada_workbench as scada_workbench
import northstar_client_release as client_release
import northstar_events as events
import northstar_event_register as event_register
import northstar_console as operations_console
import northstar_operator_knowledge as operator_knowledge
import northstar_ai as ai
import northstar_ai_history as ai_history
import northstar_crew_profile as crew_profile
import northstar_station_popup_profile as station_popup_profile
import northstar_chat as chat
import northstar_avatars as avatars
import northstar_microsoft as microsoft
import northstar_graph as graph
import northstar_dispatch as dispatch
import northstar_device_library as device_library
import northstar_sop_library as sop_library
import northstar_flows as flows
import northstar_services as services
import northstar_inflow as inflow
import northstar_water_elevations as water_elevations
import northstar_incident_library as incident_library
import northstar_maximo as maximo
import northstar_service_requests as service_requests
import northstar_sites as sites
import northstar_uwpc as uwpc
import northstar_uwpc_desk as uwpc_desk  # Form/export definitions are loaded at backend startup.
import northstar_data_catalog as data_catalog
import northstar_data_workspace as data_workspace
import northstar_water_collection as water_collection
import northstar_daily_report as daily_report
import northstar_market_history as market_history
import northstar_ieso_advisories as ieso_advisories
import northstar_ieso_streams as ieso_streams
import northstar_ieso_streams as ieso_streams
from northstar_paths import app_root

ROOT = app_root(__file__)

def _load_local_env() -> None:
    env_path = ROOT / ".env.local"
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        key, separator, value = raw.partition("=")
        if separator and key.strip() and key.strip() not in os.environ:
            os.environ[key.strip()] = value.strip().strip('"').strip("'")

_load_local_env()
HOST = os.environ.get("NORTHSTAR_BIND_HOST", "127.0.0.1").strip()
PORT = int(os.environ.get("NORTHSTAR_PORT", "4180"))
TZ = ZoneInfo("America/Toronto")
IESO_ROOT = "https://reports-public.ieso.ca/public"
REFRESH_SECONDS = 300
OVERDUE_SCAN_SECONDS = 30
SCADA_POLL_SECONDS = max(15, int(os.environ.get("NORTHSTAR_SCADA_POLL_SECONDS", "60")))
FLOW_REFRESH_SECONDS = max(60, int(os.environ.get("NORTHSTAR_FLOW_REFRESH_SECONDS", "300")))
DISPATCH_TICK_SECONDS = max(3, int(os.environ.get("NORTHSTAR_DISPATCH_TICK_SECONDS", "5")))
VOICE_POLL_SECONDS = max(15, int(os.environ.get("NORTHSTAR_VOICE_POLL_SECONDS", "45")))
MAX_JSON_BODY = 64 * 1024
MAX_SWITCHING_BUNDLE_BYTES = 100 * 1024 * 1024


def _setup_demo_auth_from_stdin(username: str) -> int:
    """Create the local demo verifier for the packaged desktop first run."""
    username = username.strip()
    if not username or len(username) > 80 or any(char in username for char in "\r\n"):
        print("Username must be between 1 and 80 characters.", file=sys.stderr)
        return 1
    target = auth.config_path()
    if target.exists():
        print("A demo operator credential is already configured.", file=sys.stderr)
        return 1
    password = sys.stdin.readline().rstrip("\r\n")
    if len(password) < 8 or len(password) > 256:
        print("Password must be between 8 and 256 characters.", file=sys.stderr)
        return 1
    try:
        auth.save_config(auth.build_config(username, password))
    except (OSError, auth.AuthConfigError, ValueError) as exc:
        print(f"Could not save the demo operator credential: {exc}", file=sys.stderr)
        return 1
    finally:
        password = ""
    return 0


def build_switching_bundle(snapshot: dict[str, Any]) -> tuple[bytes, str]:
    """Build a bounded, self-verifying export without creating a release artifact."""
    package = snapshot["package"]
    attachments = snapshot.get("attachments", [])
    source_bytes = sum(len(item.get("content", b"")) for item in attachments)
    if source_bytes > MAX_SWITCHING_BUNDLE_BYTES:
        raise ValueError("controlled bundle exceeds 100 MB")
    manifest_sources = []
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for item in attachments:
            folder = "diagrams" if item.get("kind") == "diagram" else "governing-sources"
            filename = f"{item['attachmentId']}-{item['name']}"
            path = posixpath.join("sources", folder, filename)
            archive.writestr(path, item["content"])
            manifest_sources.append(
                {
                    "path": path,
                    "attachmentId": item["attachmentId"],
                    "kind": item["kind"],
                    "name": item["name"],
                    "contentType": item["type"],
                    "sizeBytes": item["size"],
                    "sha256": item["sha256"],
                }
            )
        manifest = {
            "schema": 1,
            "generatedAt": datetime.now(TZ).isoformat(),
            "draftId": package["id"],
            "status": package["status"],
            "terminalNonRelease": package["status"] == store.SWITCHING_REVIEWED,
            "sourceManifestDigest": package.get("sourceManifestDigest", ""),
            "attachmentCount": len(manifest_sources),
            "attachmentBytes": source_bytes,
            "sources": manifest_sources,
            "notice": "Evidence package only. Not an operational release or equipment command.",
        }
        archive.writestr(
            "package.json",
            json.dumps(package, ensure_ascii=False, indent=2, sort_keys=True),
        )
        archive.writestr(
            "review-evidence.json",
            json.dumps(snapshot["reviewEvidence"], ensure_ascii=False, indent=2, sort_keys=True),
        )
        archive.writestr(
            "bundle-manifest.json",
            json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True),
        )
    body = buffer.getvalue()
    return body, hashlib.sha256(body).hexdigest()

# Wildcard suits localhost development. A public deployment should pin this to
# the check-in hostname; the operator gate below is what actually protects the
# sensitive routes, so this is defence in depth rather than the lock itself.
# Keep the singular name as a compatibility seam for the dashboard/tests while
# accepting the comma-separated deployment setting used by the public hosts.
ALLOWED_ORIGIN = os.environ.get("NORTHSTAR_ALLOWED_ORIGIN", "*").strip().rstrip("/")
ALLOWED_ORIGINS = {
    origin.strip().rstrip("/")
    for origin in ALLOWED_ORIGIN.split(",")
    if origin.strip()
}

# Routes that expose the operator surface: the roster with worker PII and live
# GPS, the site QR tokens that authorise a check-in, and the operational log.
# Method matters — GET /api/checkins is the roster, POST /api/checkins is a
# worker checking themselves in. Anything not listed here, including the
# /api/checkins/<id>/... device routes and token resolution, stays open.
OPERATOR_ROUTES = {
    "/api/market-history": ("GET",),
    "/api/ieso-streams": ("GET",),
    "/api/ieso-report": ("GET",),
    "/api/ieso-streams": ("GET",),
    "/api/ieso-report": ("GET",),
    "/api/control-center/status": ("GET",),
    "/api/dashboard-layout-default": ("POST",),
    "/api/profile/crew-layout": ("GET", "POST"),
    "/api/profile/station-popup": ("GET", "POST"),
    "/api/checkins": ("GET",),
    "/api/checkins/history": ("GET",),
    "/api/checkin-tokens": ("GET", "POST"),
    "/api/logbook": ("GET", "POST"),
    "/api/client-release": ("GET",),
    "/api/events": ("GET",),
    "/api/events/register": ("GET",),
    "/api/events/detail": ("GET",),
    "/api/events/sources": ("GET",),
    "/api/events/notes": ("POST",),
    "/api/outages": ("GET", "POST"),
    "/api/outages/history": ("GET",),
    "/api/alerts": ("GET",),
    "/api/alerts/settings": ("GET", "POST"),
    "/api/market-alarm-rules": ("GET", "POST"),
    "/api/alerts/history": ("GET",),
    "/api/alerts/clear": ("POST",),
    "/api/scada": ("GET",),
    "/api/scada/readings": ("GET",),
    "/api/scada/import": ("POST",),
    "/api/flows": ("GET",),
    "/api/services": ("GET", "POST"),
    "/api/inflows/status": ("GET",),
    "/api/inflows/runs": ("GET",),
    "/api/inflows/run": ("GET",),
    "/api/inflows/refresh": ("POST",),
    "/api/water-elevations": ("GET",),
    "/api/water-elevations/catalog": ("GET",),
    "/api/water-management/catalog": ("GET",),
    "/api/data-catalog": ("GET",),
    "/api/data-catalog/refresh": ("POST",),
    "/api/water-management/rows": ("GET",),
    "/api/water-management/files": ("GET",),
    "/api/water-management/ingest": ("POST",),
    "/api/water-management/rows": ("GET",),
    "/api/water-management/ingest": ("POST",),
    "/api/daily-operations": ("GET", "POST"),
    "/api/daily-operations/catalog": ("GET",),
    "/api/daily-operations/history": ("GET",),
    "/api/unit-cycling": ("GET", "POST"),
    "/api/unit-cycling/catalog": ("GET",),
    "/api/unit-cycling/summary": ("GET",),
    "/api/water-observations": ("GET", "POST"),
    "/api/water-observations/catalog": ("GET",),
    "/api/water-observations/summary": ("GET",),
    "/api/service-requests": ("GET",),
    "/api/service-requests/catalog": ("GET",),
    "/api/incident-library": ("GET",),
    "/api/incident-library/catalog": ("GET",),
    "/api/retention": ("GET", "POST"),
    "/api/site-policies": ("GET", "POST"),
    "/api/switching/drafts": ("GET", "POST"),
    "/api/uwpc/requests": ("GET", "POST"),
    "/api/field-reports": ("GET", "POST"),
    "/api/field-reports/history": ("GET",),
    "/api/action-items": ("GET", "POST"),
    "/api/field-operations/summary": ("GET",),
    "/api/readiness": ("GET",),
    "/api/controlled-sources": ("GET", "POST"),
    "/api/assets": ("GET", "POST"),
    "/api/schematics": ("GET", "POST"),
    # Voice content is recorded speech: worker names, locations, and whatever
    # else was said on an open channel. Operator-only, all of it.
    "/api/voice": ("GET",),
    "/api/voice/recordings": ("GET",),
    "/api/voice/scan": ("POST",),
    "/api/voice/upload": ("POST",),
    "/api/library": ("GET",),
    "/api/library/item": ("GET",),
    "/api/library/notes": ("POST",),
    "/api/library/procedures": ("GET",),
    "/api/maximo": ("GET",),
    "/api/maximo/equipment": ("GET",),
    "/api/maximo/station": ("GET",),
    "/api/sites": ("GET",),
    "/api/uwpc": ("GET",),
    "/api/uwpc/book": ("GET",),
    "/api/ai": ("POST",),
    "/api/ai/query": ("POST",),
    "/api/ai/knowledge": ("GET",),
    "/api/ai/knowledge/search": ("GET",),
    "/api/ai/knowledge/upload": ("POST",),
    "/api/ai/status": ("GET",),
    "/api/ai/workspace": ("GET",),
    "/api/ai/conversations": ("POST",),
    "/api/ai/projects": ("POST",),
    "/api/chat/rooms": ("GET",),
    "/api/avatars": ("GET",),
    "/api/profile/avatar": ("GET", "POST"),
    "/api/chat/messages": ("GET", "POST"),
    "/api/chat/status": ("GET",),
    "/api/chat/teams/pull": ("POST",),
    "/api/microsoft/outlook/status": ("GET",),
    "/api/microsoft/graph/status": ("GET",),
    "/api/microsoft/graph/connect": ("POST",),
    "/api/microsoft/graph/profile": ("GET",),
    "/api/microsoft/graph/messages": ("GET",),
    "/api/dispatch/apiroq": ("GET",),
}

# The table above matches exact paths, which left every /api/<thing>/<id>/<action>
# sub-route open. Some of those are operator actions: acknowledging or resolving
# a help request, confirming a provisional check-in, adjusting expected time,
# closing an outage. Until 2026-08-11 they were reachable unauthenticated from
# the public check-in hostname, so anyone holding a check-in id could clear a
# lone worker's distress call from the control room's view.
#
# Worker device routes must NOT appear here: GET /api/checkins/<id>, its
# heartbeat, its DELETE checkout, and POST /api/checkins/<id>/help (the worker
# raising the alarm) all stay open by design.
OPERATOR_ROUTE_PATTERNS = (
    *((method, re.compile(r"^/api/training/switching(?:/.*)?$"))
      for method in ("GET", "POST")),
    *((method, re.compile(r"^/(?:api/shelf|shelf)(?:/.*)?$"))
      for method in ("GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS")),
    ("GET", re.compile(r"^/api/water-collection(?:/.*)?$")),
    ("POST", re.compile(r"^/api/water-collection(?:/.*)?$")),
    ("GET", re.compile(r"^/api/daily-report(?:/.*)?$")),
    ("POST", re.compile(r"^/api/daily-report(?:/.*)?$")),
    ("GET", re.compile(r"^/api/data-workspace(?:/.*)?$")),
    ("POST", re.compile(r"^/api/data-workspace(?:/.*)?$")),
    ("GET", re.compile(r"^/api/console(?:/.*)?$")),
    ("POST", re.compile(r"^/api/console(?:/.*)?$")),
    ("PATCH", re.compile(r"^/api/console(?:/.*)?$")),
    ("GET", re.compile(r"^/api/ai/knowledge/records/(?:device_library_notes|logbook|outages)/[^/]+$")),
    ("GET", re.compile(r"^/api/ai/knowledge/sources/[^/]+(?:/file)?$")),
    ("POST", re.compile(r"^/api/ai/knowledge/sources/[^/]+/review$")),
    ("POST", re.compile(r"^/api/checkins/[^/]+/(time|provisional|help/acknowledge|help/resolve)$")),
    ("POST", re.compile(r"^/api/outages/[^/]+/close$")),
    ("GET", re.compile(r"^/api/switching/drafts/.+$")),
    ("GET", re.compile(r"^/api/uwpc/requests/.+$")),
    ("POST", re.compile(r"^/api/uwpc/requests/.+$")),
    ("POST", re.compile(r"^/api/switching/drafts/.+$")),
    ("DELETE", re.compile(r"^/api/switching/drafts/[^/]+/attachments/[^/]+$")),
    ("GET", re.compile(r"^/api/schematics/.+$")),
    ("POST", re.compile(r"^/api/schematics/[^/]+$")),
    ("GET", re.compile(r"^/api/field-reports/[^/]+$")),
    ("POST", re.compile(r"^/api/field-reports/[^/]+/status$")),
    ("POST", re.compile(r"^/api/field-reports/[^/]+/updates$")),
    ("GET", re.compile(r"^/api/field-reports/[^/]+/attachments$")),
    ("POST", re.compile(r"^/api/field-reports/[^/]+/attachments$")),
    ("GET", re.compile(r"^/api/field-reports/[^/]+/attachments/[^/]+$")),
    ("GET", re.compile(r"^/api/library/procedures/[a-z0-9-]+/file$")),
    ("GET", re.compile(r"^/api/daily-operations/[^/]+$")),
    ("POST", re.compile(r"^/api/daily-operations/[^/]+/draft$")),
    ("POST", re.compile(r"^/api/daily-operations/[^/]+/publish$")),
    ("POST", re.compile(r"^/api/action-items/[^/]+/status$")),
    ("POST", re.compile(r"^/api/governance-decisions/[^/]+$")),
    ("GET", re.compile(r"^/api/voice/recordings/.+$")),
    ("POST", re.compile(r"^/api/voice/segments/[^/]+/review$")),
    ("GET", re.compile(r"^/api/ai/conversations/[^/]+$")),
    ("POST", re.compile(r"^/api/ai/conversations/[^/]+/project$")),
    ("POST", re.compile(r"^/api/ai/conversations/[^/]+/archive$")),
    ("POST", re.compile(r"^/api/ai/conversations/[^/]+/settings$")),
    ("POST", re.compile(r"^/api/ai/messages/[^/]+/feedback$")),
)

# Reviewed research is shared with every signed-in account. Downloads are
# embedded in catalog.js; this exact list grants no access to arbitrary files.
SHARED_RESEARCH_ROUTES = frozenset({
    "/research.html", "/research-session.js", "/research-workspace.js",
    "/research-workspace.css", "/research/catalog.js",
})
OPERATOR_ROUTES.update({route: ("GET", "HEAD") for route in SHARED_RESEARCH_ROUTES})

# A site viewer is intentionally not a reduced operator.  Once that account is
# signed in, every API is denied by default except its session controls and the
# deliberately minimal site-name directory below.  This protects routes added
# in the future without relying on a UI to remember to hide them.
DEMO_VIEWER_API_ROUTES = {
    ("GET", "/api/auth/session"),
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/logout"),
    ("GET", "/api/sites"),
}
DEMO_VIEWER_ENTRYPOINTS = {
    "/",
    "/index.html",
    "/northstar-clean.html",
    "/operator-login.html",
    "/operator-mobile.html",
    "/demo-sites.html",
}

PLATFORM_DEMO_BLOCKED_API_PREFIXES = (
    "/api/services",
    "/service-controls.html",
    "/api/inflows",
    "/api/checkins",
    "/api/checkin-tokens",
    "/api/outages",
    "/api/scada",
    "/api/switching",
    "/api/uwpc/requests",
    "/api/daily-operations",
    "/api/unit-cycling",
    "/api/water-observations",
    "/api/service-requests",
    "/api/incident-library",
    "/api/retention",
    "/api/site-policies",
    "/api/field-reports",
    "/api/action-items",
    "/api/field-operations",
    "/api/readiness",
    "/api/controlled-sources",
    "/api/assets",
    "/api/library",
    "/api/maximo",
    "/api/voice",
    "/api/dashboard-layout-default",
    "/api/profile/crew-layout",
    "/api/profile/station-popup",
)
# Demo may pull and review report drafts on demand, but not alter schedules.
PLATFORM_DEMO_REPORT_ROUTES = frozenset({
    ('GET', '/api/daily-report/status'), ('GET', '/api/daily-report/run'),
    ('GET', '/api/daily-report/file'), ('POST', '/api/daily-report/refresh'),
})
PLATFORM_DEMO_API_ROUTES = {
    ('GET', route) for route, methods in OPERATOR_ROUTES.items()
    if 'GET' in methods and not any(route == prefix or route.startswith(prefix + '/')
        for prefix in PLATFORM_DEMO_BLOCKED_API_PREFIXES)
    and not route.startswith(('/api/ai', '/api/microsoft', '/api/chat'))
} | {
    ('GET', '/api/auth/session'), ('POST', '/api/auth/logout'),
    ('GET', '/api/checkins'), ('GET', '/api/weather'), ('GET', '/api/market-prices'),
    ('GET', '/api/health'), ('GET', '/api/ai/status'),
}
PLATFORM_DEMO_API_ROUTES.update(PLATFORM_DEMO_REPORT_ROUTES)
PLATFORM_DEMO_ENTRYPOINTS = {'/', '/index.html', '/northstar-clean.html', '/platform-demo.html'}
# Frozen asset manifest: loading the shared shell does not open arbitrary files.
PLATFORM_DEMO_STATIC_ROUTES = PLATFORM_DEMO_ENTRYPOINTS | frozenset(json.loads(
    (Path(__file__).resolve().parent / 'demo-menu-assets.json').read_text(encoding='utf-8')))

# Demo uses the same canonical station identities and labels as operators.
PLATFORM_DEMO_STATION_NAMES = {row["id"]: row["name"] for row in sites.known()}
PLATFORM_DEMO_STATION_REPLACEMENTS = {}

# QR placards are printed once and mounted at a site gate, so the link they
# carry must be the public check-in hostname — never whichever origin the
# operator happened to open the generator from. Empty falls back to that origin.
CHECKIN_ORIGIN = os.environ.get("NORTHSTAR_CHECKIN_ORIGIN", "").strip().rstrip("/")

# The public check-in hostname carries the worker app and nothing else.
#
# The operator gate decides who may read the roster; this list decides what
# exists on `checkin.northstarenergy.ca` at all. Without it the hostname is a
# public mirror of the operator application: the dashboard HTML and every script
# it loads, the login page, the market and weather feeds — all reachable with no
# login, because they are not operator routes and the static tree is shared.
#
# The Cloudflare ingress rule says the same thing (see cloudflared-config.yml),
# but that rule lives in the Zero Trust dashboard, which this process cannot
# read and an operator can change in a browser. A tunnel edited by hand must not
# be able to widen the public surface on its own, so the origin states the
# contract too. Operator routes are refused by the gate *before* this check, so
# they keep answering 403 — a deliberate refusal, not a "no such thing".
#
# Anything added here is published to the open internet. Worker routes only.
CHECKIN_PUBLIC_ROUTES = {
    "/contractor-checkin.html",  # the worker PWA itself
    "/manifest.webmanifest",
    "/sw.js",
    "/favicon.ico",
    "/favicon.png",
    "/api/health",  # liveness only on this hostname; see public_health()
    "/api/checkins",  # POST is a worker checking in; GET is the roster, gated
    "/api/checkin-tokens/resolve",  # the placard QR the worker just scanned
    "/api/phone-verifications",
}

# Prefixes for the worker's own per-record routes: read/heartbeat/help/checkout
# on `/api/checkins/<id>`, phone verification, and the PWA's icons. Operator
# sub-routes under `/api/checkins/<id>/` (help/acknowledge, help/resolve,
# provisional, time) match here too and are refused by the gate above.
CHECKIN_PUBLIC_PREFIXES = (
    "/api/checkins/",
    "/api/phone-verifications/",
    "/icons/",
)

# Static files come from the project directory, which also holds the SQLite
# database, the QR signing secret, backups, logs, source and handoff archives.
# None of that is a web asset. Production binds to loopback.
# A LAN caller cannot bypass the Cloudflare Access and operator-gate layers.
# Serve a browser what it needs and nothing else.
STATIC_DENY_DIRS = {
    "data", "tests", "handoff", "tmp", "output", "dist", "drizzle", "db",
    "__pycache__", "scripts", "control-room-dashboard", "node_modules",
}
STATIC_ALLOW_SUFFIXES = {
    ".html", ".js", ".css", ".map", ".webmanifest",
    ".png", ".ico", ".svg", ".jpg", ".jpeg", ".gif", ".webp",
    ".woff", ".woff2", ".ttf",
}

# "off" keeps the localhost development behaviour. "access" requires the header
# Cloudflare Access injects once a user has authenticated at the edge, so the
# operator surface stays unreachable on the public check-in hostname. "demo" is
# the Packet 19 gate: a single owner-supplied credential, verified here, with a
# server-side session. It is a distinct third mode on purpose — running the demo
# login must never mean setting this to "off".
OPERATOR_GATE = os.environ.get("NORTHSTAR_OPERATOR_GATE", "off").strip().lower()

# The hostname the operator dashboard is published on. The demo login endpoint
# and the demo session exist only here; the check-in hostname must not offer a
# second way to create an operator session.
OPERATOR_HOST = os.environ.get("NORTHSTAR_OPERATOR_HOST", "northstarenergy.ca").strip().lower()

# Demo credentials are local runtime configuration, not source: see
# northstar_auth.config_path() and scripts/setup-demo-auth.py. Loading is
# tolerant here and fatal at startup — an import-time crash would take the
# public check-in surface down with it, and __main__ refuses to serve anyway.
try:
    DEMO_AUTH: dict[str, Any] | None = auth.load_config()
    DEMO_AUTH_ERROR: str = ""
except auth.AuthConfigError as exc:
    DEMO_AUTH, DEMO_AUTH_ERROR = None, str(exc)

DEMO_SESSIONS = auth.SessionStore()
DEMO_LOGIN_THROTTLE = auth.LoginThrottle(
    max_failures=max(1, int(os.environ.get("NORTHSTAR_DEMO_LOGIN_MAX_FAILURES", "5"))),
    window_seconds=max(60, int(os.environ.get("NORTHSTAR_DEMO_LOGIN_WINDOW_SECONDS", "900"))),
)


class APIError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


DASHBOARD_LAYOUT_PATH = ROOT / "data" / "dashboard-layout-default.json"
DASHBOARD_LAYOUT_SCRIPT = ROOT / "dashboard-layout-default.js"
DASHBOARD_LAYOUT_ZONES = {
    "overview", "staff", "market", "marketTop", "marketDetail",
    "weather", "weatherStrip", "switching",
}


def _layout_number(value: Any, low: int = -10000, high: int = 10000) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = int(round(value))
    return number if low <= number <= high else None


def normalize_dashboard_layout(payload: dict[str, Any]) -> dict[str, Any]:
    raw_layout = payload.get("layout")
    if not isinstance(raw_layout, dict):
        raise APIError(400, "layout must be an object")
    layout: dict[str, Any] = {}
    for zone_id, raw_zone in raw_layout.items():
        if zone_id not in DASHBOARD_LAYOUT_ZONES or not isinstance(raw_zone, dict):
            continue
        zone: dict[str, Any] = {"order": [], "size": {}, "position": {}}
        raw_order = raw_zone.get("order", [])
        if isinstance(raw_order, list):
            zone["order"] = [str(item)[:100] for item in raw_order[:100]]
        for field, names in (("size", ("w", "h")), ("position", ("x", "y", "w", "h"))):
            raw_items = raw_zone.get(field, {})
            if not isinstance(raw_items, dict):
                continue
            for key, raw_rect in list(raw_items.items())[:100]:
                if not isinstance(raw_rect, dict):
                    continue
                rect = {name: _layout_number(raw_rect.get(name)) for name in names}
                if all(value is not None for value in rect.values()):
                    zone[field][str(key)[:100]] = rect
        layout[zone_id] = zone
    preferences = payload.get("preferences", {})
    if not isinstance(preferences, dict):
        preferences = {}
    clean_preferences = {}
    for key in ("tabOrder", "closedOverview"):
        values = preferences.get(key, [])
        clean_preferences[key] = [str(item)[:100] for item in values[:100]] if isinstance(values, list) else []
    saved = {"layout": layout, "preferences": clean_preferences, "captureRequested": False}
    status_layout = payload.get("statusLayout")
    if status_layout is not None:
        if not isinstance(status_layout, dict) or not isinstance(status_layout.get("profiles"), dict):
            raise APIError(400, "statusLayout must contain a profiles object")
        clean_profiles: dict[str, Any] = {}
        allowed_profiles = {"wide", "desktop", "laptop", "narrow"}
        allowed_modules = {"events", "dispatch", "markets", "crew"}
        for profile, raw_profile in list(status_layout["profiles"].items())[:4]:
            if profile not in allowed_profiles or not isinstance(raw_profile, dict):
                continue
            height = _layout_number(raw_profile.get("height"), 1, 5000)
            raw_modules = raw_profile.get("modules")
            if height is None or not isinstance(raw_modules, dict):
                raise APIError(400, "Invalid fixed dashboard profile")
            modules: dict[str, Any] = {}
            for key in allowed_modules:
                raw_box = raw_modules.get(key)
                if not isinstance(raw_box, dict):
                    raise APIError(400, "Fixed dashboard profile is missing a module")
                box = {
                    "x": _layout_number(raw_box.get("x"), 0, 10000),
                    "y": _layout_number(raw_box.get("y"), 0, 10000),
                    "w": _layout_number(raw_box.get("w"), 1, 5000),
                    "h": _layout_number(raw_box.get("h"), 1, 5000),
                }
                if any(value is None for value in box.values()):
                    raise APIError(400, "Invalid fixed dashboard module bounds")
                modules[key] = box
            clean_profiles[profile] = {"height": height, "modules": modules}
        saved["statusLayout"] = {"profiles": clean_profiles}
    workspace = payload.get("moduleWorkspace")
    if workspace is not None:
        if not isinstance(workspace, dict) or not isinstance(workspace.get("sections"), dict) or not isinstance(workspace.get("modules"), dict):
            raise APIError(400, "moduleWorkspace must contain sections and modules objects")
        if len(json.dumps(workspace, separators=(",", ":"), ensure_ascii=True).encode("utf-8")) > MAX_JSON_BODY - 4096:
            raise APIError(413, "moduleWorkspace is too large")
        saved["moduleWorkspace"] = workspace
    owner = payload.get("moduleWorkspaceOwner")
    if isinstance(owner, str) and owner.strip():
        saved["moduleWorkspaceOwner"] = owner.strip()[:160]
    if "layoutStorage" in payload:
        values = payload["layoutStorage"]
        allowed = {"northstarModuleLayout", "northstarOverviewProfilesV2", "northstarCanvasLayoutV1",
                   "northstarStatusLayoutV1", "northstarModuleWorkspaceV1", "northstarAssetEditorV1",
                   "northstarTabOrder", "northstarClosedOverviewModules", "northstarUiStyle",
                   "northstarFixedMarketBorderStyleV1"}
        if not isinstance(values, dict) or any(key not in allowed or (value is not None and not isinstance(value, str)) for key, value in values.items()):
            raise APIError(400, "Invalid dashboard layout storage")
        saved["layoutStorage"] = values
    return saved


def write_dashboard_layout_default(value: dict[str, Any]) -> None:
    DASHBOARD_LAYOUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(value, separators=(",", ":"), ensure_ascii=True)
    temp = DASHBOARD_LAYOUT_PATH.with_suffix(".tmp")
    temp.write_text(encoded + "\n", encoding="utf-8")
    temp.replace(DASHBOARD_LAYOUT_PATH)
    bootstrap = (
        "window.NORTHSTAR_LAYOUT_DEFAULT=" + encoded + ";\n"
        """(() => {
  if (window.NorthstarLayoutPersistence) { window.NorthstarLayoutPersistence.bootstrap(window.NORTHSTAR_LAYOUT_DEFAULT || {}); return; }
  const d = window.NORTHSTAR_LAYOUT_DEFAULT || {};
  const p = d.preferences || {};
  const recoveryId = '20261004-layout-recovery-1';
  const statusRecoveryId = '20261007-fixed-dispatch-recovery-1';
  const staffKey = 'canvas:overview:overviewStaff';
  const twinKey = 'canvas:stations:site:twin-falls';
  const raw = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const read = key => { try { return JSON.parse(raw(key) || 'null'); } catch { return null; } };
  const write = (key, value) => { try { if (value != null) localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  const remove = key => { try { localStorage.removeItem(key); } catch {} };
  const clone = value => { try { return JSON.parse(JSON.stringify(value)); } catch { return {}; } };
  const near = (value, expected, tolerance) => Math.abs(Number(value) - expected) <= tolerance;
  const positionsOf = value => value?.overview?.position || value?.positions || value || {};
  const regressed = value => {
    const positions = positionsOf(value);
    const staff = positions?.[staffKey], twin = positions?.[twinKey];
    return staff && twin
      && near(staff.x, 548, 32) && near(staff.y, 1038, 32) && near(staff.w, 548, 8) && near(staff.h, 260, 8)
      && near(twin.x, 256, 32) && near(twin.y, 324, 32) && near(twin.w, 90, 8) && near(twin.h, 70, 8);
  };
  const profilesRegressed = profiles => Object.values(profiles || {}).some(regressed);
  const staleStatusLayout = value => {
    const desktop = value?.profiles?.desktop;
    const modules = desktop?.modules || {};
    const crew = modules.crew, events = modules.events, dispatch = modules.dispatch, markets = modules.markets;
    const box = (item, x, y, w, h) => item
      && near(item.x, x, 2) && near(item.y, y, 2) && near(item.w, w, 2) && near(item.h, h, 2);
    return Object.keys(value?.profiles || {}).length === 1
      && near(desktop?.height, 113, 2)
      && box(crew, 2, 0, 342, 112)
      && box(events, 346, 0, 369, 112)
      && box(dispatch, 717, 0, 300, 112)
      && (box(markets, 1019, 1, 300, 112) || box(markets, 896, 1, 300, 112));
  };
  const seedStatusLayout = () => {
    if (!d.statusLayout?.profiles) return;
    ['northstarStatusLayoutV1', 'northstarStatusLayoutV1Saved'].forEach(key => {
      const current = read(key);
      if (current && !staleStatusLayout(current)) return;
      const value = raw(key), backup = `${key}:${statusRecoveryId}`;
      try { if (value != null && raw(backup) == null) localStorage.setItem(backup, value); } catch {}
      write(key, d.statusLayout);
    });
  };
  const layoutKeys = [
    'northstarModuleLayout', 'northstarModuleLayoutSaved',
    'northstarCanvasLayoutV1', 'northstarCanvasLayoutV1Saved',
    'northstarOverviewProfilesV2', 'northstarOverviewProfilesV2Saved',
  ];
  const mustRecover = regressed(read('northstarModuleLayout'))
    || regressed(read('northstarCanvasLayoutV1'))
    || profilesRegressed(read('northstarOverviewProfilesV2'))
    || profilesRegressed(read('northstarOverviewProfilesV2Saved'));
  if (mustRecover) {
    layoutKeys.forEach(key => {
      const value = raw(key), backup = `${key}:${recoveryId}`;
      try { if (value != null && raw(backup) == null) localStorage.setItem(backup, value); } catch {}
      remove(key);
    });
  }
  const seed = clone(d.layout || {});
  if (regressed(seed) && seed.overview) seed.overview.position = {};
  if (raw('northstarModuleLayout') == null) write('northstarModuleLayout', seed);
  if (raw('northstarTabOrder') == null) write('northstarTabOrder', p.tabOrder || []);
  const closedOverviewKey = 'northstarClosedOverviewModules';
  if (raw(closedOverviewKey) == null) write(closedOverviewKey, p.closedOverview || []);
  // Weather cards are part of the Overview baseline. Clear any older removal
  // flags for cards present in the shared layout so they cannot stay hidden in
  // a browser that already had a local closed-module list.
  const weatherPrefix = 'canvas:weather:';
  const weatherIds = new Set(Object.keys(seed.overview?.position || {})
    .filter(key => key.startsWith(weatherPrefix)).map(key => key.slice(weatherPrefix.length)));
  const closedOverview = read(closedOverviewKey);
  if (Array.isArray(closedOverview) && closedOverview.some(id => weatherIds.has(id))) {
    write(closedOverviewKey, closedOverview.filter(id => !weatherIds.has(id)));
  }
  seedStatusLayout();
  if (d.moduleWorkspace) {
    const key = 'northstarModuleWorkspaceV1';
    const apply = account => {
      if (!raw(key) || String(account?.username || '').toLowerCase() === String(d.moduleWorkspaceOwner || '').toLowerCase()) write(key, d.moduleWorkspace);
    };
    if (window.northstarOperatorSession) window.northstarOperatorSession.then(apply).catch(() => {});
    else if (!raw(key)) apply({});
  }
  if (d.captureRequested) {
    const layout = read('northstarModuleLayout');
    if (layout && Object.keys(layout).length) fetch('/api/dashboard-layout-default', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({layout, preferences: {tabOrder: read('northstarTabOrder') || [], closedOverview: read('northstarClosedOverviewModules') || []}}),
    }).catch(() => {});
  }
})();
"""
    )
    script_temp = DASHBOARD_LAYOUT_SCRIPT.with_suffix(".tmp")
    script_temp.write_text(bootstrap, encoding="utf-8")
    script_temp.replace(DASHBOARD_LAYOUT_SCRIPT)


def demo_session_seconds() -> int:
    return int((DEMO_AUTH or {}).get("sessionSeconds", auth.DEFAULT_SESSION_SECONDS))


def demo_username() -> str:
    return str((DEMO_AUTH or {}).get("username", "ron"))


REPORTS = {
    "rt_energy": ("RealtimeEnergyLMP", "PUB_RealtimeEnergyLMP.csv"),
    "da_energy": ("DAHourlyEnergyLMP", "PUB_DAHourlyEnergyLMP.csv"),
    "rt_reserve": ("RealtimeORLMP", "PUB_RealtimeORLMP.csv"),
    "da_reserve": ("DAHourlyORLMP", "PUB_DAHourlyORLMP.csv"),
    "rt_totals": ("RealtimeTotals", "PUB_RealtimeTotals.csv"),
    "predisp_totals": ("PredispTotals", "PUB_PredispTotals.csv"),
    "predisp_energy": ("PredispHourlyEnergyLMP", "PUB_PredispHourlyEnergyLMP.csv"),
}

WEATHER_STATIONS = {
    "Iroquois Falls": (48.7669, -80.6830),
    "Atikokan": (48.7569, -91.6217),
    "Kapuskasing": (49.4200, -82.4300),
    "Oshawa": (43.9000, -78.8600),
    "Toronto": (43.6500, -79.3800),
    "Fort Frances": (48.6100, -93.4000),
    "Dokis FN": (46.1700, -80.0400),
    "Kenora": (49.7670, -94.4890),
    "Lachute": (45.6500, -74.3300),
    "Lake Abitibi": (48.6581, -79.8448),
}
WEATHER_CACHE: dict[str, Any] = {
    "updated": None,
    "stations": [],
    "stale": False,
    "error": None,
    "retryAfter": None,
}
WEATHER_LOCK = threading.Lock()
WEATHER_CACHE_TTL_SECONDS = 10 * 60
WEATHER_MAX_RETRIES = 3
ECCC_WEATHER_URL = "https://api.weather.gc.ca/collections/swob-realtime/items"
ECCC_BBOX_RADIUS_DEGREES = 1.0

NODE_PATTERNS = {
    "APIROQ": re.compile(r"^APIROQFALLS-LT\.AG4$", re.I),
    "M1S": re.compile(
        r"^(CALMLAKE-LT\.G1|STURGEONFALL-LT\.G2|CALMLK\.G1|STURGN\.G1)$", re.I
    ),
    "F2B": re.compile(r"^(FORTFRANCSWC-LT\.AG12|FTFRAN\.G1)$", re.I),
    "K2M CCTS": re.compile(r"^(ABKENORA-LT\.AG|KENORA\.G1)$", re.I),
}

NODE_METADATA = {
    "APIROQ": {"circuit": "APIROQ"},
    "M1S": {
        "circuit": "M1S",
        "resources": ["CALMLK.G1", "STURGN.G1"],
        "pricingLocations": ["CALMLAKE-LT.G1", "STURGEONFALL-LT.G2"],
    },
    "F2B": {
        "circuit": "F2B",
        "resources": ["FTFRAN.G1"],
        "pricingLocations": ["FORTFRANCSWC-LT.AG12"],
    },
    "K2M CCTS": {
        "circuit": "K2M",
        "resources": ["KENORA.G1"],
        "pricingLocations": ["ABKENORA-LT.AG"],
    },
}


@dataclass
class ParsedReport:
    operating_date: datetime
    rows: list[dict[str, str]]


def report_url(key: str, date_code: str | None = None) -> str:
    directory, latest_name = REPORTS[key]
    filename = latest_name
    if date_code:
        filename = latest_name.removesuffix(".csv") + f"_{date_code}.csv"
    return f"{IESO_ROOT}/{directory}/{filename}"


def download_text(url: str, attempts: int = 5) -> str:
    delay = 1.0
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            request = Request(url, headers={"User-Agent": "Northstar-Control-Room/1.0"})
            with urlopen(request, timeout=25) as response:
                text = response.read().decode("utf-8-sig")
            if "Delivery Hour," not in text and "\nHOUR," not in text:
                raise ValueError("IESO report is temporarily incomplete")
            return text
        except (HTTPError, URLError, TimeoutError, ValueError) as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(delay)
                delay = min(delay * 2, 16)
    raise RuntimeError(f"Could not retrieve {url}: {last_error}")


def parse_report(text: str) -> ParsedReport:
    lines = [line.strip("\r") for line in text.splitlines() if line.strip()]
    header_index = next(
        index
        for index, line in enumerate(lines)
        if line.lower().startswith(("delivery hour,", "hour,"))
    )
    date_match = re.search(r"\bFOR\s+(\d{4}/\d{2}/\d{2})", text, re.I)
    if not date_match:
        raise ValueError("IESO operating date was not found")
    operating_date = datetime.strptime(date_match.group(1), "%Y/%m/%d").replace(tzinfo=TZ)
    reader = csv.DictReader(io.StringIO("\n".join(lines[header_index:])))
    rows = [{str(k).strip(): str(v).strip() for k, v in row.items()} for row in reader]
    if not rows:
        raise ValueError("IESO report contains no data rows")
    return ParsedReport(operating_date, rows)


def location_column(rows: list[dict[str, str]]) -> str:
    columns = rows[0].keys()
    preferred = ("pricing location", "node name", "node", "delivery point name", "station")
    lowered = {column.lower(): column for column in columns}
    for name in preferred:
        if name in lowered:
            return lowered[name]
    for column in columns:
        name = column.lower()
        if any(token in name for token in ("location", "node", "delivery", "station")):
            return column
    raise ValueError("No node/location column found in IESO report")


def row_timestamp(report: ParsedReport, row: dict[str, str]) -> datetime:
    hour = max(1, int(float(row["Delivery Hour"])))
    interval = max(1, int(float(row.get("Interval") or 1)))
    return report.operating_date + timedelta(hours=hour - 1, minutes=(interval - 1) * 5)


def matching_rows(report: ParsedReport, node_key: str) -> list[dict[str, Any]]:
    column = location_column(report.rows)
    result: list[dict[str, Any]] = []
    for row in report.rows:
        location = row.get(column, "")
        if NODE_PATTERNS[node_key].search(location):
            item: dict[str, Any] = dict(row)
            item["_location"] = location
            item["_timestamp"] = row_timestamp(report, row)
            result.append(item)
    return sorted(result, key=lambda item: item["_timestamp"])


def number(row: dict[str, Any] | None, column: str) -> float | None:
    if not row:
        return None
    try:
        return float(row[column])
    except (KeyError, TypeError, ValueError):
        return None


class MarketStore:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.snapshot: dict[str, Any] | None = None
        self.error: str | None = None

    def refresh(self) -> None:
        try:
            # Price reports remain usable when an Ontario totals report is late.
            # Do not let that optional demand input blank the Overview price chart.
            with ThreadPoolExecutor(max_workers=len(REPORTS)) as executor:
                downloads = {
                    key: executor.submit(download_text, report_url(key)) for key in REPORTS
                }
                reports = {
                    key: parse_report(downloads[key].result())
                    for key in ("rt_energy", "da_energy", "rt_reserve", "da_reserve")
                }
                for key in ("rt_totals", "predisp_totals", "predisp_energy"):
                    try:
                        reports[key] = parse_report(downloads[key].result())
                    except Exception:
                        reports[key] = None
            now = datetime.now(TZ)
            nodes: dict[str, Any] = {}
            for key in NODE_PATTERNS:
                rt_rows = matching_rows(reports["rt_energy"], key)
                da_rows = matching_rows(reports["da_energy"], key)
                predisp_rows = matching_rows(reports["predisp_energy"], key) if reports["predisp_energy"] else []
                rt_latest = max(
                    (row for row in rt_rows if row["_timestamp"] <= now),
                    key=lambda row: row["_timestamp"],
                    default=rt_rows[-1] if rt_rows else None,
                )
                da_now = min(
                    da_rows,
                    key=lambda row: abs((row["_timestamp"] - now).total_seconds()),
                    default=None,
                )
                nodes[key] = {
                    "rt": number(rt_latest, "LMP"),
                    "da": number(da_now, "LMP"),
                    "location": rt_latest.get("_location") if rt_latest else None,
                    "rtTimestamp": rt_latest["_timestamp"].isoformat() if rt_latest else None,
                    "daTimestamp": da_now["_timestamp"].isoformat() if da_now else None,
                    "history": [
                        {"time": row["_timestamp"].isoformat(), "value": number(row, "LMP")}
                        for row in rt_rows[-36:]
                    ],
                    "daHistory": [
                        {"time": row["_timestamp"].isoformat(), "value": number(row, "LMP")}
                        for row in da_rows
                        if row["_timestamp"] < now.replace(minute=0, second=0, microsecond=0)
                    ][-18:],
                    "forward": [
                        {"time": row["_timestamp"].isoformat(), "value": number(row, "LMP")}
                        for row in da_rows
                        if row["_timestamp"] >= now.replace(minute=0, second=0, microsecond=0)
                    ][:18],
                    "rtForecast": [
                        {"time": row["_timestamp"].isoformat(), "value": number(row, "LMP")}
                        for row in predisp_rows
                        if row["_timestamp"] >= now.replace(minute=0, second=0, microsecond=0)
                    ][:18],
                    "mapping": NODE_METADATA.get(key, {}),
                    "operations": {
                        "commit": None,
                        "rtTransfer": None,
                        "dayAhead": None,
                        "source": "SCADA/schedule feed pending",
                    },
                }

            rt_or = matching_rows(reports["rt_reserve"], "APIROQ")
            da_or = matching_rows(reports["da_reserve"], "APIROQ")
            rt_or_latest = rt_or[-1] if rt_or else None
            da_or_now = min(
                da_or,
                key=lambda row: abs((row["_timestamp"] - now).total_seconds()),
                default=None,
            )
            nodes["APIROQ"]["reserve"] = {
                "tenS": number(rt_or_latest, "LMP 10S"),
                "tenN": number(rt_or_latest, "LMP 10N"),
                "thirtyR": number(rt_or_latest, "LMP 30R"),
                "daTenS": number(da_or_now, "LMP 10S"),
                "daTenN": number(da_or_now, "LMP 10N"),
                "daThirtyR": number(da_or_now, "LMP 30R"),
            }
            apiroq_dispatch = dispatch.snapshot()
            output_mw = apiroq_dispatch.get("outputMw")
            dispatch_mw = apiroq_dispatch.get("dispatchMw")
            if output_mw is not None and dispatch_mw is not None:
                nodes["APIROQ"]["operations"] = {
                    "commit": dispatch_mw,
                    "rtTransfer": output_mw,
                    "dayAhead": dispatch_mw,
                    "source": "APIROQ dispatch telemetry",
                }
            rt_total_rows = reports["rt_totals"].rows if reports["rt_totals"] else []
            predisp_rows = reports["predisp_totals"].rows if reports["predisp_totals"] else []
            rt_total = rt_total_rows[-1] if rt_total_rows else None
            demand_history = []
            for row in rt_total_rows[-72:]:
                value = number(row, "TOTAL LOAD")
                try:
                    timestamp = row_timestamp(reports["rt_totals"], row)
                except (KeyError, TypeError, ValueError):
                    continue
                if value is not None:
                    demand_history.append({"time": timestamp.isoformat(), "value": value})
            forecast_hour = now.hour + 2
            forecast_total = next(
                (
                    row
                    for row in predisp_rows
                    if int(float(row.get("HOUR") or 0)) == forecast_hour
                ),
                predisp_rows[-1] if predisp_rows else None,
            )
            demand_forecast = []
            for row in predisp_rows:
                value = number(row, "TOTAL LOAD")
                try:
                    hour = max(1, int(float(row.get("HOUR") or 0)))
                    timestamp = reports["predisp_totals"].operating_date + timedelta(hours=hour - 1)
                except (TypeError, ValueError):
                    continue
                if value is not None and timestamp >= now.replace(minute=0, second=0, microsecond=0):
                    demand_forecast.append({"time": timestamp.isoformat(), "value": value})
            snapshot = {
                "source": "IESO Public Reports",
                "updated": now.isoformat(),
                "stale": False,
                "ontario": {
                    "demand": number(rt_total, "TOTAL LOAD"),
                    "forecastDemand": number(forecast_total, "TOTAL LOAD"),
                    "forecastHour": forecast_hour,
                    "history": demand_history,
                    "forecastSeries": demand_forecast,
                },
                "nodes": nodes,
            }
            with self.lock:
                self.snapshot = snapshot
                self.error = None
        except Exception as exc:
            with self.lock:
                self.error = str(exc)
                if self.snapshot:
                    self.snapshot["stale"] = True
                    self.snapshot["error"] = self.error

    def get(self) -> dict[str, Any]:
        with self.lock:
            if self.snapshot:
                return {**self.snapshot, "advisories": ADVISORIES.get()}
            return {"source": "IESO Public Reports", "stale": True, "error": self.error, "nodes": {}, "advisories": ADVISORIES.get()}


STORE = MarketStore()
ADVISORIES = ieso_advisories.AdvisoryStore()
FLOWS = flows.FlowStore()
WATER_ELEVATIONS = water_elevations.ElevationStore()


class NorthstarHTTPServer(ThreadingHTTPServer):
    """HTTP server that refuses to share its port with an older instance."""

    allow_reuse_address = False
    # A dashboard navigation opens 51 asset requests through the tunnel.
    # The stdlib backlog of 5 drops connections during that burst on Windows.
    request_queue_size = 128
    daemon_threads = True

    def server_bind(self) -> None:
        if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def eccc_weather_snapshot() -> dict[str, Any]:
    """Fetch the nearest recent MSC GeoMet observation for each station."""
    stations: list[dict[str, Any]] = []
    for name, (latitude, longitude) in WEATHER_STATIONS.items():
        bbox = ",".join(str(value) for value in (
            longitude - ECCC_BBOX_RADIUS_DEGREES,
            latitude - ECCC_BBOX_RADIUS_DEGREES,
            longitude + ECCC_BBOX_RADIUS_DEGREES,
            latitude + ECCC_BBOX_RADIUS_DEGREES,
        ))
        query = f"{ECCC_WEATHER_URL}?bbox={bbox}&limit=100&sortby=-date_tm-value&f=json"
        with urlopen(Request(query, headers={"User-Agent": "Northstar-Control-Room/1.0"}), timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
        candidates = []
        for feature in payload.get("features", []):
            properties = feature.get("properties", {})
            coordinates = feature.get("geometry", {}).get("coordinates", [])
            if properties.get("air_temp") is None or len(coordinates) < 2:
                continue
            distance = (coordinates[0] - longitude) ** 2 + (coordinates[1] - latitude) ** 2
            candidates.append((distance, properties, coordinates))
        if not candidates:
            raise ValueError(f"MSC GeoMet returned no usable observation near {name}")
        _, properties, coordinates = min(candidates, key=lambda item: item[0])
        stations.append({
            "name": name,
            "station": properties.get("stn_nam-value"),
            "coordinates": {"latitude": coordinates[1], "longitude": coordinates[0]},
            "current": {
                "temperature_2m": properties.get("air_temp"),
                "relative_humidity_2m": properties.get("rel_hum"),
                "apparent_temperature": properties.get("air_temp"),
                "precipitation": properties.get("pcpn_amt_pst1hr"),
                "weather_code": properties.get("prsnt_wx_1"),
                "wind_speed_10m": properties.get("avg_wnd_spd_10m_pst10mts"),
                "wind_direction_10m": properties.get("avg_wnd_dir_10m_pst10mts"),
                "time": properties.get("date_tm-value"),
            },
        })
    return {"source": "MSC GeoMet", "updated": datetime.now(TZ).isoformat(), "stations": stations, "stale": False, "error": None, "retryAfter": None}


def weather_snapshot() -> dict[str, Any]:
    """Return cached current conditions, with batched provider requests."""
    with WEATHER_LOCK:
        cached_at = WEATHER_CACHE.get("updated")
        retry_after = WEATHER_CACHE.get("retryAfter")
        now = datetime.now(TZ)
        if retry_after and now.timestamp() < retry_after:
            WEATHER_CACHE["stale"] = bool(WEATHER_CACHE.get("stations"))
            return {"source": "Open-Meteo", **WEATHER_CACHE}
        if cached_at and (now - datetime.fromisoformat(cached_at)).total_seconds() < services.config("weather-api").get("cache_seconds", WEATHER_CACHE_TTL_SECONDS):
            return {"source": "Open-Meteo", **WEATHER_CACHE}
    latitudes = ",".join(str(latitude) for latitude, _ in WEATHER_STATIONS.values())
    longitudes = ",".join(str(longitude) for _, longitude in WEATHER_STATIONS.values())
    query = (
        "https://api.open-meteo.com/v1/forecast?"
        f"latitude={latitudes}&longitude={longitudes}"
        "&current=temperature_2m,relative_humidity_2m,apparent_temperature,"
        "precipitation,weather_code,is_day,wind_speed_10m,wind_direction_10m"
        "&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,"
        "precipitation_probability,precipitation,wind_speed_10m,weather_code,is_day"
        "&daily=weather_code,temperature_2m_max,temperature_2m_min,"
        "precipitation_probability_max,precipitation_sum&forecast_days=14&past_days=7"
        "&temperature_unit=celsius&precipitation_unit=mm&wind_speed_unit=kmh&timezone=auto"
    )
    last_error: Exception | None = None
    for attempt in range(1, WEATHER_MAX_RETRIES + 1):
        try:
            with urlopen(Request(query, headers={"User-Agent": "Northstar-Control-Room/1.0"}), timeout=15) as response:
                payload = json.loads(response.read().decode("utf-8"))
            results = payload if isinstance(payload, list) else [payload]
            stations = [
                {
                    "name": name,
                    "current": result.get("current", {}),
                    "hourly": result.get("hourly", {}),
                    "daily": result.get("daily", {}),
                }
                for (name, _), result in zip(WEATHER_STATIONS.items(), results, strict=False)
            ]
            if len(stations) != len(WEATHER_STATIONS):
                raise ValueError("Open-Meteo returned an incomplete station list")
            updated = datetime.now(TZ).isoformat()
            with WEATHER_LOCK:
                WEATHER_CACHE.update({
                    "updated": updated,
                    "stations": stations,
                    "stale": False,
                    "error": None,
                    "retryAfter": None,
                })
                return {"source": "Open-Meteo", **WEATHER_CACHE}
        except HTTPError as exc:
            last_error = exc
            if exc.code != 429 or attempt == WEATHER_MAX_RETRIES:
                break
            time.sleep(min(2 ** attempt, 8))
        except Exception as exc:
            last_error = exc
            break
    error_text = str(last_error or "Weather provider request failed")
    try:
        fallback = eccc_weather_snapshot()
        with WEATHER_LOCK:
            WEATHER_CACHE.update(fallback)
            return fallback
    except Exception as fallback_error:
        error_text = f"Open-Meteo: {error_text}; MSC GeoMet: {fallback_error}"
    retry_after = datetime.now(TZ).timestamp() + WEATHER_CACHE_TTL_SECONDS
    with WEATHER_LOCK:
        WEATHER_CACHE.update({"stale": bool(WEATHER_CACHE.get("stations")), "error": error_text, "retryAfter": retry_after})
        return {"source": "Open-Meteo", **WEATHER_CACHE}
def log_event(event_type: str, subject: str, details: str, source: str = "operator") -> dict[str, Any]:
    return store.add_logbook_entry(event_type, subject, details, source)


def log_switching_event(record: dict[str, Any], action: str, actor: str) -> None:
    """Surface durable switching transitions in the common operator feed."""
    log_event(
        "Switching package",
        f"{action}: {record.get('packageName') or record.get('id', 'draft')}",
        f"{record.get('site', '')} / {record.get('asset', '')}; status {record.get('status', '')};"
        " operational release remains blocked by design.",
        actor,
    )


def checkin_response(record: dict[str, Any] | None) -> dict[str, Any] | None:
    enriched = phase1.enrich_checkin(record)
    if enriched is not None:
        number = os.environ.get("NORTHSTAR_OPERATOR_PHONE", "").strip()
        # Empty/invalid configuration never produces a dialable dummy destination.
        number = number if re.fullmatch(r"\+[1-9][0-9]{7,14}", number) else None
        enriched.update({"safetyProtocol": 1, "operatorPhone": number,
                         "operatorCallingConfigured": bool(number)})
    return enriched


def public_health(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Liveness only, for the unauthenticated check-in host.

    The full snapshot carries SCADA feed `sharePath` values (absolute Windows
    paths), feed error strings, and live counts of active workers and open help
    requests. Those are operator diagnostics; a contractor's phone needs none of
    them, and the check-in hostname has no login in front of it.
    """
    database = snapshot.get("database") or {}
    return {
        "status": snapshot.get("status"),
        "serverTime": snapshot.get("serverTime"),
        "checkinOrigin": snapshot.get("checkinOrigin"),
        # Liveness only. start-northstar.ps1 gates readiness on database.ok, so
        # the flag stays; the counts of active workers and open help requests
        # that sit beside it in the full snapshot do not.
        "database": {"ok": bool(database.get("ok"))},
    }


def health_snapshot() -> dict[str, Any]:
    try:
        database = store.operational_summary()
    except Exception as exc:
        database = {"ok": False, "error": str(exc)}
    market = STORE.get()
    with WEATHER_LOCK:
        weather = {
            "updated": WEATHER_CACHE.get("updated"),
            "stale": bool(WEATHER_CACHE.get("stale")),
            "stations": len(WEATHER_CACHE.get("stations", [])),
        }
    market_status = {
        "ok": bool(market.get("nodes")) and not market.get("stale", True),
        "updated": market.get("updated"),
        "stale": bool(market.get("stale", True)),
        "error": market.get("error"),
    }
    try:
        scada = {"feeds": phase1.list_scada_feeds()}
    except Exception as exc:
        scada = {"feeds": [], "error": str(exc)}
    status = "healthy"
    if not database.get("ok"):
        status = "unhealthy"
    elif not market_status["ok"]:
        status = "degraded"
    return {
        "status": status,
        "serverTime": datetime.now(TZ).isoformat(),
        "database": database,
        "market": market_status,
        "weather": weather,
        "scada": scada,
        "externalNotifications": "shadow",
        "checkinOrigin": CHECKIN_ORIGIN,
    }


def shadow_delivery_note(actions: list[Any]) -> str:
    """Describe what an alert would have sent, for the shadow-mode audit trail.

    In-browser actions are performed by whichever dashboard is open. Email and
    text are configurable but not connected, so they are recorded as not sent
    rather than silently dropped.
    """
    pending = [str(a) for a in actions if str(a) in ("email", "sms")]
    if not pending:
        return "No external notification was configured for this node."
    return (
        f"Configured external delivery ({', '.join(pending)}) was not sent:"
        " the connector is not wired. Escalation remains in shadow mode."
    )


def evaluate_alerts() -> None:
    """Score the newest prices against the stored thresholds.

    Runs on the server after every market refresh so an excursion is caught
    and recorded with no dashboard open. Stale snapshots are skipped: alerting
    on a frozen price would raise alarms for conditions that may be over, and
    resolving on one would clear an alarm that may still be live.
    """
    snapshot = STORE.get()
    if snapshot.get("stale") or not snapshot.get("nodes"):
        return
    prices = {
        node: (float(values["rt"]) if values.get("rt") is not None else None)
        for node, values in snapshot["nodes"].items()
    }
    changes = store.evaluate_price_alerts(prices)
    for alert in changes["raised"]:
        log_event(
            "Price alert",
            f"{alert['node']} {alert['kind']} limit reached — ${alert['price']:.2f}",
            f"Limit ${alert['threshold']:.2f}. {shadow_delivery_note(alert['actions'])}",
            "northstar-monitor",
        )
    market_changes = store.evaluate_market_alarm_rules(snapshot)
    for alert in market_changes["raised"]:
        log_event(
            "Market alarm",
            f"{alert['node']} — {alert['kind']} alarm",
            f"Observed {alert['price']:.2f} {alert['unit']} against {alert['threshold']:.2f} {alert['unit']}."
            " Dashboard sound requested; one-hour cooldown active.",
            "northstar-monitor",
        )
    for alert in market_changes["resolved"]:
        log_event(
            "Market alarm cleared",
            f"{alert['node']} recovered",
            f"Recovered to {alert['resolvedPrice']:.2f} {alert['unit']}.",
            "northstar-monitor",
        )
    for alert in changes["resolved"]:
        price = alert["resolvedPrice"]
        log_event(
            "Price alert cleared",
            f"{alert['node']} {alert['kind']} alert resolved",
            f"Peak ${alert['peakPrice']:.2f} against limit ${alert['threshold']:.2f}"
            + (f"; recovered to ${price:.2f}" if price is not None else "")
            + (
                f". Acknowledged by {alert['acknowledgedBy']}."
                if alert["acknowledgedBy"]
                else ". Never acknowledged by an operator."
            ),
            "northstar-monitor",
        )


def refresh_loop() -> None:
    while True:
        services.wait_turn('market',REFRESH_SECONDS)
        STORE.refresh()
        try:
            evaluate_alerts()
        except Exception as exc:  # alerting must not stop the market feed
            print(f"price alert evaluation failed: {exc}")
        time.sleep(0.1)


def advisory_refresh_loop() -> None:
    while True:
        services.wait_turn('advisories',REFRESH_SECONDS)
        ADVISORIES.refresh()
        time.sleep(0.1)


def overdue_loop() -> None:
    """Server-side overdue detection and coordinate-retention enforcement."""
    while True:
        services.wait_turn('safety',OVERDUE_SCAN_SECONDS)
        try:
            backup = store.daily_backup()
            if backup:
                print(f"Northstar database backed up to {backup}")
            purged = phase1.purge_expired_coordinates()
            if purged:
                log_event(
                    "Retention cleanup",
                    "Older field coordinates purged",
                    f"Purged {purged} coordinate history rows under the configured retention policy.",
                    "northstar-retention",
                )
            for record in store.evaluate_overdue():
                mode = phase1.escalation_mode(record["site"])
                log_event(
                    "Staff overdue",
                    f"{record['name']} is overdue at {record['site']}",
                    f"No contact for {record['minutesSinceHeard']} min"
                    f" (limit {record['overdueAfterMinutes']} min"
                    f"{', working alone' if record['alone'] else ''})."
                    f" Escalation mode is {mode}; no notification was sent by this pilot.",
                    "northstar-monitor",
                )
        except Exception as exc:  # a monitoring fault must not stop the server
            print(f"overdue evaluation failed: {exc}")
        time.sleep(0.1)


def scada_loop() -> None:
    """Poll the configured read-only report drop after files stabilize."""
    while True:
        services.wait_turn('scada',SCADA_POLL_SECONDS)
        try:
            for result in phase1.scan_scada_once():
                if result.get("status") == "Imported":
                    log_event(
                        "SCADA import",
                        f"{result.get('fileName', 'Report')} imported",
                        f"Imported {result.get('imported', 0)} readings; rejected {result.get('rejected', 0)} rows.",
                        "northstar-scada",
                    )
        except Exception as exc:  # a feed fault must not stop the server
            print(f"SCADA polling failed: {exc}")
        time.sleep(0.1)


def flow_loop() -> None:
    """Refresh read-only public hydrometric observations in the background."""
    while True:
        services.wait_turn('flows',FLOW_REFRESH_SECONDS)
        try:
            FLOWS.refresh()
        except Exception as exc:  # a public-source fault must not stop the server
            print(f"Flow polling failed: {exc}")
        time.sleep(0.1)


def dispatch_loop() -> None:
    """Advance APIROQ output/dispatch simulation for the operator dispatch client."""
    while True:
        services.wait_turn('dispatch',DISPATCH_TICK_SECONDS)
        try:
            dispatch.tick()
        except Exception as exc:  # a telemetry fault must not stop the server
            print(f"dispatch simulation failed: {exc}")
        time.sleep(0.1)


def voice_loop() -> None:
    """Pick up dropped audio, transcribe what an engine can, age out old audio."""
    while True:
        services.wait_turn('voice',VOICE_POLL_SECONDS)
        try:
            for result in voice.scan_inbox_once():
                if result.get("action") == "Ingested":
                    log_event(
                        "Voice intake",
                        f"Audio received: {result.get('originalName')}",
                        f"{result.get('byteSize', 0)} bytes · awaiting transcription",
                        "northstar-voice",
                    )
            for result in voice.transcribe_pending():
                if result.get("status") == voice.STATUS_TRANSCRIBED:
                    detail = (
                        f"{result.get('operational', 0)} operational · "
                        f"{result.get('filtered', 0)} filtered from the operational feed"
                    )
                    if result.get("safetyHeld"):
                        detail += f" · {result['safetyHeld']} safety-held"
                    log_event(
                        "Voice transcript",
                        f"Transcribed {result.get('recordingId')}",
                        detail,
                        "northstar-voice",
                    )
            voice.purge_expired_audio()
        except Exception as exc:  # a bad file must not stop the sweep
            print(f"Voice polling failed: {exc}")
        time.sleep(0.1)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        request_origin = self.headers.get("Origin", "").strip().rstrip("/")
        configured_origins = {
            origin.strip().rstrip("/")
            for origin in ALLOWED_ORIGIN.split(",")
            if origin.strip()
        }
        if "*" in configured_origins:
            allowed_origin = "*"
        elif request_origin and request_origin in configured_origins:
            allowed_origin = request_origin
        elif not request_origin and len(configured_origins) == 1:
            allowed_origin = next(iter(configured_origins))
        else:
            allowed_origin = ""
        if allowed_origin:
            self.send_header("Access-Control-Allow-Origin", allowed_origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Correlation-Id")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Expose-Headers", "X-Correlation-Id")
        if getattr(self, "correlation_id", ""):
            self.send_header("X-Correlation-Id", self.correlation_id)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def _arrived_on(self) -> str:
        """The hostname this request actually arrived on, without the port."""
        return (self.headers.get("Host") or "").rsplit(":", 1)[0].strip().lower()

    def _is_public_checkin_host(self) -> bool:
        if not CHECKIN_ORIGIN:
            return False
        public_host = (urlparse(CHECKIN_ORIGIN).hostname or "").lower()
        return bool(public_host) and self._arrived_on() == public_host

    def _is_operator_host(self) -> bool:
        """True when this request may reach the demo login and demo sessions.

        The operator hostname always qualifies. Loopback qualifies only when the
        check-in origin is not a public one — i.e. on a developer's machine with
        no tunnel in front of it. In production `CHECKIN_ORIGIN` is public, so
        `localhost:4180` cannot sign in or hold a session, which is the same
        rule the Access gate already imposes (see AGENTS.md invariant 1).
        """
        arrived_on = self._arrived_on()
        if self._is_public_checkin_host():
            return False
        if arrived_on == OPERATOR_HOST:
            return True
        local = arrived_on in {"127.0.0.1", "localhost", "::1", "[::1]", ""}
        return local and not CHECKIN_ORIGIN.startswith("https://")

    def _checkin_host_forbidden(self) -> bool:
        """True for anything on the public check-in hostname that is not the worker app.

        Answers 404, not 403: on that hostname the operator application does not
        exist, and saying "forbidden" would confirm it is there. Operator routes
        are handled before this and still answer 403, because refusing a known
        operator route is the more useful signal for the regression tests and the
        dashboard's own error handling.
        """
        if not self._is_public_checkin_host():
            return False
        # Normalise before matching, or an admitted prefix becomes a way out of
        # the allowlist: /icons/%2e%2e/northstar-clean.html starts with /icons/
        # but resolves to the operator console, which the static handler would
        # then happily serve.
        route = posixpath.normpath(unquote(self.path.split("?", 1)[0]).replace("\\", "/"))
        if route in CHECKIN_PUBLIC_ROUTES:
            return False
        return not any(route.startswith(prefix) for prefix in CHECKIN_PUBLIC_PREFIXES)

    def _demo_actor(self) -> str | None:
        """The signed-in demo operator for this request, or None."""
        if OPERATOR_GATE != "demo" or not self._is_operator_host():
            return None
        return DEMO_SESSIONS.actor(auth.cookie_token(self.headers.get("Cookie", "")))

    def _demo_role(self) -> str | None:
        """The server-stored role for this request's live demo session."""
        if OPERATOR_GATE != "demo" or not self._is_operator_host():
            return None
        return DEMO_SESSIONS.role(auth.cookie_token(self.headers.get("Cookie", "")))

    def _is_demo_site_viewer(self) -> bool:
        return self._demo_role() == auth.ROLE_SITE_VIEWER

    def _is_platform_demo(self) -> bool:
        return self._demo_role() == auth.ROLE_PLATFORM_DEMO

    def _demo_viewer_denial(self) -> tuple[int, str] | None:
        route = self.path.split("?", 1)[0]
        if self.command in {"GET", "HEAD"} and route in SHARED_RESEARCH_ROUTES:
            return None
        if self._is_demo_site_viewer():
            if route.startswith("/api/") and (self.command, route) not in DEMO_VIEWER_API_ROUTES:
                return 403, "demo access is limited to site names"
            if not route.startswith("/api/") and (self.command not in {"GET", "HEAD"} or route not in DEMO_VIEWER_ENTRYPOINTS):
                return 403, "company files are unavailable in demo mode"
            return None
        if self._is_platform_demo():
            if route.startswith("/api/"):
                if (self.command, route) not in PLATFORM_DEMO_API_ROUTES:
                    return 403, "company data and documents are unavailable in demo mode"
            elif self.command not in {"GET", "HEAD"} or route not in PLATFORM_DEMO_STATIC_ROUTES:
                return 403, "company files are unavailable in demo mode"
        return None

    def _cross_origin_write(self) -> bool:
        """True when a mutating request claims an origin that is not ours.

        The session cookie is SameSite=Lax, so a cross-site POST does not carry
        it — but that is a browser promise, and the check belongs on the server.
        A request with no Origin header (curl, the worker PWA's own fetches on
        the public host, the test suite) is not treated as cross-origin; a
        request that names a different host than it arrived on is.
        """
        origin = (self.headers.get("Origin") or "").strip()
        if not origin or origin.lower() == "null":
            return False
        origin_host = (urlparse(origin).hostname or "").lower()
        return bool(origin_host) and origin_host != self._arrived_on()

    def _operator_gate_denial(self) -> tuple[int, str] | None:
        """(status, message) when this request must be refused, else None."""
        if OPERATOR_GATE not in {"access", "demo"}:
            return None
        route = self.path.split("?", 1)[0]
        if route == "/api/switching/drafts" or route.startswith("/api/switching/drafts/"):
            allowed_methods = ("GET", "POST", "DELETE")
        elif route == "/api/schematics" or route.startswith("/api/schematics/"):
            allowed_methods = ("GET", "POST")
        else:
            allowed_methods = OPERATOR_ROUTES.get(route, ())
        operator = self.command in allowed_methods or any(
            self.command == method and pattern.match(route)
            for method, pattern in OPERATOR_ROUTE_PATTERNS
        )
        if not operator:
            return None
        # Header presence is not evidence of authentication. Cloudflare does NOT
        # strip a client-supplied copy of Cf-Access-Jwt-Assertion on the public
        # check-in hostname: a 2026-08-11 probe of the live tunnel sent the
        # header from the open internet and got the full roster — names, sites,
        # notes and live GPS — plus /api/checkins/history. The edge path rule
        # cannot help, because the worker app POSTs to /api/checkins, so that
        # path must stay admitted.
        #
        # Both hostnames reach this one listener, but cloudflared forwards the
        # Host the request actually arrived on, and the operator surface does not
        # exist on the public check-in hostname at all. Refuse it there whatever
        # headers the request carries. This check can only turn 200 into 403; it
        # never opens a route that was closed, and worker device routes never
        # reach it because they are not operator routes.
        #
        # This is defence in depth, not the whole answer: verifying the JWT
        # against the Access team's certs is still open (ADR-011).
        if self._is_public_checkin_host():
            return 403, "operator authentication required"
        if OPERATOR_GATE == "demo":
            if self._demo_actor() is None:
                return 401, "operator sign-in required"
            # A valid session is not a licence for another site to spend it.
            if self.command in {"POST", "DELETE", "PUT", "PATCH"} and self._cross_origin_write():
                return 403, "cross-origin operator request refused"
            return None
        return (
            None
            if self.headers.get("Cf-Access-Jwt-Assertion")
            else (403, "operator authentication required")
        )

    def _operator_gate_blocks(self) -> bool:
        """True when an operator-only route must be refused. Kept for callers
        that only need the yes/no answer."""
        return self._operator_gate_denial() is not None

    def _refuse_operator_request(self, denial: tuple[int, str]) -> None:
        status, message = denial
        payload: dict[str, Any] = {"error": message}
        if OPERATOR_GATE == "demo":
            # The dashboard uses this marker to send an expired session back to
            # the login screen instead of rendering broken panels.
            payload["loginRequired"] = True
        self._send_json(payload, status)

    def _refuse_demo_viewer_request(self, denial: tuple[int, str]) -> None:
        """Refuse a site-viewer request without treating its session as expired."""
        status, message = denial
        self._send_json({"error": message}, status)

    def _operator_actor(self) -> str:
        """Return an authenticated operator identity for audit records."""
        if OPERATOR_GATE == "demo":
            # The demo user is a demo user. Record the configured username, and
            # never dress it up as an employee email or a real identity.
            return self._demo_actor() or demo_username()
        identity = self.headers.get("Cf-Access-Authenticated-User-Email", "")
        if not identity and OPERATOR_GATE != "access":
            identity = self.headers.get("X-Northstar-Operator", "")
        return identity.strip()[:160] or "operator console"

    def _training_simulator_request(self) -> bool:
        """Dispatch only to the isolated simulation service, never the SCADA provider."""
        route = self.path.split("?", 1)[0]
        if route != "/api/training/switching" and not route.startswith("/api/training/switching/"):
            return False
        if self.command == "POST" and self._cross_origin_write():
            self._send_json({"error": "cross-origin training mutation refused"}, 403)
            return True
        from northstar_sim.service import get_simulator

        body = self._json_body(2 * 1024 * 1024) if self.command == "POST" else None
        local_instructor = OPERATOR_GATE == "off" and not CHECKIN_ORIGIN and HOST in {"127.0.0.1", "::1", "localhost"}
        direct_local = (local_instructor and self._arrived_on() in {"localhost", "127.0.0.1", "::1", "[::1]"}
                        and self.client_address and self.client_address[0] in {"127.0.0.1", "::1"}
                        and not any(self.headers.get(name) for name in ("Forwarded", "X-Forwarded-For", "X-Forwarded-Host", "Cf-Ray", "Cf-Connecting-Ip")))
        response = get_simulator(local_instructor=local_instructor).handle(self.command, self.path, body, self._operator_actor(), instructor_access=bool(direct_local))
        if response is None:
            self._send_json({"error": "training simulator route not found"}, 404)
        else:
            status, payload = response
            self._send_json(payload, status)
        return True

    def _audit_actor(self, requested: Any, fallback: str = "operator console") -> str:
        """Who to record for an operator action.

        In demo mode the server decides: a signed-in session is the only actor
        an audit record may name, whatever the request body claims. In the other
        modes the historical client-supplied value is preserved.
        """
        if OPERATOR_GATE == "demo":
            actor = self._demo_actor()
            if actor:
                return actor
        return str(requested if requested is not None else fallback).strip()[:80] or fallback

    def _refused_before_dispatch(self) -> bool:
        """Run both hostname rules before any handler sees the request.

        Order is load-bearing. The operator gate goes first so an operator route
        reached on the public check-in hostname keeps answering 403 — that is the
        refusal the 2026-08-11 regression tests assert and the shape the packet's
        verification matrix expects. Everything else that is not the worker app
        then 404s, because it does not exist on that hostname.
        """
        self.correlation_id = events.set_correlation_id(self.headers.get("X-Correlation-Id"))
        if self.path.split("?",1)[0].startswith("/public-outage-api/"):
            import northstar_public_outage
            northstar_public_outage.handle(self)
            return True
        if shelf_mobile.handle(self, shelf, OPERATOR_GATE):
            return True
        denial = self._operator_gate_denial()
        if denial:
            self._refuse_operator_request(denial)
            return True
        denial = self._demo_viewer_denial()
        if denial:
            self._refuse_demo_viewer_request(denial)
            return True
        if self._checkin_host_forbidden():
            self.send_error(404)
            return True
        # Removing the demo cookie cannot expose an unregistered company API.
        # Existing operator and public-host checks above still take precedence.
        route = self.path.split("?", 1)[0]
        if OPERATOR_GATE == "demo" and not self._demo_actor() and route.startswith("/api/"):
            public_api = CHECKIN_PUBLIC_ROUTES | {"/api/auth/session", "/api/auth/login", "/api/auth/logout"}
            if route not in public_api and not any(route.startswith(prefix) for prefix in CHECKIN_PUBLIC_PREFIXES):
                self._refuse_operator_request((401, "operator sign-in required"))
                return True
        if shelf.matches(self.path):
            shelf.handle(self, OPERATOR_GATE, DEMO_AUTH)
            return True
        return False

    def _uwpc_request_route(self, route: str, visitor_identity=None) -> bool:
        prefix = "/api/uwpc/requests"
        if route != prefix and not route.startswith(prefix + "/"):
            return False
        if visitor_identity is not None:
            actor, operators = visitor_identity
        else:
            actor = self._operator_actor()
            accounts = (DEMO_AUTH or {}).get("accounts", [DEMO_AUTH or {}]) if OPERATOR_GATE == "demo" else []
            operators = sorted({str(a.get("username")) for a in accounts
                                if a.get("username") and a.get("role", "operator") == "operator" and not a.get("disabled")})
            if OPERATOR_GATE == "access":
                operators = [name.strip() for name in os.environ.get("NORTHSTAR_UWPC_OPERATORS", "").split(",") if name.strip()]
        parts = route[len(prefix):].strip("/").split("/") if route != prefix else []
        checkout_token = self.headers.get("X-Northstar-Checkout", "")
        practice_token = None
        try:
            if parts[:1] == ["manager"]:
                import northstar_outage_manager as manager
                endpoint = parts[1:]
                params = {k:v[0] for k,v in parse_qs(urlparse(self.path).query).items()}
                if self.command == "POST" and self._cross_origin_write():
                    raise PermissionError("Cross-origin outage request refused")
                if self.command == "GET" and endpoint == ["register"]:
                    self._send_json(manager.query_register(params))
                elif self.command == "GET" and endpoint == ["detail"]:
                    self._send_json(manager.details(params.get("id","")))
                elif self.command == "GET" and endpoint == ["reports"]:
                    self._send_json(manager.outage_report(params["id"]) if params.get("id") else manager.report_options())
                elif self.command == "GET" and endpoint == ["plans"]:
                    self._send_json(manager.switching_sources(params.get("target","")))
                elif self.command == "GET" and endpoint == ["plan-versions"]:
                    self._send_json(manager.switching_versions(params.get("id","")))
                elif endpoint == ["checkout"] and self.command == "GET":
                    self._send_json(uwpc_desk.checkout(params.get("doc",""), None, actor, checkout_token))
                elif endpoint == ["checkout"] and self.command == "POST":
                    payload = self._json_body(4096)
                    if not isinstance(payload,dict) or payload.get("action") not in ("check-out","check-in","renew"):
                        raise ValueError("Select a checkout action")
                    self._send_json(uwpc_desk.checkout(payload.get("doc",""), payload["action"], actor, checkout_token))
                elif self.command == "GET" and endpoint == ["session"]:
                    self._send_json({"actor":actor,"operators":operators,"outageReviewRoles":uwpc_desk.outage_review.directory(operators)})
                elif self.command == "GET" and endpoint == ["devices"]:
                    self._send_json(manager.site_devices(parse_qs(urlparse(self.path).query).get("site",[])))
                elif self.command == "GET" and endpoint == ["inbox"]:
                    self._send_json(manager.inbox(actor))
                elif self.command == "POST" and endpoint in (["inbox","open"], ["tag"]):
                    payload = self._json_body(4096)
                    if not isinstance(payload, dict):
                        raise ValueError("Expected an Inbox action")
                    if endpoint == ["tag"]:
                        self._send_json(manager.tag_person(payload, actor, operators), 201)
                    elif isinstance(payload.get("key"), str):
                        self._send_json(manager.inbox(actor, payload["key"]))
                    else:
                        raise ValueError("Select an Inbox item")
                elif self.command == "GET" and endpoint == ["library"]:
                    self._send_json(manager.library(actor,params.get("q","")[:250]))
                elif self.command == "GET" and endpoint == ["library-page"]:
                    self._send_json(manager.read_page(actor,int(params.get("page",1))))
                elif self.command == "GET" and len(endpoint)==2 and endpoint[0]=="library":
                    body, name = manager.library_file(actor,endpoint[1])
                    self._send_binary(body,"application/pdf",name,hashlib.sha256(body).hexdigest(),inline=endpoint[1]=="book")
                elif self.command == "POST" and endpoint == ["create"]:
                    payload = self._json_body(32 * 1024)
                    if not isinstance(payload, dict):
                        raise ValueError("An outage request is required")
                    self._send_json(manager.create_request(payload,actor,operators),201)
                else:
                    self._send_json({"error":"Outage Manager route not found"},404)
                return True
            if parts[:1] == ["practice"]:
                if actor not in operators or len(parts) < 2:
                    raise PermissionError("Sign in with an active NorthStar account to open the practice outage")
                team = uwpc_desk.outage_review.PRACTICE_TEAM
                operators = sorted({name for names in team.values() for name in names})
                persona = unquote(parts[1])
                if persona not in operators:
                    raise ValueError("Select a member of the practice team")
                workspace = hashlib.sha256(actor.encode()).hexdigest()
                practice_token = uwpc_desk.outage_review.PRACTICE_DB.set(
                    store.DB_PATH.parent / "outage-practice" / (workspace + ".sqlite"))
                actor, parts = persona, parts[2:]
            if self.command == "GET":
                if not parts:
                    self._send_json({"requests": uwpc_desk.listing(), "operators": operators,
                                     "actor": actor, "identityMode": OPERATOR_GATE,
                                     "outageReviewRoles": uwpc_desk.outage_review.directory(operators),
                                     "correspondence": uwpc_desk.correspondence()})
                elif len(parts) == 1:
                    self._send_json(uwpc_desk.get(parts[0]))
                elif len(parts) == 3 and parts[1] == "sources":
                    source = uwpc_desk.source_bytes(parts[0], parts[2])
                    self._send_binary(source["content"], source["mime"], source["name"], source["sha256"])
                elif len(parts) == 3 and parts[1] == "exports":
                    version = parse_qs(urlparse(self.path).query).get("v", [None])[0]
                    copy_id = parse_qs(urlparse(self.path).query).get("copy", [None])[0]
                    body, content_type, filename = uwpc_desk.export_record(parts[0], parts[2], version,
                                                                          copy_id=copy_id, actor=actor if actor in operators else None)
                    self._send_binary(body, content_type, filename, hashlib.sha256(body).hexdigest(), inline=parts[2] == "pdf")
                else:
                    self._send_json({"error": "UWPC route not found"}, 404)
            elif self.command == "POST":
                if self._cross_origin_write():
                    raise PermissionError("Cross-origin UWPC write refused")
                if len(parts) == 2 and parts[1] == "sources":
                    query = parse_qs(urlparse(self.path).query)
                    version = int(query.get("version", ["0"])[0])
                    result = uwpc_desk.add_source(parts[0], version,
                        unquote(self.headers.get("X-Northstar-Filename", "")),
                        query.get("kind", [""])[0], self._binary_body(uwpc_desk.MAX_SOURCE), actor, checkout_token=checkout_token)
                else:
                    payload = self._json_body(64 * 1024)
                    if not isinstance(payload, dict):
                        raise ValueError("A JSON object is required")
                    if not parts:
                        result = uwpc_desk.create(payload, actor, checkout_token=checkout_token)
                    elif len(parts) == 2:
                        if parts[1] == "generate":
                            result = uwpc_desk.generate(parts[0], payload, actor, checkout_token=checkout_token)
                        else:
                            result = uwpc_desk.change(parts[0], parts[1], payload, actor, operators, checkout_token=checkout_token)
                    else:
                        raise LookupError("UWPC route not found")
                self._send_json(result, 201 if not parts else 200)
            else:
                self._send_json({"error": "Method not allowed"}, 405)
        except uwpc_desk.Conflict as exc:
            self._send_json({"error": str(exc)}, 409)
        except PermissionError as exc:
            self._send_json({"error": str(exc)}, 403)
        except LookupError as exc:
            self._send_json({"error": str(exc)}, 404)
        except ValueError as exc:
            self._send_json({"error": str(exc)}, 400)
        except uwpc_desk.ai.AssistantUnavailable as exc:
            self._send_json({"error": str(exc)}, 503)
        finally:
            if practice_token is not None:
                uwpc_desk.outage_review.PRACTICE_DB.reset(practice_token)
        return True

    def do_OPTIONS(self) -> None:
        if self._refused_before_dispatch():
            return
        self.send_response(204)
        self.end_headers()

    def _data_workspace_request(self):
        try:
            if self.command != "GET" and self._cross_origin_write():
                raise PermissionError("Cross-origin data write refused")
            role = self._demo_role() if OPERATOR_GATE == "demo" else "operator"
            report_demo = role == auth.ROLE_PLATFORM_DEMO and (
                self.command, self.path.split('?', 1)[0]) in PLATFORM_DEMO_REPORT_ROUTES
            if role != "operator" and not report_demo:
                raise PermissionError("Data workspace requires operator access")
            params = {key: values[0] for key, values in parse_qs(urlparse(self.path).query).items()}
            payload = self._json_body(maximum=131072) if self.command == "POST" else {}
            if not isinstance(payload, dict):
                raise ValueError("A JSON object is required")
            collector = self.path.startswith("/api/water-collection/")
            report = self.path.startswith("/api/daily-report/")
            if report and self.command == "GET" and self.path.split("?", 1)[0] == "/api/daily-report/file":
                file = daily_report.download(params.get("id", ""), params.get("name", ""))
                content_type = {".png": "image/png", ".csv": "text/csv; charset=utf-8", ".json": "application/json", ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12"}[file.suffix]
                self._send_binary(file.read_bytes(), content_type, file.name, inline=file.suffix == ".png")
                return
            dispatcher = daily_report.request if report else water_collection.request if collector else data_workspace.request
            result = dispatcher(self.command, self.path.split("?", 1)[0], params, payload, self._operator_actor())
            self._send_json(result, 202 if collector and self.command == "POST" and self.path.split("?", 1)[0].endswith("/collect") else 200)
        except data_workspace.Unavailable as exc:
            self._send_json({"error": str(exc)}, 503)
        except data_workspace.Conflict as exc:
            self._send_json({"error": str(exc)}, 409)
        except PermissionError as exc:
            self._send_json({"error": str(exc)}, 403)
        except LookupError as exc:
            self._send_json({"error": str(exc)}, 404)
        except (ValueError, TypeError) as exc:
            self._send_json({"error": str(exc)}, 400)
        except APIError as exc:
            self._send_json({"error": exc.message}, exc.status)
        except Exception as exc:
            print(f"Data workspace request failed: {type(exc).__name__}")
            self._send_json({"error": "Data request failed; contact the administrator if it persists"}, 500)

    def _console_request(self):
        try:
            if self.command != "GET" and self._cross_origin_write():
                raise PermissionError("Cross-origin console write refused")
            role = self._demo_role() if OPERATOR_GATE == "demo" else "operator"
            who = operations_console.identity(self._operator_actor(), role)
            params = {key: values[0] for key, values in parse_qs(urlparse(self.path).query).items()}
            data = self._json_body() if self.command != "GET" else {}
            if not isinstance(data, dict):
                raise ValueError("JSON object required")
            self._send_json(operations_console.request("POST" if self.command == "PATCH" else self.command,
                            self.path.split("?", 1)[0], params, data, who))
        except operations_console.Conflict as exc:
            self._send_json({"error": str(exc)}, 409)
        except PermissionError as exc:
            self._send_json({"error": str(exc)}, 403)
        except LookupError as exc:
            self._send_json({"error": str(exc)}, 404)
        except (ValueError, TypeError, KeyError) as exc:
            self._send_json({"error": str(exc)}, 400)
        except APIError as exc:
            self._send_json({"error": exc.message}, exc.status)

    def do_PATCH(self) -> None:
        if self._refused_before_dispatch():
            return
        if self.path.split("?", 1)[0].startswith("/api/console/"):
            self._console_request()
            return
        self._send_json({"error": "route not found"}, 404)

    def do_GET(self) -> None:
        if self._refused_before_dispatch():
            return
        if scada_workbench.handle(self):
            return
        route = self.path.split("?", 1)[0]
        if self._training_simulator_request():
            return
        if self._is_platform_demo() and route in PLATFORM_DEMO_ENTRYPOINTS:
            self.path = "/northstar-clean.html"
            super().do_GET()
            return
        if route == "/api/services":
            try:self._send_json(services.snapshot())
            except (ValueError,OSError):self._send_json({"error":"Service settings unavailable"},503)
            return
        blocked=services.blocked_api(route,self.command)
        if blocked:
            self._send_json({"error":"Service is stopped in Service controls", "service":blocked},503)
            return
        if route.startswith("/api/inflows/"):
            try:
                params = {k: v[0] for k,v in parse_qs(urlparse(self.path).query).items()}
                self._send_json(inflow.request(self.command, route, params), 202 if self.command == "POST" else 200)
            except LookupError:
                self._send_json({"error": "Inflow route not found"}, 404)
            except (ValueError, OSError):
                self._send_json({"error": "Inflow service unavailable; inspect collection status"}, 503)
            return
        if route.startswith(("/api/data-workspace/", "/api/water-collection/", "/api/daily-report/")):
            self._data_workspace_request()
            return
        if route.startswith("/api/console/"):
            self._console_request()
            return
        if route == "/api/profile/crew-layout":
            try:
                positions = self._json_body().get("positions") if self.command == "POST" else None
                if self.command == "POST" and positions is None:
                    raise ValueError("Positions required")
                actor = self._demo_actor() if OPERATOR_GATE == "demo" else self.headers.get("Cf-Access-Authenticated-User-Email", "") if OPERATOR_GATE == "access" else ""
                self._send_json(crew_profile.layout(actor, positions))
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 400)
            return
        if route == "/api/profile/station-popup":
            try:
                preference = self._json_body().get("preference") if self.command == "POST" else None
                if self.command == "POST" and preference is None:
                    raise ValueError("Preference required")
                actor = self._demo_actor() if OPERATOR_GATE == "demo" else self.headers.get("Cf-Access-Authenticated-User-Email", "") if OPERATOR_GATE == "access" else "local"
                self._send_json(station_popup_profile.preference(actor, preference))
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 400)
            return
        if self._uwpc_request_route(route):
            return
        if route == "/api/auth/session":
            self._demo_session_state()
            return
        if self._is_demo_site_viewer():
            # Never load the operator shell for the restricted account.  It
            # has one purpose-built page, and direct requests for other static
            # assets are refused rather than revealing UI labels or paths.
            if route in DEMO_VIEWER_ENTRYPOINTS:
                self.path = "/demo-sites.html"
                route = "/demo-sites.html"
            elif not route.startswith("/api/") and route not in SHARED_RESEARCH_ROUTES:
                self.send_error(403)
                return
        # The dashboard must not boot into a signed-out session and then fill
        # with failed API calls. Serve the login screen instead of the console.
        if (
            OPERATOR_GATE == "demo"
            and route in {"/", "/northstar-clean.html", "/index.html", "/operator-mobile.html", "/knowledge-library.html", "/data-workspace.html", "/water-collection.html", "/daily-report-automation.html", "/service-controls.html", "/outage-practice.html", "/outage-manager.html", "/outage-manager-package.html"}
            and self._is_operator_host()
            and not self._demo_actor()
        ):
            self.path = "/operator-login.html"
        route = self.path.split("?", 1)[0]
        if route == "/api/health":
            snapshot = health_snapshot()
            # Only trim when deployed. With the gate off this is a local box and
            # the dashboard's watchdog needs the full diagnostic payload. Health
            # is not an operator route (the check-in PWA and the launcher both
            # poll it), so the trimming decision is made here, per caller.
            if self._is_public_checkin_host():
                # Health is the one operator-app route the worker PWA shares, so
                # it cannot be closed on the public hostname. It can be reduced:
                # there is no caller there that is ever entitled to more than
                # "the server is up", whatever gate mode this process runs in.
                snapshot = public_health(snapshot)
            elif OPERATOR_GATE == "access" and not self.headers.get("Cf-Access-Jwt-Assertion"):
                snapshot = public_health(snapshot)
            elif OPERATOR_GATE == "demo" and not self._demo_actor():
                snapshot = public_health(snapshot)
            self._send_json(snapshot)
            return
        if route == "/api/field-reports":
            query = parse_qs(urlparse(self.path).query)
            try:
                limit = int(query.get("limit", ["250"])[0])
            except ValueError:
                limit = 250
            self._send_json(store.list_field_reports(
                query.get("status", [None])[0], query.get("station", [None])[0], limit
            ))
            return
        if route == "/api/field-reports/history":
            query = parse_qs(urlparse(self.path).query)
            try:
                limit = int(query.get("limit", ["250"])[0])
            except ValueError:
                limit = 250
            self._send_json(store.field_report_history(query.get("id", [None])[0], limit))
            return
        if route.startswith("/api/field-reports/") and "/" not in route[len("/api/field-reports/"):]:
            record = store.get_field_report(route[len("/api/field-reports/"):])
            self._send_json(record or {"error": "field report not found"}, 200 if record else 404)
            return
        if route == "/api/action-items":
            query = parse_qs(urlparse(self.path).query)
            self._send_json(store.list_action_items(query.get("include", [""])[0] == "all"))
            return
        if route == "/api/field-operations/summary":
            self._send_json(store.field_operations_summary())
            return
        if route == "/api/daily-operations/catalog":
            self._send_json(store.daily_operation_catalog())
            return
        if route == "/api/daily-operations":
            query = parse_qs(urlparse(self.path).query)
            try:
                limit = int(query.get("limit", ["60"])[0])
            except ValueError:
                limit = 60
            self._send_json(store.list_daily_operation_reports(limit))
            return
        if route == "/api/daily-operations/history":
            query = parse_qs(urlparse(self.path).query)
            try:
                limit = int(query.get("limit", ["250"])[0])
            except ValueError:
                limit = 250
            self._send_json(store.daily_operation_history(query.get("id", [None])[0], limit))
            return
        if route.startswith("/api/daily-operations/") and "/" not in route[len("/api/daily-operations/"):]:
            record = store.get_daily_operation_report(route[len("/api/daily-operations/"):])
            self._send_json(record or {"error": "daily operation report not found"}, 200 if record else 404)
            return
        if route == "/api/unit-cycling/catalog":
            self._send_json(store.unit_cycling_catalog())
            return
        if route == "/api/unit-cycling/summary":
            query = parse_qs(urlparse(self.path).query)
            try:
                limit = int(query.get("limit", ["200"])[0])
            except ValueError:
                limit = 200
            self._send_json(store.unit_cycling_summary(limit))
            return
        if route == "/api/unit-cycling":
            query = parse_qs(urlparse(self.path).query)
            try:
                limit = int(query.get("limit", ["200"])[0])
            except ValueError:
                limit = 200
            self._send_json(store.list_unit_cycling_records(limit))
            return
        if route == "/api/water-observations/catalog":
            self._send_json(store.water_observation_catalog())
            return
        if route == "/api/water-observations/summary":
            query = parse_qs(urlparse(self.path).query)
            try:
                limit = int(query.get("limit", ["600"])[0])
            except ValueError:
                limit = 600
            self._send_json(store.water_observation_summary(limit))
            return
        if route == "/api/water-observations":
            query = parse_qs(urlparse(self.path).query)
            try:
                limit = int(query.get("limit", ["240"])[0])
            except ValueError:
                limit = 240
            self._send_json(store.list_water_observations(
                limit,
                region=query.get("region", [None])[0],
                facility=query.get("facility", [None])[0],
                metric_type=query.get("metricType", [None])[0],
            ))
            return
        if route == "/api/service-requests/catalog":
            self._send_json(service_requests.catalog())
            return
        if route == "/api/service-requests":
            query = parse_qs(urlparse(self.path).query)
            try:
                snapshot = service_requests.list_requests(
                    query=query.get("q", [""])[0],
                    status=query.get("status", [""])[0],
                    due=query.get("due", [""])[0],
                    page=query.get("page", [1])[0],
                    limit=query.get("limit", [75])[0],
                )
            except ValueError as exc:
                raise APIError(400, str(exc)) from exc
            self._send_json(snapshot)
            return
        if route == "/api/control-center/status":
            snapshot = health_snapshot()
            self._send_json({
                "apiVersion": "control-center.v1",
                "target": "local",
                "service": "northstar",
                "health": public_health(snapshot),
                "capabilities": {
                    "status": True,
                    "launch": False,
                    "restart": False,
                    "update": False,
                    "backup": False,
                    "rollback": False,
                },
                "managementAgent": {"configured": False, "state": "not-installed"},
            })
            return
        if route == "/api/incident-library/catalog":
            self._send_json(incident_library.catalog())
            return
        if route == "/api/incident-library":
            query = parse_qs(urlparse(self.path).query)
            try:
                records = incident_library.list_incidents(
                    query=query.get("q", [""])[0],
                    category=query.get("category", [""])[0],
                    year=query.get("year", [""])[0],
                    page=query.get("page", [1])[0],
                    limit=query.get("limit", [60])[0],
                )
            except ValueError as exc:
                raise APIError(400, str(exc)) from exc
            self._send_json(records)
            return
        if route == "/api/readiness":
            self._send_json(store.readiness_summary())
            return
        if route == "/api/controlled-sources":
            self._send_json(store.list_controlled_sources())
            return
        if route == "/api/assets":
            self._send_json(store.list_assets())
            return
        field_attachments = re.fullmatch(r"/api/field-reports/([^/]+)/attachments", route)
        if field_attachments:
            self._send_json(store.list_field_report_attachments(field_attachments.group(1)))
            return
        field_attachment = re.fullmatch(r"/api/field-reports/([^/]+)/attachments/([^/]+)", route)
        if field_attachment:
            attachment = store.get_field_report_attachment(*field_attachment.groups())
            if not attachment:
                self._send_json({"error": "field attachment not found"}, 404)
                return
            self._send_binary(attachment.pop("content"), attachment["type"], attachment["name"], attachment["sha256"])
            return
        if route == "/api/switching/drafts":
            query = parse_qs(urlparse(self.path).query)
            try:
                limit = int(query.get("limit", ["100"])[0])
            except ValueError:
                limit = 100
            self._send_json(store.list_switching_drafts(
                query.get("status", [None])[0],
                limit,
                query.get("q", [None])[0],
                query.get("outageId", [None])[0],
            ))
            return
        if route.startswith("/api/switching/drafts/"):
            suffix = route[len("/api/switching/drafts/"):]
            if suffix.endswith("/bundle"):
                draft_id = suffix[:-len("/bundle")]
                if not draft_id or "/" in draft_id:
                    self.send_error(404)
                    return
                snapshot = store.get_switching_bundle(draft_id, self._operator_actor())
                if snapshot is None:
                    self._send_json({"error": "switching draft not found"}, 404)
                    return
                try:
                    body, digest = build_switching_bundle(snapshot)
                except ValueError as exc:
                    self._send_json({"error": str(exc)}, 413)
                    return
                slug = re.sub(
                    r"[^a-z0-9]+",
                    "-",
                    str(snapshot["package"].get("packageName") or draft_id).lower(),
                ).strip("-")[:80]
                self._send_binary(
                    body,
                    "application/zip",
                    f"northstar-{slug or draft_id}-controlled-bundle.zip",
                    digest,
                )
                return
            if suffix.endswith("/review-evidence"):
                draft_id = suffix[:-len("/review-evidence")]
                evidence = store.get_switching_review_evidence(draft_id)
                self._send_json(evidence or {"error": "switching draft not found"}, 200 if evidence else 404)
                return
            attachment_match = re.fullmatch(r"([^/]+)/attachments/([^/]+)", suffix)
            if attachment_match:
                attachment = store.get_switching_attachment(*attachment_match.groups())
                if attachment is None:
                    self._send_json({"error": "switching attachment not found"}, 404)
                    return
                self._send_binary(
                    attachment.pop("content"),
                    attachment["type"],
                    attachment["name"],
                    attachment["sha256"],
                )
                return
            draft_id = suffix
            if not draft_id or "/" in draft_id:
                self.send_error(404)
                return
            record = store.get_switching_draft(draft_id)
            self._send_json(record or {"error": "switching draft not found"}, 200 if record else 404)
            return
        if route == "/api/schematics":
            query = parse_qs(urlparse(self.path).query)
            try:
                limit = int(query.get("limit", ["100"])[0])
            except ValueError:
                limit = 100
            self._send_json(store.list_one_line_documents(
                query.get("q", [None])[0], query.get("outageId", [None])[0], limit
            ))
            return
        if route.startswith("/api/schematics/"):
            suffix = route[len("/api/schematics/"):]
            revision_match = re.fullmatch(r"([^/]+)/revisions/(\d+)", suffix)
            if revision_match:
                record = store.get_one_line_document(
                    revision_match.group(1), int(revision_match.group(2))
                )
            elif suffix and "/" not in suffix:
                record = store.get_one_line_document(suffix)
            else:
                self.send_error(404)
                return
            self._send_json(record or {"error": "schematic not found"}, 200 if record else 404)
            return
        if route == "/api/checkin-tokens":
            query = parse_qs(urlparse(self.path).query)
            site = query.get("site", [""])[0].strip()
            try:
                records = [phase1.issue_site_token(site)] if site else phase1.list_site_tokens()
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 400)
                return
            self._send_json(records)
            return
        if self.path.split("?", 1)[0] == "/api/checkin-tokens/resolve":
            token = parse_qs(urlparse(self.path).query).get("token", [""])[0]
            record = phase1.resolve_site_token(token)
            self._send_json(record or {"error": "invalid or expired site QR token"}, 200 if record else 404)
            return
        if self.path.split("?", 1)[0] == "/api/retention":
            self._send_json(phase1.list_retention_policies())
            return
        if self.path.split("?", 1)[0] == "/api/site-policies":
            self._send_json(phase1.list_site_policies())
            return
        if self.path.split("?", 1)[0] == "/api/scada":
            self._send_json(phase1.scada_snapshot())
            return
        if self.path.split("?", 1)[0] == "/api/scada/readings":
            query = parse_qs(urlparse(self.path).query)
            try:
                limit = int(query.get("limit", ["100"])[0])
            except ValueError:
                limit = 100
            self._send_json(phase1.latest_scada_readings(limit, query.get("feed", [None])[0], query.get("tag")))
            return
        if self.path.split("?", 1)[0] == "/api/flows":
            self._send_json(FLOWS.get())
            return
        if route == "/api/water-elevations/catalog":
            self._send_json(WATER_ELEVATIONS.catalog())
            return
        if route == "/api/water-elevations":
            try:
                self._send_json(WATER_ELEVATIONS.get(parse_qs(urlparse(self.path).query)))
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 400)
            except water_elevations.ProviderError as exc:
                self._send_json({"error": str(exc)}, 503)
            return
        if self.path.split("?", 1)[0] == "/api/water-management/catalog":
            catalog_path = ROOT / "data" / "water-management" / "catalog.json"
            try:
                catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                self._send_json({"error": "water management catalog unavailable"}, 503)
                return
            self._send_json(catalog)
            return
        if route == "/api/data-catalog":
            query = parse_qs(urlparse(self.path).query)
            self._send_json(data_catalog.snapshot(
                query=query.get("q", [""])[0],
                collection_id=query.get("collectionId", [""])[0],
                limit=query.get("limit", [100])[0],
                cursor=query.get("cursor", [""])[0],
            ))
            return
        if route == "/api/water-management/rows":
            query = parse_qs(urlparse(self.path).query)
            try:
                self._send_json(data_catalog.query_water_rows(
                    file_id=query.get("fileId", [""])[0],
                    query=query.get("q", [""])[0],
                    cursor=query.get("cursor", [0])[0],
                    limit=query.get("limit", [100])[0],
                ))
            except (TypeError, ValueError) as exc:
                self._send_json({"error": str(exc)}, 400)
            return
        if route == "/api/water-management/files":
            query = parse_qs(urlparse(self.path).query)
            try:
                self._send_json(data_catalog.list_water_files(
                    query=query.get("q", [""])[0],
                    cursor=query.get("cursor", [""])[0],
                    limit=query.get("limit", [100])[0],
                ))
            except (TypeError, ValueError) as exc:
                self._send_json({"error": str(exc)}, 400)
            return
        if self.path.split("?", 1)[0] == "/api/ieso-streams":
            self._send_json({**ieso_streams.snapshot(), "advisories": ADVISORIES.get()})
            return
        if self.path.split("?", 1)[0] == "/api/ieso-report":
            query = parse_qs(urlparse(self.path).query)
            try:
                self._send_json(ieso_streams.report(query.get("id", [""])[0]))
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 400)
            return
        if self.path.split("?", 1)[0] == "/api/ieso-streams":
            self._send_json({**ieso_streams.snapshot(), "advisories": ADVISORIES.get()})
            return
        if self.path.split("?", 1)[0] == "/api/ieso-report":
            query = parse_qs(urlparse(self.path).query)
            try:
                self._send_json(ieso_streams.report(query.get("id", [""])[0]))
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 400)
            return
        if self.path.split("?", 1)[0] == "/api/market-history":
            query = parse_qs(urlparse(self.path).query)
            try:
                self._send_json(market_history.snapshot(
                    query.get("date", [""])[0], cache_dir=ROOT / "data" / "market-history",
                    report_url=report_url, download=download_text, parse=parse_report, patterns=NODE_PATTERNS))
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 400)
            except BlockingIOError as exc:
                self._send_json({"error": str(exc)}, 503)
            except LookupError as exc:
                self._send_json({"error": str(exc)}, 502)
            return
        if self.path.split("?", 1)[0] == "/api/market-prices":
            body = json.dumps(STORE.get(), separators=(",", ":")).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.split("?", 1)[0] == "/api/weather":
            self._send_json(weather_snapshot())
            return
        if self.path.split("?", 1)[0] == "/api/checkins":
            if self._is_platform_demo():
                self._send_json(demo_roster.roster(PLATFORM_DEMO_STATION_NAMES, sites.SYSTEM_ID))
                return
            query = parse_qs(urlparse(self.path).query)
            include_closed = query.get("include", [""])[0] == "all"
            self._send_json([checkin_response(row) for row in store.list_checkins(include_closed)])
            return
        if self.path.split("?", 1)[0] == "/api/checkins/history":
            query = parse_qs(urlparse(self.path).query)
            checkin_id = query.get("id", [""])[0] or None
            try:
                limit = int(query.get("limit", ["250"])[0])
            except ValueError:
                limit = 250
            self._send_json(store.history(checkin_id, limit))
            return
        if self.path.split("?", 1)[0].startswith("/api/checkins/"):
            # A worker device polls only its own record. The roster carries every
            # worker's name, phone and GPS, so it stays operator-only.
            checkin_id = self.path.split("?", 1)[0][len("/api/checkins/"):]
            record = checkin_response(store.get_checkin(checkin_id))
            self._send_json(record or {"error": "check-in not found"}, 200 if record else 404)
            return
        if route == "/api/voice":
            self._send_json(voice.voice_snapshot())
            return
        if route == "/api/voice/recordings":
            query = parse_qs(urlparse(self.path).query)
            try:
                limit = int(query.get("limit", ["100"])[0])
            except ValueError:
                limit = 100
            self._send_json(voice.list_recordings(limit))
            return
        if route.startswith("/api/voice/recordings/"):
            recording_id = route[len("/api/voice/recordings/"):]
            query = parse_qs(urlparse(self.path).query)
            # Filtered segments are withheld from the operational view, never
            # deleted; an operator can always ask to see what was set aside.
            include = query.get("include", ["all"])[0] != "operational"
            record = voice.get_recording(recording_id, include_filtered=include)
            self._send_json(record or {"error": "recording not found"}, 200 if record else 404)
            return
        if route == "/api/sites":
            if self._is_platform_demo():
                self._send_json({"stations": [{"id": row["id"], "name": row["name"]} for row in sites.stations()]})
                return
            if self._is_demo_site_viewer():
                self._send_json({
                    "sites": [{"name": row["name"]} for row in sites.stations()]
                })
                return
            self._send_json(sites.payload())
            return
        if route == "/api/uwpc":
            self._send_json(uwpc.payload())
            return
        if route == "/api/uwpc/book":
            path = uwpc.book_path()
            if not uwpc.book_available():
                self._send_json({"error": "UWPC 2024 book is not installed on this host"}, 404)
                return
            self._send_binary(
                path.read_bytes(),
                "application/pdf",
                "uwpc-2024.pdf",
                uwpc.book_digest(),
                inline=True,
            )
            return
        if route == "/api/library/procedures":
            query = parse_qs(urlparse(self.path).query)
            self._send_json(sop_library.catalog(query.get("siteId", [""])[0]))
            return
        procedure_file = re.fullmatch(r"/api/library/procedures/([a-z0-9-]+)/file", route)
        if procedure_file:
            try:
                procedure, body = sop_library.read_document(procedure_file.group(1))
            except sop_library.DocumentIntegrityError as exc:
                self._send_json({"error": str(exc)}, 409)
                return
            except LookupError as exc:
                self._send_json({"error": str(exc)}, 404)
                return
            self._send_binary(
                body,
                "application/pdf",
                procedure["filename"],
                procedure["sha256"],
                inline=True,
            )
            return
        if route == "/api/library":
            query = parse_qs(urlparse(self.path).query)
            self._send_json(device_library.tree(query.get("q", [""])[0]))
            return
        if route == "/api/library/item":
            query = parse_qs(urlparse(self.path).query)
            try:
                result = device_library.item(query.get("id", [""])[0])
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 400)
                return
            except LookupError as exc:
                self._send_json({"error": str(exc)}, 404)
                return
            self._send_json(result)
            return
        if route == "/api/maximo":
            self._send_json(maximo.status())
            return
        if route == "/api/maximo/equipment":
            query = parse_qs(urlparse(self.path).query)
            try:
                result = maximo.equipment(
                    query=query.get("q", [""])[0],
                    site=query.get("site", [""])[0],
                    page=query.get("page", [1])[0],
                    limit=query.get("limit", [maximo.EQUIPMENT_PAGE_SIZE])[0],
                )
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 400)
                return
            self._send_json(result)
            return
        if route == "/api/maximo/station":
            query = parse_qs(urlparse(self.path).query)
            try:
                result = maximo.station(query.get("id", [""])[0])
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 400)
                return
            except LookupError as exc:
                self._send_json({"error": str(exc)}, 404)
                return
            self._send_json(result)
            return
        if self.path.split("?", 1)[0] == "/api/logbook":
            query = parse_qs(urlparse(self.path).query)
            try:
                limit = int(query.get("limit", ["250"])[0])
            except ValueError:
                limit = 250
            self._send_json(store.list_logbook(limit))
            return
        event_route = self.path.split("?", 1)[0]
        if event_route in {"/api/events/register", "/api/events/detail", "/api/events/sources"}:
            query = parse_qs(urlparse(self.path).query)
            try:
                if event_route.endswith("/sources"):
                    result = event_register.sources()
                elif event_route.endswith("/detail"):
                    result = event_register.detail(query.get("id", [""])[0], query)
                else:
                    result = event_register.register(query)
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 400)
                return
            except LookupError as exc:
                self._send_json({"error": str(exc)}, 404)
                return
            self._send_json(result)
            return
        if self.path.split("?", 1)[0].startswith("/api/ai/knowledge"):
            self._knowledge_request()
            return
        if self.path.split("?", 1)[0] == "/api/ai/status":
            result = ai.status()
            result["knowledge"] = operator_knowledge.status(self._operator_actor())
            self._send_json(result)
            return
        if self.path.split("?", 1)[0] == "/api/ai/workspace":
            self._send_json(ai_history.list_workspace(self._operator_actor()))
            return
        conversation_match = re.fullmatch(r"/api/ai/conversations/([^/]+)", self.path.split("?", 1)[0])
        if conversation_match:
            try:
                self._send_json(ai_history.get_conversation(self._operator_actor(), conversation_match.group(1)))
            except ai_history.AIHistoryError as exc:
                self._send_json({"error": str(exc)}, 404)
            return
        if route == "/api/avatars":
            self._send_json({"avatars": avatars.CATALOG, "defaultAvatarId": avatars.DEFAULT_AVATAR})
            return
        if route == "/api/profile/avatar":
            self._send_json(avatars.get_profile(self._operator_actor()))
            return
        if self.path.split("?", 1)[0] == "/api/chat/status":
            self._send_json(chat.status())
            return
        if self.path.split("?", 1)[0] == "/api/microsoft/outlook/status":
            self._send_json(microsoft.outlook_status())
            return
        if route == "/api/microsoft/graph/status":
            self._send_json(graph.status())
            return
        if route == "/api/microsoft/graph/profile":
            try:
                self._send_json(graph.profile())
            except graph.GraphError as exc:
                self._send_json({"error": str(exc)}, 503)
            return
        if route == "/api/microsoft/graph/messages":
            try:
                query = parse_qs(urlparse(self.path).query)
                limit = int(query.get("limit", ["25"])[0])
                self._send_json(graph.messages(limit))
            except (graph.GraphError, ValueError) as exc:
                self._send_json({"error": str(exc)}, 503 if isinstance(exc, graph.GraphError) else 400)
            return
        if self.path.split("?", 1)[0] == "/api/chat/rooms":
            self._send_json({"rooms": chat.list_rooms()})
            return
        if self.path.split("?", 1)[0] == "/api/chat/messages":
            query = parse_qs(urlparse(self.path).query)
            room_id = (query.get("room", ["general"])[0] or "general").strip().lower()
            since = (query.get("since", [""])[0] or "").strip() or None
            try:
                limit = int(query.get("limit", ["100"])[0])
            except ValueError:
                limit = 100
            try:
                self._send_json({
                    "roomId": room_id,
                    "messages": chat.list_messages(room_id, limit=limit, since=since),
                })
            except chat.ChatError as exc:
                self._send_json({"error": str(exc)}, 400)
            return
        if self.path.split("?", 1)[0] == "/api/dispatch/apiroq":
            self._send_json(dispatch.snapshot())
            return
        if self.path.split("?", 1)[0] == "/api/client-release":
            try:
                self._send_json(client_release.observe_current_release())
            except ValueError:
                self._send_json({"error": "client release metadata is unavailable"}, 503)
            return
        if self.path.split("?", 1)[0] == "/api/events":
            query = parse_qs(urlparse(self.path).query)
            try:
                limit = int(query.get("limit", ["250"])[0])
            except ValueError:
                limit = 250
            self._send_json(store.list_audit_events(
                limit,
                query=query.get("q", [""])[0],
                event_type=query.get("eventType", [""])[0],
                aggregate_type=query.get("aggregateType", [""])[0],
                aggregate_id=query.get("aggregateId", [""])[0],
                actor_id=query.get("actorId", [""])[0],
                source=query.get("source", [""])[0],
                severity=query.get("severity", [""])[0],
                correlation_id=query.get("correlationId", [""])[0],
                occurred_from=query.get("from", [""])[0],
                occurred_to=query.get("to", [""])[0],
            ))
            return
        if self.path.split("?", 1)[0] == "/api/outages":
            self._send_json(store.list_outages())
            return
        if self.path.split("?", 1)[0] == "/api/outages/history":
            query = parse_qs(urlparse(self.path).query)
            outage_id = query.get("id", [""])[0] or None
            try:
                limit = int(query.get("limit", ["250"])[0])
            except ValueError:
                limit = 250
            self._send_json(store.outage_history(outage_id, limit))
            return
        if self.path.split("?", 1)[0] == "/api/alerts/settings":
            self._send_json(store.list_alert_settings())
            return
        if self.path.split("?", 1)[0] == "/api/market-alarm-rules":
            self._send_json(store.list_market_alarm_rules())
            return
        if self.path.split("?", 1)[0] == "/api/alerts/history":
            query = parse_qs(urlparse(self.path).query)
            alert_id = query.get("id", [""])[0] or None
            try:
                limit = int(query.get("limit", ["250"])[0])
            except ValueError:
                limit = 250
            self._send_json(store.alert_history(alert_id, limit))
            return
        if self.path.split("?", 1)[0] == "/api/alerts":
            query = parse_qs(urlparse(self.path).query)
            self._send_json(store.list_alerts(query.get("include", [""])[0] == "all"))
            return
        if self.path == "/":
            self.path = "/northstar-clean.html"
        if self._static_forbidden():
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self) -> None:
        # SimpleHTTPRequestHandler's inherited HEAD bypasses do_GET and its gates.
        if self._refused_before_dispatch():
            return
        if scada_workbench.handle(self):
            return
        route = self.path.split("?", 1)[0]
        if route.startswith("/api/"):
            self.send_error(405)
            return
        if self._is_platform_demo() and route in PLATFORM_DEMO_ENTRYPOINTS:
            self.path = "/northstar-clean.html"
        elif self._is_demo_site_viewer() and route in DEMO_VIEWER_ENTRYPOINTS:
            self.path = "/demo-sites.html"
        if self._static_forbidden():
            self.send_error(404)
            return
        super().do_HEAD()

    def _static_forbidden(self) -> bool:
        """True for anything under this directory that is not a web asset."""
        route = self.path.split("?", 1)[0]
        # Logging out must not become a way to download company-bearing scripts
        # or HTML snapshots. Keep only the sign-in and worker shell public.
        if OPERATOR_GATE == "demo" and not self._demo_actor():
            public_assets = CHECKIN_PUBLIC_ROUTES | {"/operator-login.html", "/northstar-symbol.png"}
            if route not in public_assets and not any(route.startswith(prefix) for prefix in CHECKIN_PUBLIC_PREFIXES):
                return True
        parts = [p for p in unquote(route).split("/") if p and p != "."]
        if not parts:
            return True
        # Dotfiles (.northstar-qr-secret, .env, .git) and traversal attempts.
        if any(part.startswith(".") for part in parts):
            return True
        if any(part.lower() in STATIC_DENY_DIRS for part in parts[:-1]):
            return True
        return Path(parts[-1]).suffix.lower() not in STATIC_ALLOW_SUFFIXES

    def list_directory(self, path: str) -> None:
        # Directory listings advertised the database, the backups and the secret
        # by name. There is no reason to browse this tree over HTTP.
        self.send_error(404)
        return None

    def _json_body(self, maximum: int = MAX_JSON_BODY) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise APIError(400, "invalid Content-Length") from exc
        if length < 0:
            raise APIError(400, "invalid Content-Length")
        if length > maximum:
            raise APIError(413, f"JSON request body exceeds {maximum} bytes")
        if not length:
            return {}
        try:
            value = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise APIError(400, "request body must be valid JSON") from exc
        if not isinstance(value, dict):
            raise APIError(400, "request body must be a JSON object")
        return value

    def _binary_body(self, maximum: int) -> bytes:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise APIError(400, "invalid Content-Length") from exc
        if length < 1:
            raise APIError(400, "binary request body is required")
        if length > maximum:
            raise APIError(413, f"binary request body exceeds {maximum} bytes")
        content = self.rfile.read(length)
        if len(content) != length:
            raise APIError(400, "binary request body ended early")
        return content

    def do_POST(self) -> None:
        if self._refused_before_dispatch():
            return
        if scada_workbench.handle(self):
            return
        route = self.path.split("?", 1)[0]
        if self._training_simulator_request():
            return
        if route == "/api/services":
            try:self._send_json(services.update(self._json_body(8192),self._operator_actor()))
            except ValueError as exc:self._send_json({"error":str(exc)},400)
            except OSError:self._send_json({"error":"Service settings could not be saved"},503)
            return
        blocked=services.blocked_api(route,self.command)
        if blocked:
            self._send_json({"error":"Service is stopped in Service controls", "service":blocked},503)
            return
        if route.startswith("/api/inflows/"):
            try:
                params = {k: v[0] for k,v in parse_qs(urlparse(self.path).query).items()}
                self._send_json(inflow.request(self.command, route, params), 202 if self.command == "POST" else 200)
            except LookupError:
                self._send_json({"error": "Inflow route not found"}, 404)
            except (ValueError, OSError):
                self._send_json({"error": "Inflow service unavailable; inspect collection status"}, 503)
            return
        if route.startswith(("/api/data-workspace/", "/api/water-collection/", "/api/daily-report/")):
            self._data_workspace_request()
            return
        if route.startswith("/api/console/"):
            self._console_request()
            return
        if route in {"/api/auth/login", "/api/auth/logout"}:
            try:
                if route == "/api/auth/login":
                    self._demo_login()
                else:
                    self._demo_logout()
            except APIError as exc:
                self._send_json({"error": exc.message}, exc.status)
            except Exception as exc:
                # Never let an authentication fault print a credential.
                print(f"API POST {route} failed: {type(exc).__name__}")
                self._send_json({"error": "internal server error"}, 500)
            return
        if route == "/api/microsoft/graph/connect":
            try:
                self._send_json(graph.begin_device_sign_in(), 202)
            except graph.GraphError as exc:
                self._send_json({"error": str(exc)}, 409 if "already" in str(exc) else 503)
            return
        try:
            self._do_POST()
        except APIError as exc:
            self._send_json({"error": exc.message}, exc.status)
        except Exception as exc:
            print(f"API POST {self.path} failed: {exc}")
            self._send_json({"error": "internal server error"}, 500)

    def _demo_auth_available(self) -> bool:
        """The login surface exists only in demo mode, on the operator host.

        `checkin.northstarenergy.ca` must not offer a second way to create an
        operator session, so the endpoint is not merely refused there — it does
        not exist there.
        """
        return OPERATOR_GATE == "demo" and self._is_operator_host()

    def _throttle_key(self) -> str:
        return f"{self._arrived_on()}:{self.client_address[0] if self.client_address else ''}"

    def _demo_session_state(self) -> None:
        """What the dashboard boot sequence asks before loading operator data."""
        if OPERATOR_GATE != "demo":
            # No demo gate in front of this deployment; the dashboard proceeds
            # as it always has (localhost development, or Cloudflare Access).
            self._send_json({"mode": OPERATOR_GATE, "required": False, "authenticated": False})
            return
        if not self._is_operator_host():
            self._send_json({"error": "not found"}, 404)
            return
        actor = self._demo_actor()
        role = self._demo_role()
        self._send_json(
            {
                "mode": "demo",
                "required": True,
                "authenticated": bool(actor),
                "username": actor,
                "role": role,
                "landingUrl": "/demo-sites.html" if role == auth.ROLE_SITE_VIEWER else "/northstar-clean.html",
                "loginUrl": "/operator-login.html",
            },
            200 if actor else 401,
        )

    def _demo_login(self) -> None:
        if not self._demo_auth_available():
            self._send_json({"error": "not found"}, 404)
            return
        if DEMO_AUTH is None:
            self._send_json(
                {"error": "demo authentication is not configured on this server"}, 503
            )
            return
        if self._cross_origin_write():
            self._send_json({"error": "cross-origin sign-in refused"}, 403)
            return
        allowed, retry_after = DEMO_LOGIN_THROTTLE.check(self._throttle_key())
        if not allowed:
            self.send_response(429)
            self.send_header("Retry-After", str(retry_after))
            body = json.dumps(
                {
                    "error": "too many failed sign-in attempts; try again later",
                    "retryAfter": retry_after,
                },
                separators=(",", ":"),
            ).encode()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        payload = self._json_body()
        username = str(payload.get("username", "") or "")
        password = str(payload.get("password", "") or "")
        disabled_message = auth.account_message(DEMO_AUTH, username)
        if disabled_message:
            self._send_json({"error": disabled_message}, 403)
            return
        if not auth.authenticates(DEMO_AUTH, username, password):
            # One message for a wrong username, a wrong password and a blank
            # one: which of the three it was is not the caller's business.
            DEMO_LOGIN_THROTTLE.record_failure(self._throttle_key())
            still_allowed, _ = DEMO_LOGIN_THROTTLE.check(self._throttle_key())
            if not still_allowed:
                # Logged once, when the limit trips — a line per failed guess
                # would let anyone flood the operational log from outside.
                log_event(
                    "Operator sign-in blocked",
                    "Repeated failed demo sign-in attempts",
                    f"{DEMO_LOGIN_THROTTLE.max_failures} failures within"
                    f" {DEMO_LOGIN_THROTTLE.window_seconds // 60} minutes;"
                    " further attempts from that caller are refused for the rest"
                    " of the window. No password value is recorded.",
                    "northstar-security",
                )
            self._send_json({"error": "invalid credentials"}, 401)
            return
        lifetime = demo_session_seconds()
        actor = auth.account(DEMO_AUTH, username)["username"]
        role = auth.account_role(DEMO_AUTH, actor)
        token, _ = DEMO_SESSIONS.create(actor, lifetime, role)
        DEMO_LOGIN_THROTTLE.reset(self._throttle_key())
        if role == auth.ROLE_SITE_VIEWER:
            log_event(
                "Demo site-viewer sign-in",
                f"Demo site viewer {actor} signed in",
                "Site-name-only demo session opened on the operator hostname.",
                actor,
            )
        elif role == auth.ROLE_PLATFORM_DEMO:
            log_event(
                "Platform demo sign-in",
                f"Platform demo {actor} signed in",
                "Read-only filtered demo session opened on the operator hostname.",
                actor,
            )
        else:
            log_event(
                "Operator sign-in",
                f"Demo operator {actor} signed in",
                "Demo authentication session opened on the operator hostname."
                " This is the single shared demo credential, not an employee identity.",
                actor,
            )
        body = json.dumps(
            {
                "authenticated": True,
                "username": actor,
                "role": role,
                "landingUrl": "/demo-sites.html" if role == auth.ROLE_SITE_VIEWER else "/northstar-clean.html",
                "expiresIn": lifetime,
            },
            separators=(",", ":"),
        ).encode()
        self.send_response(200)
        self.send_header("Set-Cookie", auth.set_cookie_value(token, lifetime))
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _demo_logout(self) -> None:
        if not self._demo_auth_available():
            self._send_json({"error": "not found"}, 404)
            return
        token = auth.cookie_token(self.headers.get("Cookie", ""))
        actor = DEMO_SESSIONS.actor(token)
        role = DEMO_SESSIONS.role(token)
        # The server-side session goes first: clearing the cookie alone would
        # leave a token that still works if it were ever replayed.
        DEMO_SESSIONS.destroy(token)
        if actor:
            log_event(
                "Demo site-viewer sign-out" if role == auth.ROLE_SITE_VIEWER else "Platform demo sign-out" if role == auth.ROLE_PLATFORM_DEMO else "Operator sign-out",
                f"Demo {'site viewer' if role == auth.ROLE_SITE_VIEWER else 'platform viewer' if role == auth.ROLE_PLATFORM_DEMO else 'operator'} {actor} signed out",
                "Demo authentication session invalidated on the server.",
                actor,
            )
        body = json.dumps({"authenticated": False}, separators=(",", ":")).encode()
        self.send_response(200)
        self.send_header("Set-Cookie", auth.clear_cookie_value())
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _do_POST(self) -> None:
        route = self.path.split("?", 1)[0]
        if route == "/api/profile/crew-layout":
            try:
                positions = self._json_body().get("positions") if self.command == "POST" else None
                if self.command == "POST" and positions is None:
                    raise ValueError("Positions required")
                actor = self._demo_actor() if OPERATOR_GATE == "demo" else self.headers.get("Cf-Access-Authenticated-User-Email", "") if OPERATOR_GATE == "access" else ""
                self._send_json(crew_profile.layout(actor, positions))
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 400)
            return
        if route == "/api/profile/station-popup":
            try:
                preference = self._json_body().get("preference")
                if preference is None:
                    raise ValueError("Preference required")
                actor = self._demo_actor() if OPERATOR_GATE == "demo" else self.headers.get("Cf-Access-Authenticated-User-Email", "") if OPERATOR_GATE == "access" else "local"
                self._send_json(station_popup_profile.preference(actor, preference))
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 400)
            return
        if self._uwpc_request_route(route):
            return
        if route == "/api/data-catalog/refresh":
            self._json_body(4 * 1024)
            self._send_json(data_catalog.refresh_known_sources(self._operator_actor()))
            return
        if route == "/api/water-management/ingest":
            self._json_body(4 * 1024)
            self._send_json(data_catalog.ingest_water_csvs(self._operator_actor()))
            return
        if route == "/api/events/notes":
            payload = self._json_body(40 * 1024)
            try:
                result = event_register.add_note(payload.get("eventId"), payload.get("text"), self._operator_actor(), payload.get("requestId"))
            except ValueError as exc:
                raise APIError(400, str(exc)) from exc
            except LookupError as exc:
                raise APIError(404, str(exc)) from exc
            self._send_json(result, 200 if result["duplicate"] else 201)
            return
        if route == "/api/library/notes":
            payload = self._json_body(40 * 1024)
            try:
                result = device_library.add_note(
                    payload.get("itemId"),
                    payload.get("text"),
                    self._operator_actor(),
                    payload.get("requestId"),
                    payload.get("expiresAt"),
                    payload.get("persistOn"),
                )
            except ValueError as exc:
                raise APIError(400, str(exc)) from exc
            except LookupError as exc:
                raise APIError(404, str(exc)) from exc
            self._send_json(result, 200 if result["duplicate"] else 201)
            return
        if route == "/api/ai/legacy":
            payload = self._json_body(16 * 1024)
            message = str(payload.get("message", "") or "").strip()
            if not message:
                raise APIError(400, "message is required")
            if len(message) > 4000:
                raise APIError(413, "message exceeds 4000 characters")
            conversation_id, question_id = event_register.record_chat(message, self._operator_actor())
            api_key = os.environ.get("OPENAI_API_KEY", "").strip()
            if not api_key:
                event_register.record_chat("AI service is not configured", "system", conversation_id, outcome="failed", causation_id=question_id)
                self._send_json({"error": "ai service is not configured"}, 503)
                return
            context = {
                "retrieved_at": datetime.now(TZ).isoformat(),
                "operational_summary": store.operational_summary(),
                "field_operations": store.field_operations_summary(),
                "recent_events": store.list_audit_events(limit=20),
                "active_alerts": store.list_alerts(include_resolved=False, limit=20),
                "scada_readings": phase1.latest_scada_readings(limit=20),
            }
            citations = [
                {"source": "northstar:operational_summary", "retrieved_at": context["retrieved_at"]},
                {"source": "northstar:field_operations", "retrieved_at": context["retrieved_at"]},
                {"source": "northstar:audit_events:latest-20", "retrieved_at": context["retrieved_at"]},
                {"source": "northstar:alerts:active", "retrieved_at": context["retrieved_at"]},
                {"source": "northstar:scada:latest-20", "retrieved_at": context["retrieved_at"]},
            ]
            request_body = json.dumps({
                "model": os.environ.get("NORTHSTAR_AI_MODEL", "gpt-5.4"),
                "instructions": "You are NorthStar's assistive control-room analyst. Use only the supplied NorthStar snapshot. Do not invent facts or imply that you authorized, approved, executed, or changed an operational action. Every factual statement must cite one of the supplied source IDs in brackets. If the snapshot does not answer the question, say that clearly. End with 'Uncertainty: high/medium/low/unknown' and choose unknown when evidence is missing or stale.",
                "input": "Question: " + message + "\n\nNorthStar snapshot:\n" + json.dumps({"data": context, "citation_sources": citations}, ensure_ascii=False, default=str),
                "store": False,
            }).encode("utf-8")
            request = Request("https://api.openai.com/v1/responses", data=request_body, headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }, method="POST")
            try:
                with urlopen(request, timeout=45) as response:
                    result = json.loads(response.read().decode("utf-8"))
                answer = result.get("output_text", "").strip()
                if not answer:
                    for item in result.get("output", []):
                        for content in item.get("content", []):
                            if content.get("type") == "output_text":
                                answer += content.get("text", "")
                event_register.record_chat(answer or "No answer was returned.", "Operations AI", conversation_id, outcome="answer", causation_id=question_id)
                self._send_json({"conversationId": conversation_id, "reply": answer or "No answer was returned.", "model": result.get("model", "unknown"), "citations": citations, "retrieved_at": context["retrieved_at"]})
            except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
                event_register.record_chat("AI service unavailable: " + type(exc).__name__, "system", conversation_id, outcome="failed", causation_id=question_id)
                print(f"AI request failed: {type(exc).__name__}")
                self._send_json({"error": "ai service unavailable"}, 503)
            return
        if route.startswith("/api/ai/knowledge"):
            self._knowledge_request(write=True)
            return
        if route in {"/api/ai", "/api/ai/query"}:
            self._ai_query()
            return
        if route == "/api/ai/projects":
            try:
                self._send_json(ai_history.create_project(self._operator_actor(), self._json_body().get("name")), 201)
            except ai_history.AIHistoryError as exc:
                raise APIError(400, str(exc)) from exc
            return
        if route == "/api/ai/conversations":
            payload = self._json_body()
            try:
                self._send_json(
                    ai_history.create_conversation(
                        self._operator_actor(),
                        title=payload.get("title"),
                        project_id=payload.get("projectId"),
                        scope=payload.get("scope"),
                    ),
                    201,
                )
            except ai_history.AIHistoryError as exc:
                raise APIError(400, str(exc)) from exc
            return
        project_match = re.fullmatch(r"/api/ai/conversations/([^/]+)/project", route)
        if project_match:
            try:
                payload = self._json_body()
                self._send_json(
                    ai_history.assign_project(
                        self._operator_actor(), project_match.group(1), payload.get("projectId")
                    )
                )
            except ai_history.AIHistoryError as exc:
                raise APIError(400, str(exc)) from exc
            return
        archive_match = re.fullmatch(r"/api/ai/conversations/([^/]+)/archive", route)
        if archive_match:
            try:
                payload = self._json_body()
                self._send_json(
                    ai_history.set_conversation_archived(
                        self._operator_actor(), archive_match.group(1), payload.get("archived", True)
                    )
                )
            except ai_history.AIHistoryError as exc:
                raise APIError(400, str(exc)) from exc
            return
        settings_match = re.fullmatch(r"/api/ai/conversations/([^/]+)/settings", route)
        if settings_match:
            payload = self._json_body()
            try:
                model, reasoning_effort = ai.validate_model_settings(
                    str(payload.get("model") or ""),
                    str(payload.get("reasoningEffort") or payload.get("reasoning_effort") or ""),
                )
                settings = ai_history.set_conversation_settings(
                    self._operator_actor(),
                    settings_match.group(1),
                    model=model,
                    reasoning_effort=reasoning_effort,
                )
                self._send_json(settings)
            except ValueError as exc:
                raise APIError(400, str(exc)) from exc
            except ai_history.AIHistoryError as exc:
                raise APIError(404, str(exc)) from exc
            return
        feedback_match = re.fullmatch(r"/api/ai/messages/([^/]+)/feedback", route)
        if feedback_match:
            payload = self._json_body()
            try:
                self._send_json(
                    ai_history.set_message_feedback(
                        self._operator_actor(),
                        feedback_match.group(1),
                        rating=payload.get("rating"),
                        correction=payload.get("correction"),
                    )
                )
            except ai_history.AIHistoryError as exc:
                raise APIError(400, str(exc)) from exc
            return
        if route == "/api/profile/avatar":
            payload = self._json_body()
            if self._cross_origin_write():
                raise APIError(403, "cross-origin profile request refused")
            try:
                self._send_json(avatars.save_profile(self._operator_actor(), payload.get("avatarId")))
            except ValueError as exc:
                raise APIError(400, str(exc)) from exc
            return
        if route == "/api/chat/messages":
            payload = self._json_body()
            try:
                record = chat.post_message(
                    str(payload.get("room") or payload.get("roomId") or "general").strip().lower(),
                    payload.get("body") or payload.get("text") or "",
                    author=self._operator_actor(),
                    post_to_teams=bool(payload.get("postToTeams")),
                )
            except chat.ChatError as exc:
                raise APIError(400, str(exc)) from exc
            self._send_json(record, 201)
            return
        if route == "/api/chat/teams/pull":
            result = chat.pull_teams_messages(actor=self._audit_actor(None))
            self._send_json(result)
            return
        if route == "/api/field-reports":
            try:
                record = store.create_field_report(self._json_body(), self._operator_actor())
            except ValueError as exc:
                raise APIError(400, str(exc)) from exc
            self._send_json(record, 201)
            return
        if route == "/api/daily-operations":
            try:
                record = store.create_daily_operation_report(self._json_body(), self._operator_actor())
            except ValueError as exc:
                raise APIError(400, str(exc)) from exc
            self._send_json(record, 201)
            return
        if route == "/api/unit-cycling":
            try:
                record = store.create_unit_cycling_record(self._json_body(), self._operator_actor())
            except ValueError as exc:
                raise APIError(400, str(exc)) from exc
            self._send_json(record, 201)
            return
        if route == "/api/water-observations":
            try:
                record = store.create_water_observation(self._json_body(), self._operator_actor())
            except ValueError as exc:
                raise APIError(400, str(exc)) from exc
            self._send_json(record, 201)
            return
        daily_draft = re.fullmatch(r"/api/daily-operations/([^/]+)/draft", route)
        if daily_draft:
            try:
                record = store.save_daily_operation_draft(daily_draft.group(1), self._json_body(), self._operator_actor())
            except (TypeError, ValueError) as exc:
                raise APIError(409 if "changed" in str(exc) else 400, str(exc)) from exc
            self._send_json(record or {"error": "daily operation report not found"}, 200 if record else 404)
            return
        daily_publish = re.fullmatch(r"/api/daily-operations/([^/]+)/publish", route)
        if daily_publish:
            try:
                record = store.publish_daily_operation_report(daily_publish.group(1), self._json_body(), self._operator_actor())
            except (TypeError, ValueError) as exc:
                raise APIError(409 if "changed" in str(exc) else 400, str(exc)) from exc
            self._send_json(record or {"error": "daily operation report not found"}, 200 if record else 404)
            return
        if route == "/api/controlled-sources":
            try:
                record = store.save_controlled_source(self._json_body(), self._operator_actor())
            except ValueError as exc:
                raise APIError(400, str(exc)) from exc
            self._send_json(record, 201)
            return
        if route == "/api/assets":
            try:
                record = store.save_asset(self._json_body(), self._operator_actor())
            except ValueError as exc:
                raise APIError(400, str(exc)) from exc
            self._send_json(record, 201)
            return
        decision_route = re.fullmatch(r"/api/governance-decisions/([^/]+)", route)
        if decision_route:
            try:
                record = store.save_governance_decision(unquote(decision_route.group(1)), self._json_body(), self._operator_actor())
            except ValueError as exc:
                raise APIError(400, str(exc)) from exc
            self._send_json(record or {"error": "governance decision not found"}, 200 if record else 404)
            return
        field_status = re.fullmatch(r"/api/field-reports/([^/]+)/status", route)
        if field_status:
            try:
                record = store.transition_field_report(field_status.group(1), self._json_body(), self._operator_actor())
            except (ValueError, TypeError) as exc:
                raise APIError(409 if "changed" in str(exc) else 400, str(exc)) from exc
            self._send_json(record or {"error": "field report not found"}, 200 if record else 404)
            return
        field_update = re.fullmatch(r"/api/field-reports/([^/]+)/updates", route)
        if field_update:
            try:
                record = store.add_field_report_update(field_update.group(1), self._json_body(), self._operator_actor())
            except ValueError as exc:
                raise APIError(400, str(exc)) from exc
            self._send_json(record or {"error": "field report not found"}, 200 if record else 404)
            return
        field_attachment = re.fullmatch(r"/api/field-reports/([^/]+)/attachments", route)
        if field_attachment:
            filename = unquote(self.headers.get("X-Northstar-Filename", ""))
            content_type = self.headers.get("Content-Type", "application/octet-stream")
            try:
                content = self._binary_body(store.MAX_FIELD_ATTACHMENT_BYTES)
                record = store.add_field_report_attachment(field_attachment.group(1), filename, content_type, content, self._operator_actor())
            except ValueError as exc:
                raise APIError(400, str(exc)) from exc
            self._send_json(record or {"error": "field report not found"}, 201 if record else 404)
            return
        if route == "/api/action-items":
            try:
                record = store.create_action_item(self._json_body(), self._operator_actor())
            except ValueError as exc:
                raise APIError(400, str(exc)) from exc
            self._send_json(record, 201)
            return
        action_status = re.fullmatch(r"/api/action-items/([^/]+)/status", route)
        if action_status:
            try:
                record = store.transition_action_item(action_status.group(1), self._json_body(), self._operator_actor())
            except (ValueError, TypeError) as exc:
                raise APIError(409 if "changed" in str(exc) else 400, str(exc)) from exc
            self._send_json(record or {"error": "action item not found"}, 200 if record else 404)
            return
        route = self.path.split("?", 1)[0]
        if route == "/api/dashboard-layout-default":
            if self._operator_actor().casefold() != "ryan":
                raise APIError(403, "Only Ryan can publish the shared dashboard layout")
            payload = self._json_body(512 * 1024)
            try:
                previous = json.loads(DASHBOARD_LAYOUT_PATH.read_text(encoding="utf-8"))
                if not isinstance(previous, dict):
                    previous = {}
            except (OSError, json.JSONDecodeError):
                previous = {}
            payload.setdefault("layout", previous.get("layout", {}))
            payload.setdefault("preferences", previous.get("preferences", {}))
            payload.setdefault("statusLayout", previous.get("statusLayout"))
            if "moduleWorkspace" in payload:
                owner = "Ryan"
                if self._operator_actor().casefold() != owner.casefold():
                    raise APIError(403, "Only the dashboard workspace owner can publish module settings")
                payload["moduleWorkspaceOwner"] = owner
            else:
                if "moduleWorkspace" in previous:
                    payload["moduleWorkspace"] = previous["moduleWorkspace"]
                if "moduleWorkspaceOwner" in previous:
                    payload["moduleWorkspaceOwner"] = previous["moduleWorkspaceOwner"]
            if "layoutStorage" not in payload and "layoutStorage" in previous:
                payload["layoutStorage"] = previous["layoutStorage"]
            saved = normalize_dashboard_layout(payload)
            write_dashboard_layout_default(saved)
            self._send_json({"saved": True})
            return
        if route == "/api/schematics":
            payload = self._json_body(600 * 1024)
            try:
                record = store.create_one_line_document(payload, self._operator_actor())
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 400)
                return
            self._send_json(record, 201)
            return
        if route.startswith("/api/schematics/"):
            schematic_id = route[len("/api/schematics/"):]
            if not schematic_id or "/" in schematic_id:
                self.send_error(404)
                return
            payload = self._json_body(600 * 1024)
            try:
                record = store.save_one_line_document(
                    schematic_id, payload, self._operator_actor()
                )
            except store.SchematicConflict as exc:
                self._send_json({"error": str(exc)}, 409)
                return
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 400)
                return
            self._send_json(record or {"error": "schematic not found"}, 200 if record else 404)
            return
        if route == "/api/switching/drafts":
            payload = self._json_body()
            actor = self._operator_actor()
            draft_id = str(payload.get("id", "")).strip()
            try:
                record = (
                    store.save_switching_draft(draft_id, payload, actor)
                    if draft_id
                    else store.create_switching_draft(payload, actor)
                )
            except store.SwitchingConflict as exc:
                self._send_json({"error": str(exc)}, 409)
                return
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 400)
                return
            if record is None:
                self._send_json({"error": "switching draft not found"}, 404)
                return
            log_switching_event(record, "Draft created" if not draft_id else "Draft saved", actor)
            self._send_json(record, 200 if draft_id else 201)
            return
        if route.startswith("/api/switching/drafts/"):
            suffix = route[len("/api/switching/drafts/"):]
            parts = suffix.split("/")
            if not parts[0] or len(parts) > 2:
                self.send_error(404)
                return
            draft_id = parts[0]
            actor = self._operator_actor()
            if len(parts) == 1:
                payload = self._json_body()
                try:
                    record = store.save_switching_draft(draft_id, payload, actor)
                except store.SwitchingConflict as exc:
                    self._send_json({"error": str(exc)}, 409)
                    return
                except ValueError as exc:
                    self._send_json({"error": str(exc)}, 400)
                    return
            elif parts[1] == "attachments":
                query = parse_qs(urlparse(self.path).query)
                kind = query.get("kind", [""])[0]
                filename = unquote(self.headers.get("X-Northstar-Filename", ""))
                try:
                    content = self._binary_body(store.MAX_SWITCHING_ATTACHMENT_BYTES)
                    record = store.add_switching_attachment(
                        draft_id,
                        kind,
                        filename,
                        self.headers.get("Content-Type", "application/octet-stream"),
                        content,
                        actor,
                    )
                except ValueError as exc:
                    self._send_json({"error": str(exc)}, 400)
                    return
            elif parts[1] == "ready":
                payload = self._json_body()
                try:
                    record = store.mark_switching_draft_ready(draft_id, actor, payload.get("version"))
                except store.SwitchingConflict as exc:
                    self._send_json({"error": str(exc)}, 409)
                    return
                except ValueError as exc:
                    self._send_json({"error": str(exc)}, 400)
                    return
            elif parts[1] == "clone":
                payload = self._json_body()
                try:
                    record = store.clone_switching_draft(
                        draft_id, actor, payload.get("version")
                    )
                except store.SwitchingConflict as exc:
                    self._send_json({"error": str(exc)}, 409)
                    return
                except ValueError as exc:
                    self._send_json({"error": str(exc)}, 400)
                    return
            elif parts[1] == "review":
                payload = self._json_body()
                try:
                    record = store.record_switching_review(draft_id, payload, actor)
                except store.SwitchingConflict as exc:
                    self._send_json({"error": str(exc)}, 409)
                    return
                except ValueError as exc:
                    self._send_json({"error": str(exc)}, 400)
                    return
            else:
                self.send_error(404)
                return
            if record:
                action = {
                    "ready": "Marked ready for qualified review",
                    "review": "Qualified review recorded - not release",
                    "clone": "New draft revision created",
                }.get(parts[1], "Draft saved") if len(parts) == 2 else "Draft saved"
                log_switching_event(record, action, actor)
            response_status = 201 if len(parts) == 2 and parts[1] == "clone" else 200
            self._send_json(
                record or {"error": "switching draft not found"},
                response_status if record else 404,
            )
            return
        if self.path == "/api/checkin-tokens":
            payload = self._json_body()
            try:
                record = phase1.issue_site_token(
                    payload.get("siteCode") or payload.get("site"),
                    bool(payload.get("rotate")),
                    str(payload.get("placardLocation", "")),
                )
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 400)
                return
            self._send_json(record, 201)
            return
        if self.path == "/api/phone-verifications":
            payload = self._json_body()
            try:
                record = phase1.request_phone_verification(
                    str(payload.get("qrToken") or payload.get("token") or ""),
                    payload.get("phone"),
                    self.client_address[0] if self.client_address else "",
                )
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 400)
                return
            log_event(
                "Phone verification",
                "Contractor phone verification requested",
                f"Delivery mode: {record['deliveryMode']}; code was not sent by this pilot."
                if record["deliveryMode"] != "dev"
                else "Development verification code issued; live SMS remains disconnected.",
                "northstar-security",
            )
            self._send_json(record, 201)
            return
        if self.path.startswith("/api/phone-verifications/") and self.path.endswith("/verify"):
            verification_id = self.path[len("/api/phone-verifications/"):-len("/verify")]
            payload = self._json_body()
            try:
                record = phase1.verify_phone_verification(verification_id, payload.get("code"))
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 400)
                return
            self._send_json(record)
            return
        if self.path == "/api/retention":
            try:
                record = phase1.set_retention_policy(self._json_body())
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 400)
                return
            self._send_json(record, 201)
            return
        if self.path == "/api/site-policies":
            try:
                record = phase1.set_site_policy(self._json_body())
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 400)
                return
            self._send_json(record)
            return
        if self.path == "/api/scada/import":
            payload = self._json_body()
            try:
                record = phase1.import_scada_content(
                    str(payload.get("feedCode", "default")),
                    str(payload.get("fileName", "manual-report.csv")),
                    str(payload.get("content", "")),
                )
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 400)
                return
            if record.get("status") == "Imported":
                log_event(
                    "SCADA import",
                    f"{record.get('fileName', 'Report')} imported",
                    f"Imported {record.get('imported', 0)} readings; rejected {record.get('rejected', 0)} rows.",
                    "northstar-scada",
                )
            self._send_json(record, 201 if record.get("status") == "Imported" else 400)
            return
        if self.path == "/api/alerts/settings":
            payload = self._json_body()
            try:
                record = store.set_alert_setting(payload)
            except ValueError as exc:
                self.send_error(400, str(exc))
                return
            log_event(
                "Alert settings",
                f"{record['node']} pricing thresholds updated",
                f"low={record['low']}, high={record['high']}, actions: "
                + (", ".join(str(action) for action in record["actions"]) or "none"),
                self._audit_actor(None, "operator"),
            )
            # Score the new limits against the current price now rather than
            # leaving the operator up to five minutes without the alarm they
            # just configured.
            try:
                evaluate_alerts()
            except Exception as exc:
                print(f"price alert evaluation failed after settings change: {exc}")
            self._send_json(record, 201)
            return
        if self.path == "/api/market-alarm-rules":
            payload = self._json_body()
            try:
                record = store.set_market_alarm_rule(payload)
            except ValueError as exc:
                self.send_error(400, str(exc))
                return
            log_event(
                "Market alarm settings",
                f"{record['label']} alarm updated",
                f"Level {record['level']}; enabled={record['enabled']}; low={record['low']};"
                f" high={record['high']}; primary={record['primaryThreshold']};"
                f" secondary={record['secondaryThreshold']}",
                self._audit_actor(None, "operator"),
            )
            try:
                evaluate_alerts()
            except Exception as exc:
                print(f"market alarm evaluation failed after settings change: {exc}")
            self._send_json(record, 201)
            return
        if self.path == "/api/alerts/clear":
            # Clearing silences the alarm and records who silenced it. It does
            # not end the alert: only the price returning inside the limit does.
            payload = self._json_body()
            alert_id = str(payload.get("id", ""))
            actor = self._audit_actor(payload.get("actor"), "operator")
            previous = store.list_alerts(include_resolved=True)
            was_active = any(
                row["id"] == alert_id and row["state"] == store.ALERT_ACTIVE for row in previous
            )
            record = store.acknowledge_alert(alert_id, actor)
            if record and was_active:
                log_event(
                    "Price alert acknowledged",
                    f"{record['node']} {record['kind']} alert acknowledged by {actor}",
                    f"${record['price']:.2f} against limit ${record['threshold']:.2f}."
                    " The alarm stays open until the price recovers.",
                    actor,
                )
            self._send_json(record or {"error": "alert not found"}, 200 if record else 404)
            return
        if self.path == "/api/logbook":
            payload = self._json_body()
            subject = str(payload.get("subject", "")).strip()
            if not subject:
                self.send_error(400, "subject is required")
                return
            record = log_event(
                str(payload.get("type", "Operator action"))[:60],
                subject,
                str(payload.get("details", "")),
                self._audit_actor(payload.get("source"), "operator")[:40],
            )
            self._send_json(record, 201)
            return
        if self.path == "/api/outages":
            payload = self._json_body()
            actor = self._audit_actor(payload.get("actor"))
            try:
                record = store.create_outage(payload, actor)
            except ValueError as exc:
                self.send_error(400, str(exc))
                return
            log_event("Outage", record["title"], record["details"], actor)
            self._send_json(record, 201)
            return
        if self.path.startswith("/api/outages/") and self.path.endswith("/close"):
            outage_id = self.path[len("/api/outages/"):-len("/close")]
            payload = self._json_body()
            actor = self._audit_actor(payload.get("actor"))
            previous = store.get_outage(outage_id)
            try:
                record = store.close_outage(outage_id, actor, str(payload.get("details", "")))
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 409)
                return
            if record and previous and previous["status"] == "Open":
                log_event("Outage closed", record["title"], f"{record['site']} marked closed", actor)
            self._send_json(record or {"error": "outage not found"}, 200 if record else 404)
            return
        if self.path.startswith("/api/checkins/") and self.path.endswith("/time"):
            checkin_id = self.path[len("/api/checkins/"):-len("/time")]
            payload = self._json_body()
            field = payload.get("field")
            try:
                hour, minute = (int(part) for part in str(payload.get("time", "")).split(":"))
                if field not in ("checkedIn", "lastHeard") or not 0 <= hour <= 23 or not 0 <= minute <= 59:
                    raise ValueError
            except (TypeError, ValueError):
                self.send_error(400, "field and HH:MM time are required")
                return
            previous = store.get_checkin(checkin_id)
            record = store.adjust_time(checkin_id, field, hour, minute)
            if record:
                label = "check-in" if field == "checkedIn" else "last seen"
                log_event(
                    "Staff movement",
                    f"{record['name']} {label} time corrected",
                    f"{record['site']}: {previous[field]} -> {record[field]}",
                    "operator edit",
                )
            self._send_json(record or {"error": "check-in not found"}, 200 if record else 404)
            return
        if self.path.startswith("/api/checkins/") and self.path.endswith("/provisional"):
            checkin_id = self.path[len("/api/checkins/"):-len("/provisional")]
            payload = self._json_body()
            if not isinstance(payload.get("accept"), bool):
                self.send_error(400, "accept must be true or false")
                return
            accept = payload["accept"]
            actor = self._audit_actor(payload.get("actor"), "operator")
            previous = store.get_checkin(checkin_id)
            record = store.resolve_provisional(checkin_id, accept, actor)
            if record and previous and previous["status"] == store.STATUS_PROVISIONAL:
                phase1.record_acceptance(checkin_id, accept, actor)
                log_event(
                    "Staff movement",
                    f"{record['name']} provisional check-in {'accepted' if accept else 'rejected'}",
                    f"{record['site']}: {previous['status']} -> {record['status']}",
                    actor,
                )
            self._send_json(checkin_response(record) or {"error": "check-in not found"}, 200 if record else 404)
            return
        if self.path.startswith("/api/checkins/") and self.path.endswith("/help/acknowledge"):
            checkin_id = self.path[len("/api/checkins/"):-len("/help/acknowledge")]
            payload = self._json_body()
            actor = self._audit_actor(payload.get("actor"))
            previous = store.get_checkin(checkin_id)
            record = store.acknowledge_help(checkin_id, actor)
            if record and previous and previous["helpState"] == "requested":
                log_event(
                    "Staff help acknowledged",
                    f"{record['name']} help request acknowledged by {actor}",
                    f"{record['site']}: assistance remains open until explicitly resolved.",
                    actor,
                )
            self._send_json(record or {"error": "check-in not found"}, 200 if record else 404)
            return
        if self.path.startswith("/api/checkins/") and self.path.endswith("/help/resolve"):
            checkin_id = self.path[len("/api/checkins/"):-len("/help/resolve")]
            payload = self._json_body()
            actor = self._audit_actor(payload.get("actor"))
            previous = store.get_checkin(checkin_id)
            record = store.resolve_help(checkin_id, actor)
            if record and previous and previous["needsHelp"]:
                log_event(
                    "Staff help resolved",
                    f"{record['name']} help request resolved by {actor}",
                    f"{record['site']}: prior help state {previous['helpState']}.",
                    actor,
                )
            self._send_json(record or {"error": "check-in not found"}, 200 if record else 404)
            return
        if self.path.startswith("/api/checkins/") and self.path.endswith("/help"):
            checkin_id = self.path[len("/api/checkins/"):-len("/help")]
            payload = self._json_body()
            actor = str(payload.get("actor", "worker device")).strip()[:80] or "worker device"
            previous = store.get_checkin(checkin_id)
            try:
                record = store.request_help(checkin_id, actor)
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 409)
                return
            if record and previous and not previous["needsHelp"]:
                log_event(
                    "Staff help requested",
                    f"{record['name']} needs help at {record['site']}",
                    "Immediate operator attention required. External delivery remains in shadow mode;"
                    " no email, text, or Teams notification was sent.",
                    actor,
                )
            self._send_json(record or {"error": "check-in not found"}, 200 if record else 404)
            return
        if self.path.startswith("/api/checkins/") and self.path.endswith("/safety-checkin"):
            checkin_id = self.path[len("/api/checkins/"):-len("/safety-checkin")]
            self._json_body()
            record = store.record_heartbeat(checkin_id, actor=self._audit_actor(None, "manual safety check-in"))
            self._send_json(checkin_response(record) or {"error": "check-in not found"}, 200 if record else 404)
            return
        if self.path.startswith("/api/checkins/") and self.path.endswith("/heartbeat"):
            checkin_id = self.path[len("/api/checkins/"):-len("/heartbeat")]
            payload = self._json_body()
            record = store.record_device_heartbeat(
                checkin_id, payload.get("latitude"), payload.get("longitude")
            )
            if record:
                phase1.record_location(checkin_id, payload.get("latitude"), payload.get("longitude"))
            self._send_json(checkin_response(record) or {"error": "check-in not found"}, 200 if record else 404)
            return
        if self.path.split("?", 1)[0] == "/api/voice/upload":
            query = parse_qs(urlparse(self.path).query)
            content = self._binary_body(voice.MAX_UPLOAD_BYTES)
            try:
                record = voice.receive_upload(
                    query.get("name", [""])[0], content,
                    query.get("source", ["audio-upload"])[0], self._operator_actor(),
                )
            except ValueError as exc:
                raise APIError(400, str(exc)) from exc
            self._send_json(record, 200 if record.get("duplicate") else 201)
            return
        if self.path == "/api/voice/scan":
            results = voice.scan_inbox_once()
            transcribed = voice.transcribe_pending()
            for result in results:
                if result.get("action") == "Ingested":
                    log_event(
                        "Voice intake",
                        f"Audio received: {result.get('originalName')}",
                        f"{result.get('byteSize', 0)} bytes · awaiting transcription",
                        "northstar-voice",
                    )
            self._send_json({"ingested": results, "transcribed": transcribed})
            return
        if self.path.startswith("/api/voice/segments/") and self.path.endswith("/review"):
            segment_id = self.path[len("/api/voice/segments/"):-len("/review")]
            payload = self._json_body()
            try:
                updated = voice.review_segment(
                    segment_id,
                    str(payload.get("classification", "")).strip(),
                    self._operator_actor(),
                    str(payload.get("note", "")).strip(),
                )
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 400)
                return
            log_event(
                "Voice triage",
                "Operator reviewed a voice segment",
                f"{updated['classification']} · {updated.get('reviewNote', '')[:120]}",
                "northstar-voice",
            )
            self._send_json(updated)
            return
        if self.path == "/api/checkins":
            payload = self._json_body()
            try:
                prepared, security = phase1.prepare_checkin(payload)
                record = store.create_checkin(prepared)
                phase1.attach_checkin_security(record["id"], security)
            except ValueError as exc:
                self.send_error(400, str(exc))
                return
            phase1.record_location(record["id"], payload.get("latitude"), payload.get("longitude"))
            record = checkin_response(record)
            log_event(
                "Staff movement",
                f"{record['name']} checked in",
                f"{record['site']} · {record.get('verificationMethod', 'operator-entered')}",
                "check-in",
            )
            self._send_json(record, 201)
            return
        self.send_error(404)

    def do_DELETE(self) -> None:
        if self._refused_before_dispatch():
            return
        if scada_workbench.handle(self):
            return
        route = self.path.split("?", 1)[0]
        attachment_match = re.fullmatch(
            r"/api/switching/drafts/([^/]+)/attachments/([^/]+)", route
        )
        if attachment_match:
            try:
                record = store.remove_switching_attachment(
                    *attachment_match.groups(), self._operator_actor()
                )
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 400)
                return
            self._send_json(record or {"error": "switching draft not found"}, 200 if record else 404)
            return
        prefix = "/api/checkins/"
        if self.path.startswith(prefix):
            # Checking out closes the record; the operational history is retained.
            checkin_id = self.path[len(prefix):]
            record = store.check_out(checkin_id)
            if record:
                log_event("Staff movement", f"{record['name']} checked out", record["site"], "check-in")
            self._send_json(record or {"error": "check-in not found"}, 200 if record else 404)
            return
        self.send_error(404)

    def _knowledge_request(self, write: bool = False) -> None:
        route = urlparse(self.path).path
        actor = self._operator_actor()
        query = parse_qs(urlparse(self.path).query)
        try:
            match = re.fullmatch(r"/api/ai/knowledge/sources/([^/]+)(/file|/review)?", route)
            if write and route == "/api/ai/knowledge/upload":
                result = operator_knowledge.upload(self._json_body(maximum=8 * 1024 * 1024), actor)
            elif write and match and match.group(2) == "/review":
                result = operator_knowledge.review(match.group(1), self._json_body(), actor)
            elif not write and route == "/api/ai/knowledge":
                result = operator_knowledge.catalog(actor, query.get("siteId", [""])[0])
            elif not write and re.fullmatch(r"/api/ai/knowledge/records/[^/]+/[^/]+", route):
                table, record_id = route.rsplit("/", 2)[1:]
                result = operator_knowledge.get_record(table, unquote(record_id), actor)
            elif not write and route == "/api/ai/knowledge/search":
                result = {"results": operator_knowledge.search(query.get("q", [""])[0][:2000], site_id=query.get("siteId", [""])[0], actor=actor, reference_mode=query.get("reference", [""])[0] == "true")}
            elif not write and match and match.group(2) == "/file":
                source, raw, mime = operator_knowledge.read_file(match.group(1), actor)
                self._send_binary(raw, mime, source["filename"], source["sha256"], inline=False)
                return
            elif not write and match and not match.group(2):
                result = operator_knowledge.get_source(match.group(1), actor)
            else:
                self._send_json({"error": "Knowledge route not found"}, 404)
                return
            self._send_json(result)
        except operator_knowledge.KnowledgeDenied as exc:
            self._send_json({"error": str(exc)}, 403)
        except LookupError as exc:
            self._send_json({"error": str(exc)}, 404)
        except (ValueError, OSError) as exc:
            self._send_json({"error": str(exc)}, 400)

    def _ai_query(self) -> None:
        payload = self._json_body()
        question = str(payload.get("question") or payload.get("message") or "").strip()
        scope = str(payload.get("context_scope") or payload.get("scope") or "general").strip().lower()
        actor = self._operator_actor()
        try:
            site_id, _ = operator_knowledge.access(actor, payload.get("siteId"))
            if not isinstance(payload.get("referenceMode", False), bool):
                raise ValueError("referenceMode must be a boolean")
        except operator_knowledge.KnowledgeDenied as exc:
            self._send_json({"error": str(exc)}, 403)
            return
        except ValueError as exc:
            self._send_json({"error": str(exc)}, 400)
            return
        model = str(payload.get("model") or "").strip()
        reasoning_effort = str(payload.get("reasoning_effort") or "").strip().lower()
        response_profile = str(payload.get("response_profile") or "balanced").strip()
        if ai.engine_name() == "openai":
            try:
                model, reasoning_effort = ai.validate_model_settings(
                    model, reasoning_effort, response_profile
                )
            except ValueError as exc:
                self._send_json({"error": str(exc)}, 400)
                return
        conversation_id = question_id = None
        conversation_history: list[dict[str, str]] = []
        if question:
            try:
                conversation_id = str(payload.get("conversationId") or "").strip() or None
                if conversation_id:
                    conversation_history = ai_history.relevant_history(actor, conversation_id, question)
                else:
                    conversation = ai_history.create_conversation(
                        actor,
                        title=question,
                        project_id=payload.get("projectId"),
                        scope=scope,
                    )
                    conversation_id = conversation["id"]
                if ai.engine_name() == "openai":
                    ai_history.set_conversation_settings(
                        actor,
                        conversation_id,
                        model=model,
                        reasoning_effort=reasoning_effort,
                    )
                ai_history.append_message(actor, conversation_id, "user", question)
            except ai_history.AIHistoryError as exc:
                self._send_json({"error": str(exc)}, 404)
                return
            conversation_id, question_id = event_register.record_chat(
                question, actor, conversation_id=conversation_id
            )
        try:
            response = ai.query(
                question,
                context_scope=scope,
                actor=actor,
                market_snapshot=STORE.get(),
                weather_snapshot=dict(WEATHER_CACHE),
                event_filter=str(payload.get("event_filter") or "").strip(),
                section=str(payload.get("section") or "").strip(),
                model=model,
                response_profile=response_profile,
                reasoning_effort=reasoning_effort,
                site_id=site_id,
                reference_mode=payload.get("referenceMode", False),
                conversation_history=conversation_history,
                source_mode=str(payload.get("sourceMode") or "auto"),
            )
        except ai.AssistantUnavailable as exc:
            if conversation_id:
                ai_history.append_message(actor, conversation_id, "system", "AI surface is not configured")
                event_register.record_chat("AI surface is not configured", "system", conversation_id, outcome="failed", causation_id=question_id)
            self._send_json(
                {
                    "error": "ai surface not configured",
                    "detail": str(exc),
                    "disclaimer": ai.DISCLAIMER,
                    **({"conversationId": conversation_id} if conversation_id else {}),
                },
                501,
            )
            return
        except ai.ScopeDenied as exc:
            if conversation_id:
                ai_history.append_message(actor, conversation_id, "system", "AI scope was denied")
                event_register.record_chat("AI scope was denied", "system", conversation_id, outcome="failed", causation_id=question_id)
            self._send_json(
                {"error": str(exc), **({"conversationId": conversation_id} if conversation_id else {})},
                403,
            )
            return
        except ValueError as exc:
            if conversation_id:
                ai_history.append_message(actor, conversation_id, "system", "AI query was rejected")
                event_register.record_chat("AI query was rejected", "system", conversation_id, outcome="failed", causation_id=question_id)
            self._send_json(
                {"error": str(exc), **({"conversationId": conversation_id} if conversation_id else {})},
                400,
            )
            return
        except Exception as exc:
            print(f"AI query failed: {exc}")
            if conversation_id:
                ai_history.append_message(actor, conversation_id, "system", "AI query failed")
                event_register.record_chat("AI query failed", "system", conversation_id, outcome="failed", causation_id=question_id)
            self._send_json(
                {"error": "ai query failed", **({"conversationId": conversation_id} if conversation_id else {})},
                500,
            )
            return
        if conversation_id:
            assistant_message = ai_history.append_message(
                actor,
                conversation_id,
                "assistant",
                str(response.get("answer") or "No answer was returned."),
                metadata={
                    "citations": response.get("citations", []),
                    "label": response.get("label", "Assistant"),
                    "uncertainty": response.get("uncertainty", "unknown"),
                    "model_version": response.get("model_version", "engine"),
                    "model": response.get("model_version", "engine"),
                    "reasoning_effort": response.get("reasoning_effort", ""),
                },
            )
            event_register.record_chat(str(response.get("answer") or "No answer was returned."), "Operations AI", conversation_id, outcome="answer", causation_id=question_id)
            response = {**response, "conversationId": conversation_id, "messageId": assistant_message["id"]}
        self._send_json(response)

    def _platform_demo_mask(self, value: Any) -> Any:
        if isinstance(value, str):
            for source, alias in sorted(
                PLATFORM_DEMO_STATION_REPLACEMENTS.items(), key=lambda item: len(item[0]), reverse=True
            ):
                value = value.replace(source, alias)
            return value
        if isinstance(value, list):
            return [self._platform_demo_mask(item) for item in value]
        if isinstance(value, tuple):
            return [self._platform_demo_mask(item) for item in value]
        if isinstance(value, dict):
            return {
                self._platform_demo_mask(key) if isinstance(key, str) else key: self._platform_demo_mask(item)
                for key, item in value.items()
            }
        return value

    def _send_json(self, value: Any, status: int = 200) -> None:
        route = self.path.split("?", 1)[0]
        if self._is_platform_demo() and route != "/api/weather":
            value = self._platform_demo_mask(value)
        if status >= 400 and isinstance(value, dict) and "correlationId" not in value:
            value = {**value, "correlationId": getattr(self, "correlation_id", "") or events.current_correlation_id()}
        body = json.dumps(value, separators=(",", ":")).encode()
        self.send_response(status)
        if route.startswith("/api/checkins/"):
            self.send_header("X-Northstar-Safety-Protocol", "1")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_binary(
        self, body: bytes, content_type: str, filename: str, digest: str = "", inline: bool = False
    ) -> None:
        self.send_response(200)
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        disposition = "inline" if inline else "attachment"
        self.send_header("Content-Disposition", f"{disposition}; filename*=UTF-8''{quote(filename)}")
        self.send_header("X-Content-Type-Options", "nosniff")
        if digest:
            self.send_header("X-Content-SHA256", digest)
        self.end_headers()
        self.wfile.write(body)

    def send_error(
        self, code: int, message: str | None = None, explain: str | None = None
    ) -> None:
        if self.path.split("?", 1)[0].startswith("/api/"):
            self._send_json({"error": message or self.responses.get(code, ("Error",))[0]}, code)
            return
        super().send_error(code, message, explain)

    def guess_type(self, path: str) -> str:
        return mimetypes.guess_type(path)[0] or "application/octet-stream"


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--setup-demo-auth":
        raise SystemExit(_setup_demo_auth_from_stdin(sys.argv[2]))
    # Fail closed. A public NORTHSTAR_CHECKIN_ORIGIN means this process is behind
    # the tunnel and the check-in hostname is reachable from the internet; with
    # the gate off, GET /api/checkins would serve the operator roster there. That
    # combination has happened in practice, so refuse to start rather than come
    # up quietly in the unsafe state.
    if CHECKIN_ORIGIN.startswith("https://") and OPERATOR_GATE not in {"access", "demo"}:
        raise SystemExit(
            f"Refusing to start: NORTHSTAR_CHECKIN_ORIGIN is public ({CHECKIN_ORIGIN}) "
            f"but NORTHSTAR_OPERATOR_GATE is '{OPERATOR_GATE}'. That serves the operator "
            "roster on the public check-in hostname. Set NORTHSTAR_OPERATOR_GATE=access "
            "or demo, or clear NORTHSTAR_CHECKIN_ORIGIN for local-only work."
        )
    # Demo mode with no credential would be a gate with no key: every operator
    # route closed and no way to open one. Refuse to start instead of coming up
    # looking healthy and serving nothing.
    if OPERATOR_GATE == "demo" and DEMO_AUTH is None:
        raise SystemExit(
            "Refusing to start: NORTHSTAR_OPERATOR_GATE=demo but no demo credential is "
            f"configured{(' — ' + DEMO_AUTH_ERROR) if DEMO_AUTH_ERROR else ''}. Run "
            "'python scripts/setup-demo-auth.py' on this PC to create "
            f"{auth.config_path()}."
        )
    if CHECKIN_ORIGIN.startswith("https://") and HOST not in {"127.0.0.1", "localhost", "::1"}:
        raise SystemExit(
            "Refusing to start: a public NORTHSTAR_CHECKIN_ORIGIN requires a loopback bind, "
            f"but NORTHSTAR_BIND_HOST is '{HOST}'. Set it to 127.0.0.1 or clear "
            "NORTHSTAR_CHECKIN_ORIGIN for local-only work."
        )
    store.init_db()
    operator_knowledge.bootstrap()
    # Write one idempotent, backend-owned record when this operator client is
    # started on a new dashboard/package build. It must never prevent the
    # control room from starting if release metadata is unavailable.
    try:
        client_release.observe_current_release()
    except Exception:
        print("Northstar client release tracking unavailable.", flush=True)
    # Bind and serve before the first external downloads. On a cold start the
    # IESO reports can take tens of seconds; check-ins, help requests, health,
    # and static pages must be available while those feeds warm up.
    try:
        server = NorthstarHTTPServer((HOST, PORT), Handler)
    except OSError as exc:
        raise SystemExit(f"Northstar could not start on port {PORT}: {exc}") from exc
    threading.Thread(target=refresh_loop, daemon=True).start()
    threading.Thread(target=advisory_refresh_loop, daemon=True).start()
    threading.Thread(target=overdue_loop, daemon=True).start()
    threading.Thread(target=scada_loop, daemon=True).start()
    threading.Thread(target=flow_loop, daemon=True).start()
    threading.Thread(target=water_collection.scheduler_loop, daemon=True).start()
    threading.Thread(target=inflow.scheduler_loop, daemon=True).start()
    threading.Thread(target=daily_report.scheduler_loop, daemon=True).start()
    threading.Thread(target=dispatch_loop, daemon=True).start()
    threading.Thread(target=voice_loop, daemon=True).start()
    threading.Thread(target=operations_console.scheduler_loop, daemon=True).start()
    voice.inbox_path().mkdir(parents=True, exist_ok=True)
    print(f"Northstar check-in database: {store.DB_PATH}", flush=True)
    print(f"Northstar voice inbox: {voice.inbox_path()} (engine: {voice.engine_name()})", flush=True)
    print(f"Northstar dashboard ready: http://localhost:{PORT}/northstar-clean.html", flush=True)
    if OPERATOR_GATE == "demo":
        print(
            f"Operator gate: demo sign-in as '{demo_username()}' on {OPERATOR_HOST}"
            f" (session {demo_session_seconds() // 3600}h, credential from {auth.config_path()})",
            flush=True,
        )
    else:
        print(f"Operator gate: {OPERATOR_GATE}", flush=True)
    print("Live market feeds are warming up in the background.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
