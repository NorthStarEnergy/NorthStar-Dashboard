import json
import re
from datetime import date
from unittest.mock import Mock

import pytest

import ieso_backend as backend
import northstar_market_history as history


def report(url, **kwargs):
    hour = re.search(r"20260701(\d{2})\.csv$", url)
    rt = "Realtime" in url
    rows = ["CREATED AT 2026/07/02 01:00:00 FOR 2026/07/01",
            "Delivery Hour,Interval,Pricing Location,LMP"]
    for h in ([int(hour[1])] if rt else range(1, 25)):
        for interval in (range(1, 13) if rt else [1]):
            for location, value in [("APIROQFALLS-LT.AG4", -5), ("CALMLAKE-LT.G1", 10),
                                    ("STURGEONFALL-LT.G2", 20), ("FORTFRANCSWC-LT.AG12", 0), ("ABKENORA-LT.AG", 40)]:
                rows.append(f"{h},{interval},{location},{value}")
    return "\n".join(rows)


def pull(tmp_path, download=report):
    return history.snapshot("2026-07-01", cache_dir=tmp_path, report_url=backend.report_url,
                            download=download, parse=backend.parse_report, patterns=backend.NODE_PATTERNS)


def test_complete_archive_has_all_intervals_fixed_est_and_group_means(tmp_path):
    result = pull(tmp_path)
    assert not result["partial"]
    assert len(result["sources"]) == 25
    assert len(result["nodes"]["APIROQ"]["history"]) == 288
    assert len(result["nodes"]["APIROQ"]["daHistory"]) == 24
    assert result["nodes"]["APIROQ"]["history"][0] == {"time": "2026-07-01T00:00:00-05:00", "value": -5}
    assert result["nodes"]["M1S"]["history"][0]["value"] == 15
    assert result["nodes"]["IESO"]["history"][0]["value"] == 12.5
    assert json.loads((tmp_path / "2026-07-01.json").read_text()) == result
    download = Mock(side_effect=AssertionError("cache should avoid network"))
    assert pull(tmp_path, download) == result
    download.assert_not_called()


def test_missing_hour_is_partial_not_filled_or_cached(tmp_path):
    def missing(url, **kwargs):
        if "2026070103.csv" in url:
            raise RuntimeError("Unavailable")
        return report(url)
    result = pull(tmp_path, missing)
    assert result["partial"] and len(result["missing"]) == 1
    assert len(result["nodes"]["APIROQ"]["history"]) == 276
    assert not (tmp_path / "2026-07-01.json").exists()


def test_wrong_day_and_total_failure_rejected(tmp_path):
    with pytest.raises(LookupError):
        pull(tmp_path, lambda url, **kwargs: report(url).replace("FOR 2026/07/01", "FOR 2026/07/02"))


@pytest.mark.parametrize("value", ["../../secret", "2026-02-30", "2025-04-30", "2026-07-02", "2026-7-1", ""])
def test_invalid_dates_rejected(value):
    with pytest.raises(ValueError):
        history.validate_day(value, today=date(2026, 7, 2))


def test_archive_route_is_operator_only():
    assert backend.OPERATOR_ROUTES["/api/market-history"] == ("GET",)


def test_busy_pull_is_bounded(tmp_path):
    history._gate.acquire()
    try:
        with pytest.raises(BlockingIOError):
            pull(tmp_path)
    finally:
        history._gate.release()
