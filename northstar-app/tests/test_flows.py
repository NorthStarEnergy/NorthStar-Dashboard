from __future__ import annotations

from datetime import datetime

import northstar_flows as flows


WSC_SAMPLE = """ ID,Date,Parameter/Paramètre,Value/Valeur,Qualifier/Qualificatif,Symbol/Symbole,Approval/Approbation,Grade/Classification,Qualifiers/Qualificatifs
02DD006,2026-09-15T12:35:00Z,46,5.713,,,Provisional/Provisoire,,
04LF001,2026-09-15T12:20:00Z,46,4.566,,,Provisional/Provisoire,,
04LF001,2026-09-15T12:20:00Z,47,27.2,,,Provisional/Provisoire,,
"""

CEHQ_SAMPLE = """Date      \tHeure\tDébit

2026-09-15\t07:30\t48,70
2026-09-15\t07:15\t48,89
"""


def test_water_survey_parser_preserves_missing_discharge() -> None:
    records = flows.parse_water_survey_csv(WSC_SAMPLE, flows.WSC_STATIONS[:2])
    by_id = {record["stationId"]: record for record in records}

    assert by_id["04LF001"]["waterLevelM"] == 4.566
    assert by_id["04LF001"]["dischargeM3s"] == 27.2
    assert by_id["04LF001"]["approval"] == "Provisional/Provisoire"
    assert by_id["02DD006"]["waterLevelM"] == 5.713
    assert by_id["02DD006"]["dischargeM3s"] is None
    assert by_id["02DD006"]["state"] == "ok"


def test_cehq_parser_reads_french_decimal_and_latest_observation() -> None:
    record = flows.parse_cehq_report(CEHQ_SAMPLE, flows.CEHQ_STATIONS[0])

    assert record["dischargeM3s"] == 48.7
    assert record["waterLevelM"] is None
    assert record["state"] == "ok"
    # Provider 07:30 EST is 08:30 in Toronto during daylight time.
    assert record["observedAt"] == "2026-09-15T08:30:00-04:00"


def test_flow_store_retains_confirmed_values_when_public_source_fails() -> None:
    failed = False

    def fetch_text(url: str) -> str:
        if failed:
            raise RuntimeError("source down")
        if url.startswith(flows.WSC_ENDPOINT):
            return WSC_SAMPLE
        return CEHQ_SAMPLE

    flow_store = flows.FlowStore(
        fetch_text=fetch_text,
        now=lambda: datetime(2026, 9, 15, 8, 0, tzinfo=flows.TZ),
        wsc_stations=flows.WSC_STATIONS[:2],
        cehq_stations=flows.CEHQ_STATIONS[:1],
    )
    flow_store.refresh()
    initial = flow_store.get()
    assert initial["stale"] is False
    assert next(record for record in initial["gauges"] if record["id"] == "wsc:04LF001")["dischargeM3s"] == 27.2

    failed = True
    flow_store.refresh()
    stale = flow_store.get()
    wsc = next(record for record in stale["gauges"] if record["id"] == "wsc:04LF001")
    assert stale["stale"] is True
    assert wsc["waterLevelM"] == 4.566
    assert wsc["dischargeM3s"] == 27.2
    assert wsc["state"] == "stale"
    assert next(source for source in stale["sources"] if source["id"] == "water-survey-canada")["status"] == "stale"


def test_flow_api_is_operator_only_and_uses_the_live_workspace() -> None:
    import ieso_backend as backend

    html = (backend.ROOT / "northstar-clean.html").read_text(encoding="utf-8")
    assert backend.OPERATOR_ROUTES["/api/flows"] == ("GET",)
    assert "/api/flows" not in backend.CHECKIN_PUBLIC_ROUTES
    assert 'id="flowsWorkspace" data-module-id="flows-workspace"' in html
    assert "flows-workspace.js?v=20261027-inflow-live" in html
    assert "flows-workspace.css?v=20260915-water-log-3" in html
    assert "WATER MANAGEMENT / FLOWS — PLANNED" not in html
