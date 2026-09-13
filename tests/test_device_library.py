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
    assert "device-library.js?v=20260913-1" in html
    assert "device-library.css?v=20260913-1" in html
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
    assert snapshot["counts"]["areas"] == 4
    assert snapshot["counts"]["sites"] >= 12
    assert snapshot["counts"]["devices"] > 100
    areas = {child["name"] for child in snapshot["tree"]["children"]}
    assert areas == {
        "Northeast Ontario",
        "Northwest Ontario",
        "Nipissing / Central",
        "Transmission",
    }
    northeast = next(child for child in snapshot["tree"]["children"] if child["id"] == "area:northeast")
    iroquois = next(child for child in northeast["children"] if child["id"] == "site:iroquois-falls-gs")
    folders = {child["name"] for child in iroquois["children"]}
    assert folders == {
        "Powerhouse",
        "Switchyard",
        "Protection & Control",
        "Waterways",
        "Station Service",
    }
    powerhouse = next(child for child in iroquois["children"] if child["name"] == "Powerhouse")
    names = {child["name"] for child in powerhouse["children"]}
    assert {"Unit 1 Turbine", "Unit 1 Generator", "Unit 1 Governor", "Unit 1 Excitation"} <= names
    assert all(child["kind"] == "device" for child in powerhouse["children"])


def test_search_keeps_matching_devices_and_their_folders(database):
    snapshot = library.tree("penstock")
    def names(node):
        yield node["name"]
        for child in node.get("children") or []:
            yield from names(child)
    found = set(names(snapshot["tree"]))
    assert "Iroquois Falls GS" in found
    assert "Penstock" in found
    assert "Kenora GS" in found
    assert "Iroquois Falls 230 kV" not in found


def test_item_lookup_and_empty_id(database):
    record = library.item("device:site:iroquois-falls-gs:powerhouse:unit-1-generator")
    assert record["kind"] == "device"
    assert record["site"] == "Iroquois Falls GS"
    assert record["notes"] == []
    assert "acknowledge" in record["note"]
    folder = library.item("folder:site:iroquois-falls-gs:powerhouse")
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
        "device:site:iroquois-falls-gs:powerhouse:unit-1-generator",
        "Nameplate checked",
        "operator console",
        "retry-1",
    )
    second = library.add_note(
        "device:site:iroquois-falls-gs:powerhouse:unit-1-generator",
        "Nameplate checked",
        "operator console",
        "retry-1",
    )
    assert first["id"] == second["id"] and second["duplicate"]
    with pytest.raises(ValueError):
        library.add_note(
            "device:site:iroquois-falls-gs:powerhouse:unit-1-generator",
            "Different note",
            "operator console",
            "retry-1",
        )
    record = library.item("device:site:iroquois-falls-gs:powerhouse:unit-1-generator")
    assert [note["text"] for note in record["notes"]] == ["Nameplate checked"]
    assert record["notes"][0]["actorId"] == "operator console"
    detail = register.detail("alarm-open", {})
    assert detail["event"]["status"] == "open"
    assert detail["history"]["total"] == 1


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
    assert "forged" not in json.dumps(detail)
