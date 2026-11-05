"""Read-only location water data. Provider datums are never homogenized."""
from __future__ import annotations

import copy
import json
import math
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import Request, urlopen

UTC = timezone.utc
WSC = "https://api.weather.gc.ca/collections/"
USGS = "https://api.waterdata.usgs.gov/ogcapi/v1/collections/"
MAX_DAYS = 366
MAX_POINTS = 50000


def station(id, name, provider, datum, note=""):
    return dict(id=id, name=name, provider=provider, datum=datum, mappingNote=note)


STATIONS = (
    station("05PA006", "Lac La Croix outlet", "WSC", "United States and Canada Boundary Survey datum", "Candidate for workbook Lac LaCroix; confirm site alias."),
    station("05PA013", "Namakan at Squirrel Island", "WSC", "United States Coast and Geodetic Survey datum", "Candidate for workbook Squirrel Falls; confirm site alias."),
    station("05PB024", "Rainy Lake near Bear Pass", "WSC", "Assumed datum"),
    station("05PB007", "Rainy Lake near Fort Frances", "WSC", "United States Coast and Geodetic Survey datum"),
    station("05PC024", "Rainy River at Point Park No. 1", "WSC", "United States Coast and Geodetic Survey datum"),
    station("05PE006", "Kenora forebay", "WSC", "Lake of the Woods datum"),
    station("05PE001", "Kenora tailrace", "WSC", "Geodetic Survey of Canada datum (local 1923 adjustment)"),
    station("05PE029", "Norman forebay", "WSC", "Lake of the Woods datum"),
    station("05PE012", "Norman tailrace", "WSC", "Geodetic Survey of Canada datum (local 1923 adjustment)"),
    station("05PE014", "Keewatin", "WSC", "Lake of the Woods datum"),
    station("05127500", "Basswood River near Winton", "USGS", "NAVD88"),
    station("05129115", "Vermilion River near Crane Lake", "USGS", "NAVD88"),
    station("05129290", "Gold Portage outlet", "USGS", "NAVD88"),
)
# Official hydrometric-stations metadata verified 2026-09-30. Keep the West
# default unchanged for the existing Flows module; locations opt into this set.
LOCATION_STATIONS = (
    station("04LF001", "Kapuskasing River at Kapuskasing", "WSC", "Assumed datum"),
    station("02DD006", "Lake Nipissing at North Bay", "WSC", "Assumed datum"),
    station("02DD032", "Lake Nipissing at West Bay", "WSC", "Assumed datum"),
    station("02DD021", "Lake Nipissing at French River outlet", "WSC", "Assumed datum"),
    station("02DD020", "Little French River at Okikendawt Island", "WSC", "Assumed datum"),
    station("04ME003", "Abitibi River at Onakawana", "WSC", "Assumed datum", "Downstream basin context; not the Iroquois Falls plant elevation."),
    dict(station("04MC001", "Abitibi River at Iroquois Falls", "WSC", "Assumed datum", "Discontinued gauge; published historical records only."), realTime=False),
    dict(station("04MC002", "Abitibi River at Twin Falls", "WSC", "Assumed datum", "Discontinued gauge; published historical records only."), realTime=False),
    station("05PB018", "Atikokan River at Atikokan", "WSC", "Geodetic Survey of Canada datum (local 1929 adjustment)"),
    dict(station("05PB009", "Seine River at Sturgeon Falls generating station", "WSC", "Assumed datum", "Published records; WSC does not advertise a real-time feed."), realTime=False),
    station("02HD008", "Oshawa Creek at Oshawa", "WSC", "Assumed datum"),
    station("02HC024", "Don River at Todmorden", "WSC", "Assumed datum"),
    station("02LC020", "Riviere du Nord at Lachute", "WSC", "Assumed datum"),
    station("04MA004", "Lake Abitibi at Mancebourg", "WSC", "Assumed datum"),
)
BY_ID = {s["id"]: s for s in STATIONS + LOCATION_STATIONS}
LOCATIONS = {
    "Iroquois Falls": dict(riverSystem="Abitibi River", gauges=["04ME003", "04MC001", "04MC002"]),
    "Atikokan": dict(riverSystem="Atikokan / Seine River basin", gauges=["05PB018", "05PB009"]),
    "Kapuskasing": dict(riverSystem="Kapuskasing River", gauges=["04LF001"]),
    "Oshawa": dict(riverSystem="Oshawa Creek / Lake Ontario basin", gauges=["02HD008"]),
    "Toronto": dict(riverSystem="Don River / Lake Ontario basin", gauges=["02HC024"]),
    "Fort Frances": dict(riverSystem="Rainy / Namakan River system", gauges=["05PB007", "05PC024", "05PB024", "05PA013", "05PA006"]),
    "Dokis FN": dict(riverSystem="French River / Lake Nipissing", gauges=["02DD020", "02DD021", "02DD032", "02DD006"]),
    "Kenora": dict(riverSystem="Winnipeg River / Lake of the Woods", gauges=["05PE006", "05PE001", "05PE029", "05PE012", "05PE014"]),
    "Lachute": dict(riverSystem="Riviere du Nord", gauges=["02LC020"]),
    "Lake Abitibi": dict(riverSystem="Lake Abitibi / Abitibi River", gauges=["04MA004"]),
}
PENDING = [
    {"name": "Raft Lake", "reason": "Public NOAA DADDS source verified: 4815D640, channel 21, group H20POW. Elevation field, units and observation time require confirmation."},
    {"name": "Calm Lake / Sturgeon Falls / Fort Frances canal and plant levels", "reason": "Internal reporting or historian access not configured."},
    {"name": "LWCB lake averages / PCA International Falls", "reason": "Partner access and series mapping not configured."},
]


class ProviderError(RuntimeError):
    pass


def download_json(url):
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "NorthStar-Water-Elevations/1.0"})
    with urlopen(request, timeout=15) as response:
        raw = response.read(12_000_001)
    if len(raw) > 12_000_000:
        raise ProviderError("Provider response exceeds the size limit; select a shorter range.")
    return json.loads(raw)


def parse_time(value):
    if not isinstance(value, str):
        raise ValueError("Invalid timestamp")
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise ValueError("Timestamp must include a time zone")
    return dt.astimezone(UTC)


def number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        n = float(value)
        return n if math.isfinite(n) else None
    except (ValueError, TypeError):
        return None


def validate_query(query, now):
    raw = query.get("station", ["all"])[0]
    location = query.get("location", [""])[0]
    if location and location not in LOCATIONS:
        raise ValueError("Unknown weather location")
    if location and raw == "all":
        selected = [BY_ID[id] for id in LOCATIONS[location]["gauges"]]
    elif raw == "all":
        selected = list(STATIONS)
    elif raw in BY_ID:
        selected = [BY_ID[raw]]
    else:
        raise ValueError("Unknown gauge")
    if location and any(s["id"] not in LOCATIONS[location]["gauges"] for s in selected):
        raise ValueError("Gauge does not belong to this location")
    start, end = query.get("start", [""])[0], query.get("end", [""])[0]
    if not start and not end:
        return selected, None, None
    if not start or not end:
        raise ValueError("Provide both start and end dates")
    if len(selected) != 1:
        raise ValueError("Select one gauge for a custom range")
    try:
        a, b = datetime.strptime(start, "%Y-%m-%d").replace(tzinfo=UTC), datetime.strptime(end, "%Y-%m-%d").replace(tzinfo=UTC) + timedelta(days=1)
    except ValueError:
        raise ValueError("Use YYYY-MM-DD dates") from None
    if a >= b or (b-a).days > MAX_DAYS:
        raise ValueError(f"Choose an ordered range of at most {MAX_DAYS} days")
    if a > now or b.date() > (now + timedelta(days=1)).date():
        raise ValueError("Dates cannot be in the future")
    return selected, a, min(b, now)


class ElevationStore:
    def __init__(self, fetch=download_json, now=lambda: datetime.now(UTC)):
        self.fetch, self.now = fetch, now
        self.cache = OrderedDict()
        self.lock = threading.Lock()
        self.slots = threading.BoundedSemaphore(2)

    def catalog(self):
        return dict(stations=copy.deepcopy(STATIONS + LOCATION_STATIONS), locations=copy.deepcopy(LOCATIONS), pendingSources=copy.deepcopy(PENDING), maxRangeDays=MAX_DAYS, timezone="UTC")

    def _pages(self, url):
        origin = urlsplit(url)
        seen, features = set(), []
        deadline = time.monotonic() + 40
        while url:
            target = urlsplit(url)
            if (target.scheme, target.netloc, target.path) != (origin.scheme, origin.netloc, origin.path):
                raise ProviderError("Provider returned an invalid pagination link")
            if url in seen or len(seen) >= 20 or time.monotonic() > deadline:
                raise ProviderError("Range could not be fully retrieved; select a shorter range.")
            seen.add(url)
            data = self.fetch(url)
            if not isinstance(data, dict) or not isinstance(data.get("features"), list):
                raise ProviderError("Provider returned an invalid data response")
            features.extend(data["features"])
            if len(features) > MAX_POINTS:
                raise ProviderError("Too many observations; select a shorter range.")
            links = [x.get("href") for x in data.get("links", []) if x.get("rel") == "next"]
            url = urljoin(url, links[0]) if links and links[0] else None
        return features

    def _station(self, s, start, end, now):
        daily = bool(start and s["provider"] == "WSC" and (s.get("realTime") is False or start < now - timedelta(days=29)))
        resolution = "daily_mean" if daily else "instantaneous"
        params = {"f": "json"}
        if s["provider"] == "WSC":
            collection = "hydrometric-daily-mean" if daily else "hydrometric-realtime"
            params.update(STATION_NUMBER=s["id"], limit=1000 if start else 1, sortby="DATE" if daily else ("DATETIME" if start else "-DATETIME"))
            base = WSC
        else:
            collection = "continuous" if start else "latest-continuous"
            params.update(monitoring_location_id="USGS-"+s["id"], parameter_code="63160", limit=5000 if start else 100)
            base = USGS
        if start:
            params["datetime"] = f"{start.isoformat()}/{end.isoformat()}"
        url = base + collection + "/items?" + urlencode(params)
        result = dict(**s, sourceUrl=url, resolution=resolution, readings=[], state="unavailable", message=None)
        if not start and s.get("realTime") is False:
            result.update(state="historical_only", message=s["mappingNote"])
            return result
        if daily:
            result["message"] = "Older WSC ranges use published daily means, not instantaneous elevations. Recent unfinalized dates may be absent."
        try:
            # A latest WSC request intentionally needs only its first feature.
            features = self._pages(url) if start or s["provider"] == "USGS" else self.fetch(url)["features"]
            readings = {}
            for feature in features:
                p = feature.get("properties", {})
                if s["provider"] == "WSC":
                    if p.get("STATION_NUMBER") != s["id"]:
                        continue
                    raw, unit = number(p.get("LEVEL")), "m"
                    stamp = p.get("DATE") if daily else p.get("DATETIME")
                    dt = datetime.strptime(stamp, "%Y-%m-%d").replace(tzinfo=UTC) if daily else parse_time(stamp)
                    quality = p.get("LEVEL_SYMBOL_EN") or ("Published daily mean" if daily else "Provisional")
                else:
                    if p.get("monitoring_location_id") != "USGS-"+s["id"] or p.get("parameter_code") != "63160":
                        continue
                    raw, unit = number(p.get("value")), p.get("unit_of_measure")
                    if unit != "ft":
                        raise ProviderError("Unexpected USGS elevation unit")
                    stamp, quality = p.get("time"), p.get("approval_status") or "Unspecified"
                    if p.get("qualifier"):
                        quality += " / " + str(p["qualifier"])
                    dt = parse_time(stamp)
                if dt > now or (start and not start <= dt < end):
                    continue
                key = dt.isoformat()
                readings[key] = dict(observedAt=key, waterLevelM=raw*0.3048 if raw is not None and unit=="ft" else raw, dischargeM3s=number(p.get("DISCHARGE")) if s["provider"] == "WSC" else None, rawValue=raw, rawUnit=unit, quality=quality)
            values = sorted(readings.values(), key=lambda r:r["observedAt"])
            if not start:
                values = values[-1:]
            result["readings"] = values
            valid = [r for r in values if r["waterLevelM"] is not None]
            result["state"] = "ok" if valid else "not_reported"
            if not start and valid and now-parse_time(valid[-1]["observedAt"]) > timedelta(hours=6):
                result["state"] = "stale"
            result["coverage"] = dict(first=values[0]["observedAt"] if values else None, last=values[-1]["observedAt"] if values else None, count=len(values), missingValues=len(values)-len(valid))
        except Exception as exc:
            result["message"] = str(exc) if isinstance(exc, ProviderError) else "Provider request failed; retry shortly."
        return result

    def get(self, query):
        now = self.now()
        selected, start, end = validate_query(query, now)
        key = (tuple(s["id"] for s in selected), query.get("start", [""])[0], query.get("end", [""])[0])
        with self.lock:
            cached = self.cache.get(key)
            if cached and time.monotonic()-cached[0] < 120:
                return copy.deepcopy(cached[1])
        if not self.slots.acquire(timeout=0.1):
            raise ProviderError("Water data retrieval is busy; retry shortly.")
        try:
            with ThreadPoolExecutor(max_workers=5) as pool:
                results = list(pool.map(lambda s:self._station(s,start,end,now), selected))
            payload = dict(mode="range" if start else "current", retrievedAt=self.now().isoformat(), start=start.isoformat() if start else None, endExclusive=end.isoformat() if end else None, stations=results, pendingSources=copy.deepcopy(PENDING), partial=any(r["state"] != "ok" for r in results))
            with self.lock:
                self.cache[key] = (time.monotonic(),copy.deepcopy(payload))
                self.cache.move_to_end(key)
                while len(self.cache)>32:
                    self.cache.popitem(last=False)
            return payload
        finally:
            self.slots.release()
