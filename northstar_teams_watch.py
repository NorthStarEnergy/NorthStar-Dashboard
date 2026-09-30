"""Opt-in Teams collector. Read-only Graph polling -> existing Events ledger.

Run with --config <local JSON> --check, --sign-in, --once, or --watch.
No web listener, message sending, operational actions, or plaintext token cache.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sqlite3
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener
import uuid

import northstar_microsoft as microsoft
import northstar_store as store

GRAPH = "https://graph.microsoft.com/v1.0/"
RESOURCE = re.compile(r"(?:teams/[^/?#%]+/channels/[^/?#%]+|chats/[^/?#%]+)/messages\Z")
HEALTH_SCHEMA = """CREATE TABLE IF NOT EXISTS teams_watch_health (
 resource TEXT PRIMARY KEY, state TEXT NOT NULL, checked_at TEXT NOT NULL,
 last_success TEXT, detail TEXT NOT NULL, interval_seconds INTEGER NOT NULL
);"""


class WatchError(RuntimeError):
    def __init__(self, message, retry_after=0):
        super().__init__(message)
        self.retry_after = retry_after


def now():
    return datetime.now(timezone.utc).isoformat()


def timestamp(value):
    return datetime.fromisoformat(microsoft._timestamp(value))


def load_config(path):
    config = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    if not isinstance(config, dict) or config.get("enabled") is not True:
        raise WatchError("Teams watcher is disabled. Configure approved sources before enabling it.")
    for key in ("tenantId", "clientId"):
        try:
            config[key] = str(uuid.UUID(config[key]))
        except (KeyError, ValueError, TypeError, AttributeError) as exc:
            raise WatchError(f"A work-tenant {key} UUID is required.") from exc
    timestamp(config.get("startAt"))
    for key, default, minimum, maximum in (("intervalSeconds", 60, 30, 3600), ("maxPages", 100, 1, 1000)):
        value = config.get(key, default)
        if type(value) is not int or not minimum <= value <= maximum:
            raise WatchError(f"{key} must be between {minimum} and {maximum}.")
        config[key] = value
    sources = config.get("sources")
    if not isinstance(sources, list) or not 1 <= len(sources) <= 20:
        raise WatchError("Configure 1 to 20 explicitly approved sources.")
    seen = set()
    for source in sources:
        if not isinstance(source, dict):
            raise WatchError("Invalid source configuration.")
        resource = source.get("resource", "")
        if not isinstance(resource, str) or not RESOURCE.fullmatch(resource) or any(
            part in {".", ".."} for part in resource.split("/")
        ):
            raise WatchError("Source must be an exact team/channel/messages or chat/messages resource.")
        if resource in seen or not isinstance(source.get("label"), str) or not source["label"].strip():
            raise WatchError("Each source needs a unique resource and a label.")
        seen.add(resource)
    return config


def scopes(config):
    result = []
    if any(s["resource"].startswith("teams/") for s in config["sources"]):
        result.append("ChannelMessage.Read.All")
    if any(s["resource"].startswith("chats/") for s in config["sources"]):
        result.append("Chat.Read")
    return result


def application(config):
    if os.name != "nt":
        raise WatchError("This watcher requires Windows encrypted token storage.")
    try:
        import msal
        from msal_extensions import PersistedTokenCache, build_encrypted_persistence
    except ImportError as exc:
        raise WatchError("Install the project's requirements.txt before Microsoft sign-in.") from exc
    cache_path = store.DB_PATH.parent / (".teams-watch-" + config["tenantId"] + "-" + config["clientId"] + ".bin")
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache = PersistedTokenCache(build_encrypted_persistence(str(cache_path)))
    return msal.PublicClientApplication(config["clientId"],
        authority="https://login.microsoftonline.com/" + config["tenantId"], token_cache=cache)


def sign_in(config):
    app = application(config)
    flow = app.initiate_device_flow(scopes=scopes(config))
    if "user_code" not in flow:
        raise WatchError("Microsoft could not start device sign-in; check tenant policy and app registration.")
    # Shown only in the user's interactive terminal, never written into a report/log.
    print(flow["message"], flush=True)
    result = app.acquire_token_by_device_flow(flow)
    if "access_token" not in result:
        raise WatchError("Microsoft sign-in did not complete; tenant approval may be required.")
    print("Sign-in complete. Run --once to verify collection.")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise WatchError("Graph redirect refused.")


class GraphClient:
    def __init__(self, config):
        self.app = application(config)
        self.scopes = scopes(config)
        self.opener = build_opener(NoRedirect())

    def get(self, url, resource):
        validate_url(url, resource)
        accounts = self.app.get_accounts()
        if len(accounts) != 1:
            raise WatchError("Run --sign-in with exactly one approved work account.")
        result = self.app.acquire_token_silent(self.scopes, account=accounts[0])
        if not result or not result.get("access_token"):
            raise WatchError("Microsoft sign-in is required; run --sign-in.")
        request = Request(url, headers={"Authorization": "Bearer " + result["access_token"], "Accept": "application/json"})
        try:
            with self.opener.open(request, timeout=30) as response:
                raw = response.read(8 * 1024 * 1024 + 1)
                if len(raw) > 8 * 1024 * 1024:
                    raise WatchError("Graph page exceeded the response limit.")
                data = json.loads(raw)
                if not isinstance(data, dict):
                    raise WatchError("Graph returned an invalid page.")
                return data
        except HTTPError as exc:
            retry = exc.headers.get("Retry-After", "60")
            retry = max(1, int(retry)) if retry.isdigit() else 60
            raise WatchError(f"Graph HTTP {exc.code}; check permission, source, or throttling.",
                             retry if exc.code in {429, 503} else 0) from exc
        except (URLError, TimeoutError, ValueError) as exc:
            raise WatchError("Graph request failed; no successful sync recorded.") from exc


def validate_url(url, resource):
    parsed = urlparse(url)
    path = unquote(parsed.path)
    base = "/v1.0/" + resource
    reply_path = path.startswith(base + "/") and re.fullmatch(r"[^/]+/replies", path[len(base) + 1:])
    if (parsed.scheme != "https" or parsed.netloc != "graph.microsoft.com" or parsed.fragment
            or any(p in {".", ".."} for p in path.split("/")) or not (path == base or reply_path)):
        raise WatchError("Graph pagination escaped the approved source.")


def pages(client, url, resource, budget):
    seen = set()
    while url:
        validate_url(url, resource)
        if url in seen or budget[0] <= 0:
            raise WatchError("Source scan incomplete: pagination cycle or page limit; increase maxPages or narrow the source.")
        seen.add(url)
        budget[0] -= 1
        page = client.get(url, resource)
        items = page.get("value")
        if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
            raise WatchError("Graph returned an invalid message collection.")
        yield from items
        url = page.get("@odata.nextLink")
        if url is not None and not isinstance(url, str):
            raise WatchError("Graph returned an invalid continuation.")


def collect(client, source, max_pages):
    resource = source["resource"]
    budget = [max_pages]
    root_url = GRAPH + quote(resource, safe="/") + "?$top=50"
    for item in pages(client, root_url, resource, budget):
        yield item
        if resource.startswith("teams/"):
            message_id = str(item.get("id") or "")
            if not message_id or "/" in message_id or message_id in {".", ".."}:
                raise WatchError("Invalid channel message identity.")
            url = GRAPH + quote(resource, safe="/") + "/" + quote(message_id, safe="") + "/replies?$top=50"
            for reply in pages(client, url, resource, budget):
                yield {**reply, "replyToId": reply.get("replyToId") or message_id}


def revision(item):
    if item.get("deletedDateTime"):
        return "deleted", item["deletedDateTime"]
    created = item.get("createdDateTime")
    modified = item.get("lastModifiedDateTime")
    if modified and timestamp(modified) > timestamp(created):
        return "updated", modified
    return "created", created


def health(source, config, state, detail):
    at = now()
    with store._session() as connection:
        connection.execute("""INSERT INTO teams_watch_health VALUES (?,?,?,?,?,?)
            ON CONFLICT(resource) DO UPDATE SET state=excluded.state, checked_at=excluded.checked_at,
            last_success=COALESCE(excluded.last_success, teams_watch_health.last_success),
            detail=excluded.detail, interval_seconds=excluded.interval_seconds""",
            (source["resource"], state, at, at if state == "synced" else None, detail, config["intervalSeconds"]))


def run_once(config, client):
    # Require an existing dashboard DB; never silently create an empty replacement.
    if not store.DB_PATH.is_file():
        raise WatchError("Dashboard database is missing; start NorthStar before the watcher.")
    with store._session() as connection:
        connection.execute("SELECT event_id FROM audit_events LIMIT 1")
        connection.executescript(HEALTH_SCHEMA)
    reports = []
    for source in config["sources"]:
        health(source, config, "scanning", "Source scan in progress.")
        try:
            # Finish the scan before opening a write transaction. Failures commit no partial source.
            envelopes = []
            contract = microsoft.MicrosoftSource("teams", source["resource"], source["label"], True)
            for item in collect(client, source, config["maxPages"]):
                change, stamp = revision(item)
                if timestamp(stamp) >= timestamp(config["startAt"]):
                    envelopes.append(microsoft.normalize_message(contract, item, change=change, occurred_at=stamp))
            inserted = 0
            with store._session() as connection:
                connection.execute("BEGIN IMMEDIATE")
                for envelope in envelopes:
                    if not connection.execute("SELECT 1 FROM audit_events WHERE event_id=?", (envelope["event_id"],)).fetchone():
                        microsoft.events.append_event(connection, **envelope)
                        inserted += 1
            health(source, config, "synced", "Complete source scan; imported " + str(inserted) + " revisions.")
            reports.append({"source": source["label"], "state": "synced", "inserted": inserted})
        except (WatchError, ValueError, TypeError, KeyError, AttributeError, sqlite3.Error) as exc:
            detail = str(exc) if isinstance(exc, WatchError) else "Invalid source data or database write failed."
            health(source, config, "error", detail)
            reports.append({"source": source["label"], "state": "error", "detail": detail,
                            "retryAfter": getattr(exc, "retry_after", 0)})
            if getattr(exc, "retry_after", 0):
                break  # Respect tenant throttling before touching the next source.
    return reports


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    action = parser.add_mutually_exclusive_group(required=True)
    for name in ("check", "sign-in", "once", "watch"):
        action.add_argument("--" + name, action="store_true")
    args = parser.parse_args(argv)
    try:
        config = load_config(args.config)
        if args.check:
            print(json.dumps({"state": "configured_not_connected", "sources": len(config["sources"]), "scopes": scopes(config)}))
            return 0
        if args.sign_in:
            sign_in(config)
            return 0
        client = GraphClient(config)
        failures = 0
        while True:
            reports = run_once(config, client)
            print(json.dumps({"at": now(), "sources": reports}), flush=True)
            failed = any(r["state"] == "error" for r in reports)
            if args.once:
                return 1 if failed else 0
            failures = min(failures + 1, 6) if failed else 0
            delay = max(config["intervalSeconds"] * (2 ** failures), *(r.get("retryAfter", 0) for r in reports))
            time.sleep(delay)
            updated = load_config(args.config)  # Disabled config stops the service on the next cycle.
            if updated != config:
                config = updated
                client = GraphClient(config)
    except KeyboardInterrupt:
        return 0
    except (WatchError, OSError, ValueError, KeyError, TypeError) as exc:
        print(str(exc) if isinstance(exc, WatchError) else "Invalid/missing watcher configuration or local storage.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
