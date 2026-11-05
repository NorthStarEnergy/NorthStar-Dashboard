"""Read-only IESO advisory RSS collection for the operator market view."""

from __future__ import annotations

import re
import threading
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from urllib.request import Request, urlopen
from xml.etree import ElementTree


FEEDS = {
    "Emergency": "https://www.ieso.ca/-/media/Files/IESO/Rss/Critical",
    "Today": "https://www.ieso.ca/-/media/Files/IESO/Rss/Day0",
    "Future": "https://www.ieso.ca/-/media/Files/IESO/Rss/Day1To34",
    "Administrative pricing": "https://www.ieso.ca/Sector-Participants/RSS-Feeds/Administrative-Pricing/AdminPricing",
    "Dispatch scheduling errors": "https://www.ieso.ca/-/media/Files/IESO/Rss/DispatchSchedulingErrorFeed.xml",
    "Settlements": "https://www.ieso.ca/Sector-Participants/RSS-Feeds/Settlements-Notifications/SettlementsNotifications",
    "Day-ahead market": "https://www.ieso.ca/-/media/Files/IESO/Rss/DamNotifications",
    "Archive": "https://www.ieso.ca/-/media/Files/IESO/Rss/Archive",
}
SITE_TERMS = re.compile(
    r"\b(?:northstar|apiroq|iroquois falls|atikokan|kapuskasing|fort frances|"
    r"kenora|calm lake|sturgeon falls|island falls|abkenora|m1s|f2b|k2m)\b", re.I
)
SYSTEM_TERMS = re.compile(
    r"\b(?:ontario|province.wide|system.wide|ieso.controlled grid|operating reserve|"
    r"generation shortfall|market suspension|market resumption)\b", re.I
)


def _text(item, name):
    element = item.find(name)
    return unescape("".join(element.itertext())).strip() if element is not None else ""


def _date(value):
    try:
        return parsedate_to_datetime(value).isoformat() if value else None
    except (TypeError, ValueError):
        return None


def parse_feed(xml, feed_name):
    root = ElementTree.fromstring(xml)
    if root.tag.lower() != "rss" and root.find("channel") is None:
        raise ValueError("Unexpected IESO RSS format")
    notices = []
    for item in root.findall("./channel/item"):
        title = _text(item, "title")[:300]
        description = re.sub(r"<[^>]+>", " ", _text(item, "description"))[:2000]
        link = _text(item, "link")
        guid = _text(item, "guid") or link or title
        if not title or not guid:
            continue
        content = f"{title} {description}"
        level_match = re.search(r"\b(Alert|Warning|Action)\b", content, re.I)
        sites = sorted(set(match.group(0) for match in SITE_TERMS.finditer(content)), key=str.casefold)
        relevance = "site" if sites else "system" if feed_name == "Emergency" or SYSTEM_TERMS.search(content) else "general"
        notices.append({
            "id": guid, "title": title, "description": description, "url": link,
            "issued": _date(_text(item, "pubDate")), "feed": feed_name,
            "relevance": relevance, "matches": sites,
            "level": level_match.group(1).title() if level_match else None,
        })
    return notices


def download_feed(url):
    request = Request(url, headers={"User-Agent": "Northstar-Control-Room/1.0", "Accept": "application/rss+xml, application/xml, text/xml"})
    with urlopen(request, timeout=15) as response:
        return response.read(2_000_001)


class AdvisoryStore:
    def __init__(self):
        self.lock = threading.Lock()
        self.snapshot = {"updated": None, "stale": True, "notices": [], "errors": {}}
        self.last_by_feed = {}
        self.feed_status = {}

    def refresh(self, download=download_feed):
        notices, errors = {}, {}
        for name, url in FEEDS.items():
            try:
                self.last_by_feed[name] = parse_feed(download(url), name)
                self.feed_status[name] = {"url": url, "received": datetime.now(timezone.utc).isoformat(), "stale": False, "count": len(self.last_by_feed[name])}
            except Exception as exc:
                errors[name] = str(exc)[:240]
                self.feed_status[name] = {**self.feed_status.get(name, {}), "url": url, "stale": True, "error": errors[name]}
            for notice in self.last_by_feed.get(name, []):
                existing = notices.get(notice["id"])
                if existing is None or (existing["feed"] == "Archive" and name != "Archive"):
                    notices[notice["id"]] = notice
        with self.lock:
            if notices or not errors:
                self.snapshot = {
                    "updated": datetime.now(timezone.utc).isoformat(), "stale": bool(errors),
                    "notices": sorted(notices.values(), key=lambda row: row["issued"] or "", reverse=True)[:250],
                    "errors": errors,
                }
            else:
                self.snapshot = {**self.snapshot, "stale": True, "errors": errors}

    def get(self):
        with self.lock:
            return {**self.snapshot, "feeds": {k: dict(v) for k,v in self.feed_status.items()}, "notices": list(self.snapshot["notices"]), "errors": dict(self.snapshot["errors"])}
