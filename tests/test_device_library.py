import json
import threading
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

import northstar_device_library as library
import northstar_events as events
import northstar_event_register as register
import northstar_store as store


@pytest.fixture
def database(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "library.db")
    with store._session() as connection:
        connection.executescript(store.SCHEMA)
        library.init_schema(connection)
    library._CACHE = None
    return tmp_path


ROOT = Path(__file__).resolve().parents[1]


def test_tools_module_is_wired_and_not_published_on_checkin():
    import ieso_backend as backend
    html = (ROOT / "northstar-clean.html").read_text(encoding="utf-8")
    assert 'id="deviceLibrary"' in html
    assert 'id="openDeviceLibrary"' in html
    assert "device-library.js?v=20260913-5" in html
    assert "device-library.css?v=20260913-5" in html
    assert "events-register.js?v=20260913-5" in html
    assert 'href="event-detail.html?id=' in html
    assert "EVENT REPORT" in html
    assert backend.OPERATOR_ROUTES["/api/maximo"] == ("GET",)
    assert backend.OPERATOR_ROUTES["/api/maximo/station"] == ("GET",)
    assert backend.OPERATOR_ROUTES["/api/sites"] == ("GET",)
    assert "northstar-sites.js?v=20260914-2" in html
    assert "outages-workspace.js?v=8" in html
    assert "/northstar-sites.js" not in backend.CHECKIN_PUBLIC_ROUTES
    assert "/device-library.js" not in backend.CHECKIN_PUBLIC_ROUTES
    assert "/device-library.css" not in backend.CHECKIN_PUBLIC_ROUTES
    assert all("library" not in prefix for prefix in backend.CHECKIN_PUBLIC_PREFIXES)
    assert backend.OPERATOR_ROUTES["/api/library"] == ("GET",)
    assert backend.OPERATOR_ROUTES["/api/library/item"] == ("GET",)
    assert backend.OPERATOR_ROUTES["/api/library/notes"] == ("POST",)


def test_catalog_is_area_then_site_then_station_folders(database):
    snapshot = library.tree()
    assert snapshot["company"] == "NorthStar Energy"
    assert "command" in snapshot["note"].lower()
    assert snapshot["counts"]["areas"] == 3
    assert snapshot["counts"]["sites"] == 18
    assert snapshot["counts"]["devices"] > 100
    areas = [child["name"] for child in snapshot["tree"]["children"]]
    assert areas == ["West", "East", "Quebec"]
    west = next(child for child in snapshot["tree"]["children"] if child["id"] == "area:west")
    east = next(child for child in snapshot["tree"]["children"] if child["id"] == "area:east")
    quebec = next(child for child in snapshot["tree"]["children"] if child["id"] == "area:quebec")
    assert [child["name"] for child in west["children"]] == [
        "Fort Frances", "Calm Lake", "Sturgeon Falls", "Kenora", "Norman",
    ]
    assert [child["name"] for child in east["children"]] == [
        "Twin Falls", "Iroquois Falls", "Island Falls", "Old Woman Falls",
        "White Otter Rapids", "Camp Three Rapids", "Big Beaver Falls", "Okikendawt GS",
    ]
    assert [child["name"] for child in quebec["children"]] == [
        "McDougal", "Bird GS", "Cogent", "Aiyers 1", "Aiyers 2",
    ]
    twin = next(child for child in east["children"] if child["id"] == "site:twin-falls")
    assert [child["name"] for child in twin["children"]] == [
        "Operations", "Equipment", "Data", "Notes", "Reports",
    ]
    operations = next(child for child in twin["children"] if child["name"] == "Operations")
    assert [child["name"] for child in operations["children"]] == [
        "Operating Conditions", "Operating Instructions", "Field Notes",
    ]
    equipment = next(child for child in twin["children"] if child["name"] == "Equipment")
    assert [child["name"] for child in equipment["children"][:1]] == ["Maximo Database"]
    folders = {child["name"] for child in equipment["children"][1:]}
    assert folders == {
        "Powerhouse",
        "Switchyard",
        "Protection & Control",
        "Waterways",
        "Station Service",
    }
    powerhouse = next(child for child in equipment["children"] if child["name"] == "Powerhouse")
    names = {child["name"] for child in powerhouse["children"]}
    assert {"Unit 1 Turbine", "Unit 1 Generator", "Unit 1 Governor", "Unit 1 Excitation"} <= names
    data = next(child for child in twin["children"] if child["name"] == "Data")
    assert [child["name"] for child in data["children"]] == [
        "Water", "Pond", "Operating Data", "Historical",
    ]
    reports = next(child for child in twin["children"] if child["name"] == "Reports")
    assert [child["name"] for child in reports["children"]] == [
        "Daily Production", "Flows", "Outages", "Forecasting",
    ]


def test_every_station_follows_the_twin_falls_whiteboard(database):
    snapshot = library.tree()
    stations = []
    for area in snapshot["tree"]["children"]:
        stations.extend(area["children"])
    assert len(stations) == 18
    for station in stations:
        assert [child["name"] for child in station["children"]] == [
            "Operations", "Equipment", "Data", "Notes", "Reports",
        ]
        operations, equipment, data, notes, reports = station["children"]
        assert [child["name"] for child in operations["children"]] == [
            "Operating Conditions", "Operating Instructions", "Field Notes",
        ]
        assert equipment["children"][0]["name"] == "Maximo Database"
        assert {child["name"] for child in equipment["children"][1:]} == {
            "Powerhouse", "Switchyard", "Protection & Control", "Waterways", "Station Service",
        }
        conditions = library.item(operations["children"][0]["id"])
        assert conditions["state"] == "Setup pending"
        assert conditions.get("readings") in (None, [])
        dumped = json.dumps(conditions)
        assert "MW" not in dumped
        maximo = library.item(equipment["children"][0]["id"])
        assert maximo["maximo"]["href"] == f"/api/maximo/station?id={station['id']}"
        assert "maximo" not in library.item(data["id"])
        assert notes["children"] == []
        assert [child["name"] for child in reports["children"]] == [
            "Daily Production", "Flows", "Outages", "Forecasting",
        ]
        for leaf in (*data["children"], *reports["children"], operations["children"][1]):
            record = library.item(leaf["id"])
            if record.get("menuKey") == "outages":
                assert record.get("state") != "Setup pending"
                assert record["events"] == []
                continue
            assert record["state"] == "Setup pending"
            assert record.get("readings") in (None, [])


def test_search_keeps_matching_devices_and_their_folders(database):
    snapshot = library.tree("okikendawt")
    def names(node):
        yield node["name"]
        for child in node.get("children") or []:
            yield from names(child)
    found = set(names(snapshot["tree"]))
    assert "Okikendawt GS" in found
    assert "Penstock" in found
    assert "Fort Frances" not in found
    assert "Bird GS" not in found


def test_item_lookup_and_empty_id(database):
    record = library.item("device:site:iroquois-falls:powerhouse:unit-1-generator")
    assert record["kind"] == "device"
    assert record["site"] == "Iroquois Falls"
    assert record["area"] == "East"
    assert "maximo" not in record
    assert record["notes"] == []
    assert "acknowledge" in record["note"]
    station = library.item("site:twin-falls")
    assert [item["name"] for item in station["contents"]] == [
        "Operations", "Equipment", "Data", "Notes", "Reports",
    ]
    assert station["maximo"]["href"] == "/api/maximo/station?id=site:twin-falls"
    maximo = library.item("menu:site:twin-falls:maximo-database")
    assert maximo["menuKey"] == "maximo-database"
    assert maximo["maximo"]["href"] == "/api/maximo/station?id=site:twin-falls"
    assert maximo["maximo"]["configured"] is False
    data = library.item("menu:site:twin-falls:data")
    assert data["menuKey"] == "data"
    assert "maximo" not in data
    conditions = library.item("menu:site:twin-falls:operating-conditions")
    assert conditions["menuKey"] == "operating-conditions"
    assert conditions["state"] == "Setup pending"
    assert "maximo" not in conditions
    assert conditions.get("readings") in (None, [])
    dumped = json.dumps(conditions)
    assert "MW" not in dumped and "headwater" not in dumped.lower()
    folder = library.item("folder:site:iroquois-falls:powerhouse")
    assert {item["name"] for item in folder["contents"]} >= {"Unit 1 Generator"}
    with pytest.raises(ValueError):
        library.item("")
    with pytest.raises(LookupError):
        library.item("device:missing")


def test_notes_are_append_only_idempotent_and_do_not_change_alarm_state(database):
    with store._session() as connection:
        events.append_event(
            connection,
            event_id="alarm-open",
            event_type="market.transition",
            occurred_at="2026-09-13T10:00:00Z",
            actor_id="test operator",
            aggregate_type="price_alert",
            aggregate_id="alarm-1",
            source="market",
            summary="Open alarm",
            payload={"newState": "open"},
        )
    first = library.add_note(
        "device:site:iroquois-falls:powerhouse:unit-1-generator",
        "Nameplate checked",
        "operator console",
        "retry-1",
    )
    second = library.add_note(
        "device:site:iroquois-falls:powerhouse:unit-1-generator",
        "Nameplate checked",
        "operator console",
        "retry-1",
    )
    assert first["id"] == second["id"] and second["duplicate"]
    with pytest.raises(ValueError):
        library.add_note(
            "device:site:iroquois-falls:powerhouse:unit-1-generator",
            "Different note",
            "operator console",
            "retry-1",
        )
    record = library.item("device:site:iroquois-falls:powerhouse:unit-1-generator")
    assert [note["text"] for note in record["notes"]] == ["Nameplate checked"]
    assert record["notes"][0]["actorId"] == "operator console"
    assert record["notes"][0]["href"] == events.report_href(first["id"])
    assert first["href"] == record["notes"][0]["href"]
    note_report = register.detail(first["id"], {})
    assert note_report["event"]["href"] == first["href"]
    assert note_report["event"]["category"] == "library"
    detail = register.detail("alarm-open", {})
    assert detail["event"]["status"] == "open"
    assert detail["history"]["total"] == 1


def test_station_notes_may_expire_or_persist_and_are_not_deleted(database):
    expired = library.add_note(
        "menu:site:twin-falls:notes",
        "Gate check overnight",
        "operator console",
        "expire-1",
        expires_at="2020-01-01T00:00:00Z",
    )
    persist = library.add_note(
        "menu:site:twin-falls:notes",
        "Headpond watch for the day",
        "operator console",
        "persist-1",
        persist_on="2026-09-13",
    )
    assert expired["duplicate"] is False and persist["duplicate"] is False
    with pytest.raises(ValueError):
        library.add_note(
            "menu:site:twin-falls:notes",
            "Both schedules",
            "operator console",
            "both-1",
            expires_at="2026-09-14T12:00:00Z",
            persist_on="2026-09-14",
        )
    record = library.item("menu:site:twin-falls:notes")
    texts = [note["text"] for note in record["notes"]]
    assert "Gate check overnight" in texts
    assert "Headpond watch for the day" in texts
    overnight = next(note for note in record["notes"] if note["text"] == "Gate check overnight")
    assert overnight["expired"] is True
    assert overnight["expiresAt"].startswith("2020-01-01")
    dated = next(note for note in record["notes"] if note["text"] == "Headpond watch for the day")
    assert dated["persistOn"] == "2026-09-13"
    assert dated["expired"] is False
    assert overnight["href"].startswith("event-detail.html?id=")


def test_station_menus_list_recorded_event_reports_only(database):
    opened = store.create_outage({
        "title": "Unit 1 outage",
        "asset": "U1",
        "site": "Twin Falls",
        "severity": "Degraded",
        "type": "Unplanned",
        "details": "Unit offline",
    }, actor="operator console")
    store.create_outage({
        "title": "Other station",
        "asset": "U2",
        "site": "Iroquois Falls",
        "severity": "Monitor",
    }, actor="operator console")
    with store._session() as connection:
        events.append_event(
            connection,
            event_id="site-alarm",
            event_type="workforce.help_requested",
            occurred_at="2026-09-13T11:00:00Z",
            actor_id="worker",
            aggregate_type="checkin",
            aggregate_id="checkin-tf",
            source="workforce",
            summary="Help requested",
            severity="critical",
            payload={"site": "Twin Falls", "newState": "requested"},
        )
    outages = library.item("menu:site:twin-falls:outages")
    assert outages.get("state") != "Setup pending"
    assert [row["eventId"] for row in outages["events"]] == [opened["eventId"]]
    assert outages["events"][0]["href"] == opened["href"]
    assert outages["events"][0]["href"].startswith("event-detail.html?id=")
    other = library.item("menu:site:iroquois-falls:outages")
    assert opened["eventId"] not in {row["eventId"] for row in other["events"]}
    conditions = library.item("menu:site:twin-falls:operating-conditions")
    assert conditions["state"] == "Setup pending"
    assert [row["eventId"] for row in conditions["events"]] == ["site-alarm"]
    production = library.item("menu:site:twin-falls:daily-production")
    assert production["events"] == []
    assert production.get("readings") in (None, [])
    station = library.item("site:twin-falls")
    ids = {row["eventId"] for row in station["events"]}
    assert opened["eventId"] in ids
    assert "site-alarm" in ids


def test_alias_outage_appears_on_the_canonical_station_log(database):
    opened = store.create_outage({
        "title": "GS label outage",
        "asset": "U1",
        "site": "Iroquois Falls GS",
        "severity": "Degraded",
    }, actor="operator console")
    assert opened["site"] == "Iroquois Falls"
    assert opened["siteId"] == "site:iroquois-falls"
    outages = library.item("menu:site:iroquois-falls:outages")
    assert [row["eventId"] for row in outages["events"]] == [opened["eventId"]]
    twin = library.item("menu:site:twin-falls:outages")
    assert opened["eventId"] not in {row["eventId"] for row in twin["events"]}
    station = library.item("site:iroquois-falls")
    assert opened["eventId"] in {row["eventId"] for row in station["events"]}


@pytest.fixture
def service(database, monkeypatch):
    import ieso_backend as backend
    monkeypatch.setattr(backend, "OPERATOR_GATE", "access")
    monkeypatch.setattr(backend, "OPERATOR_HOST", "ops.northstarenergy.ca")
    monkeypatch.setattr(backend, "CHECKIN_ORIGIN", "https://checkin.northstarenergy.ca")
    server = backend.NorthstarHTTPServer(("127.0.0.1", 0), backend.Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def call(path, *, public=False, authorized=False, payload=None):
        headers = {"Host": "checkin.northstarenergy.ca" if public else "ops.northstarenergy.ca"}
        if authorized:
            headers.update({
                "Cf-Access-Jwt-Assertion": "fixture",
                "Cf-Access-Authenticated-User-Email": "operator@example.test",
            })
        data = None if payload is None else json.dumps(payload).encode()
        if data:
            headers["Content-Type"] = "application/json"
        try:
            response = urlopen(
                Request(f"http://127.0.0.1:{server.server_port}{path}", data=data, headers=headers),
                timeout=5,
            )
        except HTTPError as error:
            response = error
        body = response.read()
        return response.status, json.loads(body) if body else {}

    yield call
    server.shutdown()
    server.server_close()
    thread.join()


def test_library_routes_remain_operator_only_even_with_forged_public_header(service):
    for path in ["/api/library", "/api/library/item?id=company:northstar"]:
        assert service(path)[0] == 403
        assert service(path, public=True, authorized=True)[0] == 403
    assert service("/api/library/notes", public=True, authorized=True, payload={})[0] == 403


def test_library_tree_and_notes_use_the_server_actor(service):
    code, snapshot = service("/api/library", authorized=True)
    assert code == 200
    assert snapshot["tree"]["name"] == "NorthStar Energy"
    code, missing = service("/api/library/item", authorized=True)
    assert code == 400
    assert service("/api/library/item?id=missing", authorized=True)[0] == 404
    code, result = service("/api/library/notes", authorized=True, payload={
        "itemId": "company:northstar",
        "text": "Reviewed the company tree",
        "actor": "forged",
        "requestId": "note-1",
    })
    assert code == 201
    detail = service("/api/library/item?id=company:northstar", authorized=True)[1]
    assert detail["notes"][0]["actorId"] == "operator@example.test"
    assert detail["notes"][0]["text"] == "Reviewed the company tree"
    assert detail["notes"][0]["href"].startswith("event-detail.html?id=")
    assert result["href"] == detail["notes"][0]["href"]
    assert "forged" not in json.dumps(detail)
