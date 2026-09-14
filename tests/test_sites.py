import json
import threading
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

import northstar_device_library as library
import northstar_sites as sites
import northstar_store as store


ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def database(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "sites.db")
    with store._session() as connection:
        connection.executescript(store.SCHEMA)
        library.init_schema(connection)
    library._CACHE = None
    return tmp_path


def test_eighteen_stations_keep_catalog_order_and_known_voltages():
    names = [row["name"] for row in sites.stations()]
    assert names == [
        "Fort Frances", "Calm Lake", "Sturgeon Falls", "Kenora", "Norman",
        "Twin Falls", "Iroquois Falls", "Island Falls", "Old Woman Falls",
        "White Otter Rapids", "Camp Three Rapids", "Big Beaver Falls", "Okikendawt GS",
        "McDougal", "Bird GS", "Cogent", "Aiyers 1", "Aiyers 2",
    ]
    assert len(sites.stations()) == 18
    assert "Timmins" not in names and "Carmichael" not in names
    assert "Smooth Rock" not in " ".join(names)
    assert sites.resolve("Iroquois Falls")["voltage"] == "230 kV"
    assert sites.resolve("Fort Frances")["voltage"] == "115 kV"
    assert sites.system_site()["id"] == "site:system-transmission"
    assert [row["name"] for row in sites.options(include_system=True)][-1] == "System / transmission"
    assert all(row["name"] != "System / transmission" for row in sites.options(include_system=False))


def test_aliases_resolve_and_unknown_strings_pass_through():
    assert sites.resolve("Iroquois Falls GS")["id"] == "site:iroquois-falls"
    assert sites.resolve("Iroquois Falls 230 kV")["name"] == "Iroquois Falls"
    assert sites.resolve("site:iroquois-falls")["name"] == "Iroquois Falls"
    assert sites.resolve("Kenora / Norman")["id"] == "site:kenora"
    assert sites.resolve("Norman")["id"] == "site:norman"
    assert sites.resolve("Fort Frances GS")["name"] == "Fort Frances"
    assert sites.resolve("System")["id"] == sites.SYSTEM_ID
    assert sites.bind("Iroquois Falls GS") == {
        "site": "Iroquois Falls", "siteId": "site:iroquois-falls",
    }
    assert sites.bind("", "site:kenora") == {"site": "Kenora", "siteId": "site:kenora"}
    assert sites.bind("Timmins GS") == {"site": "Timmins GS", "siteId": ""}
    assert "Iroquois Falls GS" in sites.match_names("site:iroquois-falls")
    assert "Timmins GS" in sites.match_names("Timmins GS")


def test_outage_and_checkin_writes_store_canonical_site_and_site_id(database):
    outage = store.create_outage({
        "title": "GS alias",
        "site": "Iroquois Falls GS",
        "severity": "Monitor",
    }, actor="operator")
    assert outage["site"] == "Iroquois Falls"
    assert outage["siteId"] == "site:iroquois-falls"
    checkin = store.create_checkin({"name": "Pat", "site": "Fort Frances GS"})
    assert checkin["site"] == "Fort Frances"
    assert checkin["siteId"] == "site:fort-frances"
    extra = store.create_checkin({"name": "Casey", "site": "Timmins GS"})
    assert extra["site"] == "Timmins GS"
    assert extra["siteId"] == ""


def test_operator_markup_uses_the_canonical_list_and_keeps_sites_off_checkin():
    import ieso_backend as backend
    html = (ROOT / "northstar-clean.html").read_text(encoding="utf-8")
    js = (ROOT / "northstar-sites.js").read_text(encoding="utf-8")
    assert "northstar-sites.js?v=20260914-1" in html
    assert "outages-workspace.js?v=6" in html
    assert 'id="outageSite"' in html
    assert 'id="crewSite"' in html
    for row in sites.stations():
        assert row["name"] in html
        assert row["name"] in js
        assert row["id"] in js
    assert "System / transmission" in html
    assert "/northstar-sites.js" not in backend.CHECKIN_PUBLIC_ROUTES
    assert "/api/sites" not in backend.CHECKIN_PUBLIC_ROUTES
    assert backend.OPERATOR_ROUTES["/api/sites"] == ("GET",)


@pytest.fixture
def service(database, monkeypatch):
    import ieso_backend as backend
    monkeypatch.setattr(backend, "OPERATOR_GATE", "access")
    monkeypatch.setattr(backend, "OPERATOR_HOST", "ops.northstarenergy.ca")
    monkeypatch.setattr(backend, "CHECKIN_ORIGIN", "https://checkin.northstarenergy.ca")
    server = backend.NorthstarHTTPServer(("127.0.0.1", 0), backend.Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def call(path, *, public=False, authorized=False):
        headers = {"Host": "checkin.northstarenergy.ca" if public else "ops.northstarenergy.ca"}
        if authorized:
            headers.update({
                "Cf-Access-Jwt-Assertion": "fixture",
                "Cf-Access-Authenticated-User-Email": "operator@example.test",
            })
        try:
            response = urlopen(
                Request(f"http://127.0.0.1:{server.server_port}{path}", headers=headers),
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


def test_sites_route_is_operator_only_and_lists_eighteen_plus_system(service):
    assert service("/api/sites")[0] == 403
    assert service("/api/sites", public=True, authorized=True)[0] == 403
    code, payload = service("/api/sites", authorized=True)
    assert code == 200
    assert [row["name"] for row in payload["stations"]] == [row["name"] for row in sites.stations()]
    assert payload["system"]["id"] == "site:system-transmission"
    assert len(payload["options"]) == 19
    assert len(payload["crewOptions"]) == 18
    assert payload["options"][-1]["name"] == "System / transmission"
