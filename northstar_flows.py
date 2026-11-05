"""Read-only public hydrometric adapters for the NorthStar Flows workspace.

This module deliberately keeps public observations separate from internal SCADA
or SharePoint reporting.  It never sends commands, writes to a provider, or
infers a missing level or discharge value.
"""

from __future__ import annotations

import copy
import csv
import io
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


TZ = ZoneInfo("America/Toronto")
WSC_ENDPOINT = "https://wateroffice.ec.gc.ca/services/recent_real_time_data/csv/inline"
CEHQ_ENDPOINT = "https://www.cehq.gouv.qc.ca/suivihydro/fichier_donnees.asp"
FETCH_TIMEOUT_SECONDS = 20

# These identifiers come from the existing WaterDB reporting reference.  They
# intentionally retain their provider labels until an owner reviews and approves
# the site-to-gauge mapping for operations use.
WSC_STATIONS = (
    {"stationId": "04LF001", "name": "Water Survey of Canada gauge 04LF001"},
    {"stationId": "02DD006", "name": "Water Survey of Canada gauge 02DD006"},
    {"stationId": "02DD032", "name": "Water Survey of Canada gauge 02DD032"},
    {"stationId": "02DD021", "name": "Water Survey of Canada gauge 02DD021"},
    {"stationId": "02DD020", "name": "Water Survey of Canada gauge 02DD020"},
)
CEHQ_STATIONS = (
    {"stationId": "050801", "name": "Québec hydrometric station 050801"},
    {"stationId": "040110", "name": "Québec hydrometric station 040110"},
)

PUBLIC_NOTICE = (
    "Read-only public hydrometric observations. Values are preliminary and do not "
    "authorize operating changes."
)
PRIVATE_SOURCE_NOT_CONFIGURED = (
    "Awaiting an approved read-only path or service account; no connection is attempted."
)


def _now() -> datetime:
    return datetime.now(TZ)


def _header_key(value: object) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or ""))
    return "".join(char for char in normalized if not unicodedata.combining(char)).strip().lower()


def _row_value(row: dict[str | None, str | None], field: str, *, prefix: bool = False) -> str | None:
    """Read a provider column after trimming its localized/header whitespace."""
    for header, value in row.items():
        key = _header_key(header)
        if key == field or (prefix and key.startswith(field)):
            return value
    return None


def _number(value: object) -> float | None:
    text = str(value or "").strip().replace(" ", "")
    if not text:
        return None
    try:
        return float(text.replace(",", "."))
    except ValueError:
        return None


def _timestamp(value: object, *, local: bool = False) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        # CEHQ explicitly reports fixed Eastern Standard Time, never daylight time.
        parsed = parsed.replace(tzinfo=timezone(timedelta(hours=-5)) if local else ZoneInfo("UTC"))
    return parsed.astimezone(TZ).isoformat()


def _new_gauge(
    provider_id: str, provider: str, station: dict[str, str], *, source_url: str
) -> dict[str, Any]:
    return {
        "id": f"{provider_id}:{station['stationId']}",
        "providerId": provider_id,
        "provider": provider,
        "stationId": station["stationId"],
        "name": station["name"],
        "waterLevelM": None,
        "dischargeM3s": None,
        "observedAt": None,
        "approval": None,
        "qualifier": None,
        "state": "not_reported",
        "sourceUrl": source_url,
    }


def water_survey_url(stations: tuple[dict[str, str], ...] = WSC_STATIONS) -> str:
    query: list[tuple[str, str]] = []
    query.extend(("stations[]", station["stationId"]) for station in stations)
    query.extend((("parameters[]", "46"), ("parameters[]", "47")))
    return f"{WSC_ENDPOINT}?{urlencode(query)}"


def cehq_url(station_id: str) -> str:
    return f"{CEHQ_ENDPOINT}?{urlencode({'NoStation': station_id})}"


def download_text(url: str, attempts: int = 3) -> str:
    """Fetch a known public source with bounded retry behavior."""
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            request = Request(
                url,
                headers={
                    "Accept": "text/csv, text/plain;q=0.9, */*;q=0.1",
                    "User-Agent": "NorthStar-Operations-Dashboard/1.0",
                },
            )
            with urlopen(request, timeout=FETCH_TIMEOUT_SECONDS) as response:
                charset = response.headers.get_content_charset() or "utf-8"
                return response.read().decode(charset, errors="replace")
        except HTTPError as exc:
            last_error = exc
            retryable = exc.code == 429 or 500 <= exc.code < 600
        except (URLError, TimeoutError) as exc:
            last_error = exc
            retryable = True
        if not retryable or attempt == attempts - 1:
            break
        time.sleep(min(2**attempt, 4))
    raise RuntimeError("public hydrometric source is unavailable") from last_error


def parse_water_survey_csv(
    text: str, stations: tuple[dict[str, str], ...] = WSC_STATIONS
) -> list[dict[str, Any]]:
    """Parse WSC's current-observation CSV without substituting missing values."""
    by_station = {station["stationId"]: station for station in stations}
    records = {
        station_id: _new_gauge(
            "wsc", "Water Survey of Canada", station, source_url=water_survey_url(stations)
        )
        for station_id, station in by_station.items()
    }
    reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff")))
    for row in reader:
        station_id = str(_row_value(row, "id") or "").strip().upper()
        if station_id not in records:
            continue
        parameter = str(_row_value(row, "parameter/", prefix=True) or "").strip()
        if parameter not in {"46", "47"}:
            continue
        record = records[station_id]
        value = _number(_row_value(row, "value/valeur"))
        if parameter == "46":
            record["waterLevelM"] = value
        else:
            record["dischargeM3s"] = value
        observed_at = _timestamp(_row_value(row, "date"))
        if observed_at and (not record["observedAt"] or observed_at > record["observedAt"]):
            record["observedAt"] = observed_at
        record["approval"] = str(_row_value(row, "approval/", prefix=True) or "").strip() or None
        record["qualifier"] = str(_row_value(row, "qualifier/", prefix=True) or "").strip() or None
        if record["waterLevelM"] is not None or record["dischargeM3s"] is not None:
            record["state"] = "ok"
    return [records[station["stationId"]] for station in stations]


def parse_cehq_report(text: str, station: dict[str, str]) -> dict[str, Any]:
    """Parse CEHQ's tab-separated current report and preserve its latest reading."""
    url = cehq_url(station["stationId"])
    record = _new_gauge("cehq", "Québec hydrometric stations", station, source_url=url)
    rows = [row for row in csv.reader(io.StringIO(text), delimiter="\t") if any(cell.strip() for cell in row)]
    if not rows:
        return record
    headers = {_header_key(value): index for index, value in enumerate(rows[0])}
    date_index = headers.get("date")
    time_index = headers.get("heure")
    discharge_index = headers.get("debit")
    if date_index is None or time_index is None or discharge_index is None:
        return record
    latest: tuple[str, float] | None = None
    for row in rows[1:]:
        if max(date_index, time_index, discharge_index) >= len(row):
            continue
        observed_at = _timestamp(f"{row[date_index].strip()}T{row[time_index].strip()}", local=True)
        value = _number(row[discharge_index])
        if not observed_at or value is None:
            continue
        if latest is None or observed_at > latest[0]:
            latest = (observed_at, value)
    if latest:
        record.update({"dischargeM3s": latest[1], "observedAt": latest[0], "state": "ok"})
    return record


def _source(
    source_id: str,
    name: str,
    status: str,
    *,
    updated: str | None = None,
    message: str | None = None,
    url: str | None = None,
    public: bool = True,
) -> dict[str, Any]:
    return {
        "id": source_id,
        "name": name,
        "status": status,
        "updated": updated,
        "message": message,
        "url": url,
        "public": public,
    }


class FlowStore:
    """Cache the latest source snapshots and retain confirmed data on a feed fault."""

    def __init__(
        self,
        *,
        fetch_text: Callable[[str], str] = download_text,
        now: Callable[[], datetime] = _now,
        wsc_stations: tuple[dict[str, str], ...] = WSC_STATIONS,
        cehq_stations: tuple[dict[str, str], ...] = CEHQ_STATIONS,
    ) -> None:
        self._fetch_text = fetch_text
        self._now = now
        self._wsc_stations = wsc_stations
        self._cehq_stations = cehq_stations
        self._lock = threading.Lock()
        self._snapshot: dict[str, Any] | None = None

    def _prior_gauges(self, provider_id: str) -> list[dict[str, Any]]:
        with self._lock:
            prior = copy.deepcopy(self._snapshot or {})
        return [gauge for gauge in prior.get("gauges", []) if gauge.get("providerId") == provider_id]

    def _base_private_sources(self) -> list[dict[str, Any]]:
        return [
            _source(
                "internal-scada-report",
                "Internal SCADA report drop",
                "not_configured",
                message=PRIVATE_SOURCE_NOT_CONFIGURED,
                public=False,
            ),
            _source(
                "sharepoint-water-reporting",
                "SharePoint water-reporting library",
                "not_configured",
                message=PRIVATE_SOURCE_NOT_CONFIGURED,
                public=False,
            ),
        ]

    @staticmethod
    def _stale_gauges(gauges: list[dict[str, Any]]) -> list[dict[str, Any]]:
        stale = copy.deepcopy(gauges)
        for gauge in stale:
            if gauge.get("state") == "ok":
                gauge["state"] = "stale"
        return stale

    def refresh(self) -> None:
        updated = self._now().isoformat()
        gauges: list[dict[str, Any]] = []
        sources: list[dict[str, Any]] = []
        failures: list[str] = []

        try:
            wsc_gauges = parse_water_survey_csv(
                self._fetch_text(water_survey_url(self._wsc_stations)), self._wsc_stations
            )
            gauges.extend(wsc_gauges)
            sources.append(
                _source(
                    "water-survey-canada",
                    "Water Survey of Canada",
                    "ok",
                    updated=updated,
                    url="https://wateroffice.ec.gc.ca/mainmenu/real_time_data_index_e.html",
                )
            )
        except Exception:
            prior = self._prior_gauges("wsc")
            gauges.extend(self._stale_gauges(prior) if prior else [
                _new_gauge("wsc", "Water Survey of Canada", station, source_url=water_survey_url(self._wsc_stations))
                for station in self._wsc_stations
            ])
            sources.append(
                _source(
                    "water-survey-canada",
                    "Water Survey of Canada",
                    "stale" if prior else "error",
                    message="Latest public request failed; no operating value was inferred.",
                    url="https://wateroffice.ec.gc.ca/mainmenu/real_time_data_index_e.html",
                )
            )
            failures.append("Water Survey of Canada")

        cehq_gauges: list[dict[str, Any]] = []
        cehq_failures = 0
        with ThreadPoolExecutor(max_workers=len(self._cehq_stations)) as executor:
            pending = {
                station["stationId"]: executor.submit(
                    lambda item=station: parse_cehq_report(
                        self._fetch_text(cehq_url(item["stationId"])), item
                    )
                )
                for station in self._cehq_stations
            }
            for station in self._cehq_stations:
                try:
                    cehq_gauges.append(pending[station["stationId"]].result())
                except Exception:
                    cehq_failures += 1
                    previous = next(
                        (gauge for gauge in self._prior_gauges("cehq") if gauge.get("stationId") == station["stationId"]),
                        None,
                    )
                    if previous:
                        cehq_gauges.extend(self._stale_gauges([previous]))
                    else:
                        cehq_gauges.append(
                            _new_gauge(
                                "cehq", "Québec hydrometric stations", station, source_url=cehq_url(station["stationId"])
                            )
                        )
        gauges.extend(cehq_gauges)
        if cehq_failures:
            status = "error" if cehq_failures == len(self._cehq_stations) else "partial"
            sources.append(
                _source(
                    "quebec-hydrometric",
                    "Québec hydrometric stations",
                    status,
                    updated=updated if status == "partial" else None,
                    message="One or more public requests failed; no operating value was inferred.",
                    url="https://www.cehq.gouv.qc.ca/suivihydro/",
                )
            )
            failures.append("Québec hydrometric stations")
        else:
            sources.append(
                _source(
                    "quebec-hydrometric",
                    "Québec hydrometric stations",
                    "ok",
                    updated=updated,
                    url="https://www.cehq.gouv.qc.ca/suivihydro/",
                )
            )

        sources.extend(self._base_private_sources())
        snapshot = {
            "updated": updated,
            "stale": bool(failures),
            "error": ", ".join(failures) if failures else None,
            "sources": sources,
            "gauges": gauges,
            "notice": PUBLIC_NOTICE,
        }
        with self._lock:
            self._snapshot = snapshot

    def get(self) -> dict[str, Any]:
        with self._lock:
            if self._snapshot is not None:
                return copy.deepcopy(self._snapshot)
        return {
            "updated": None,
            "stale": True,
            "error": None,
            "sources": self._base_private_sources(),
            "gauges": [],
            "notice": PUBLIC_NOTICE,
        }
