"""Bounded, read-only IESO price archive retrieval; never updates the live feed."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
import json
import math
from pathlib import Path
import re
import threading
import time

EST = timezone(timedelta(hours=-5))
_gate = threading.BoundedSemaphore(1)


def validate_day(value: str, today: date | None = None) -> date:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("Choose a report date in YYYY-MM-DD format.")
    day = date.fromisoformat(value)
    if not date(2025, 5, 1) <= day < (today or datetime.now(EST).date()):
        raise ValueError("Choose a completed report day on or after 2025-05-01.")
    return day


def snapshot(value, *, cache_dir, report_url, download, parse, patterns):
    day = validate_day(value)
    cache = Path(cache_dir) / (day.isoformat() + ".json")
    try:
        if time.time() - cache.stat().st_mtime < 86400:
            return json.loads(cache.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    if not _gate.acquire(blocking=False):
        raise BlockingIOError("Another historical pull is running. Try again shortly.")
    try:
        code = day.strftime("%Y%m%d")
        jobs = [("rt_energy", f"{code}{hour:02d}", hour) for hour in range(1, 25)]
        jobs.append(("da_energy", code, None))

        def load(job):
            kind, suffix, expected_hour = job
            url = report_url(kind, suffix)
            try:
                report = parse(download(url, attempts=1))
                if report.operating_date.date() != day:
                    raise ValueError("Report date does not match requested date")
                points = {key: {} for key in patterns}
                for row in report.rows:
                    location = row.get("Pricing Location", "")
                    keys = [key for key, pattern in patterns.items() if pattern.fullmatch(location)]
                    if not keys:
                        continue
                    hour, interval = int(row["Delivery Hour"]), int(row.get("Interval") or 1)
                    if not 1 <= hour <= 24 or not 1 <= interval <= 12 or (expected_hour and hour != expected_hour):
                        raise ValueError("Unexpected report hour or interval")
                    price = float(row["LMP"])
                    if not math.isfinite(price):
                        continue
                    stamp = (datetime.combine(day, datetime.min.time(), EST) + timedelta(hours=hour-1, minutes=(interval-1)*5)).isoformat()
                    for key in keys:
                        points[key].setdefault(stamp, {})[location] = price
                return kind, url, points, None
            except Exception as exc:
                return kind, url, {}, type(exc).__name__

        nodes = {key: {"history": [], "daHistory": [], "forward": []} for key in patterns}
        sources, missing = [], []
        with ThreadPoolExecutor(max_workers=4) as pool:
            for kind, url, points, error in pool.map(load, jobs):
                if error:
                    missing.append({"url": url, "reason": "Report unavailable or invalid"})
                    continue
                sources.append(url)
                field = "history" if kind == "rt_energy" else "daHistory"
                for key, stamps in points.items():
                    nodes[key][field].extend({"time": stamp, "value": sum(values.values()) / len(values)} for stamp, values in stamps.items())
        if not any(n["history"] or n["daHistory"] for n in nodes.values()):
            raise LookupError("No archived price readings were available for that day.")
        coverage = {}
        for key, node in nodes.items():
            for field in ("history", "daHistory"):
                node[field].sort(key=lambda point: point["time"])
            coverage[key] = {"rt": len(node["history"]), "da": len(node["daHistory"])}
        aggregate = {"history": [], "daHistory": [], "forward": []}
        for field in ("history", "daHistory"):
            stamps = {}
            for node in nodes.values():
                for point in node[field]:
                    stamps.setdefault(point["time"], []).append(point["value"])
            aggregate[field] = [{"time": stamp, "value": sum(values)/len(values)} for stamp, values in sorted(stamps.items())]
        nodes["IESO"] = aggregate
        partial = bool(missing) or any(c["rt"] != 288 or c["da"] != 24 for c in coverage.values())
        result = {"historical": True, "reportDate": value, "updated": datetime.now(timezone.utc).isoformat(),
                  "source": "IESO Public Reports", "reportTimezone": "EST (UTC-05:00)", "nodes": nodes,
                  "ontario": {}, "sources": sources, "missing": missing, "coverage": coverage, "partial": partial}
        if not partial:
            try:
                cache.parent.mkdir(parents=True, exist_ok=True)
                temporary = cache.with_suffix(".tmp")
                temporary.write_text(json.dumps(result, allow_nan=False), encoding="utf-8")
                temporary.replace(cache)
            except OSError:
                pass  # Cache failure must not discard successfully retrieved readings.
        return result
    finally:
        _gate.release()
