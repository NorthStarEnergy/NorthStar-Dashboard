import json
import threading
from urllib.error import HTTPError
from urllib.parse import unquote_plus
from urllib.request import Request, urlopen

import pytest

import northstar_device_library as library
import northstar_maximo as maximo
import northstar_store as store


@pytest.fixture
def database(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "maximo.db")
    monkeypatch.setattr(maximo, "ROOT", tmp_path)
    monkeypatch.delenv("NORTHSTAR_MAXIMO_URL", raising=False)
    monkeypatch.delenv("NORTHSTAR_MAXIMO_APIKEY", raising=False)
    monkeypatch.delenv("NORTHSTAR_MAXIMO_USER", raising=False)
    monkeypatch.delenv("NORTHSTAR_MAXIMO_PASSWORD", raising=False)
    monkeypatch.delenv("NORTHSTAR_MAXIMO_CONFIG", raising=False)
    monkeypatch.delenv("NORTHSTAR_MAXIMO_SNAPSHOT", raising=False)
    monkeypatch.setattr(maximo, "_FETCH", None)
    monkeypatch.setattr(maximo, "_SNAPSHOT_CACHE", None)
    with store._session() as connection:
        connection.executescript(store.SCHEMA)
        library.init_schema(connection)
    library._CACHE = None
    return tmp_path


def test_status_is_setup_pending_and_does_not_invent_records(database):
    snapshot = maximo.status()
    assert snapshot["state"] == "Setup pending"
    assert snapshot["configured"] is False
    assert snapshot["connected"] is False
    assert snapshot["readOnly"] is True
    assert "acknowledge" in snapshot["note"]
    ids = {row["id"] for row in snapshot["stations"]}
    assert "site:iroquois-falls" in ids
    assert "site:fort-frances" in ids
    assert "site:aiyers-1" in ids
    assert all(row["href"].startswith("/api/maximo/station?id=") for row in snapshot["stations"])


def test_station_without_connection_returns_empty_collections(database):
    snapshot = maximo.station("site:iroquois-falls")
    assert snapshot["station"]["name"] == "Iroquois Falls"
    assert snapshot["station"]["area"] == "East"
    assert snapshot["station"]["maximoSiteId"] == "EAST"
    assert snapshot["station"]["maximoLocation"] == "IROQUOIS FALLS"
    assert snapshot["assets"] == []
    assert snapshot["workOrders"] == []
    assert snapshot["connected"] is False
    with pytest.raises(ValueError):
        maximo.station("")
    with pytest.raises(LookupError):
        maximo.station("site:missing")


def test_status_does_not_call_maximo(database, monkeypatch):
    monkeypatch.setenv("NORTHSTAR_MAXIMO_URL", "https://maximo.example.invalid/maximo/oslc")
    monkeypatch.setenv("NORTHSTAR_MAXIMO_APIKEY", "secret-key")
    called = []
    monkeypatch.setattr(maximo, "_FETCH", lambda url, headers: called.append(url) or {"member": []})
    snapshot = maximo.status()
    assert snapshot["configured"] is True
    assert snapshot["connected"] is False
    assert snapshot["state"] == "Configured — not yet verified"
    assert called == []
    assert "secret-key" not in json.dumps(snapshot)


def test_imported_equipment_master_is_complete_and_searchable(database, monkeypatch):
    snapshot_path = database / "equipment-master.json"
    snapshot_path.write_text(json.dumps({
        "schemaVersion": 1,
        "source": {
            "filename": "equipment.xlsx",
            "sha256": "a" * 64,
            "sheetName": "List of Assets",
            "headers": ["Asset", "Description", "Location", "Description", "Parent", "Rotating Item", "Site"],
            "importedAt": "2026-09-15T12:00:00+00:00",
        },
        "assets": [
            {"assetNum": "100", "description": "Unit Generator", "location": "IRO-200", "locationDescription": "Powerhouse", "parent": "", "rotatingItem": "", "site": "IRO"},
            {"assetNum": "101", "description": "Generator relay", "location": "IRO-200", "locationDescription": "Powerhouse", "parent": "100", "rotatingItem": "", "site": "IRO"},
            {"assetNum": "200", "description": "Line breaker", "location": "FFO-100", "locationDescription": "Switchyard", "parent": "", "rotatingItem": "", "site": "FFO"},
        ],
    }), encoding="utf-8")
    monkeypatch.setenv("NORTHSTAR_MAXIMO_SNAPSHOT", str(snapshot_path))
    monkeypatch.setattr(maximo, "_SNAPSHOT_CACHE", None)

    status = maximo.equipment_master_status()
    assert status["available"] is True
    assert status["assetCount"] == 3
    assert status["siteCount"] == 2
    assert status["source"]["filename"] == "equipment.xlsx"

    page = maximo.equipment(query="generator", site="IRO", page="1", limit="1")
    assert page["readOnly"] is True
    assert page["total"] == 2
    assert page["pages"] == 2
    assert page["assets"][0]["assetNum"] == "100"
    assert page["assets"][0]["locationDescription"] == "Powerhouse"
    assert {row["code"] for row in page["sites"]} == {"FFO", "IRO"}
    with pytest.raises(ValueError):
        maximo.equipment(page="0")


def test_station_reads_assets_and_work_orders_when_configured(database, monkeypatch):
    monkeypatch.setenv("NORTHSTAR_MAXIMO_URL", "https://maximo.example.invalid/maximo/oslc")
    monkeypatch.setenv("NORTHSTAR_MAXIMO_APIKEY", "secret-key")

    def fetch(url, headers):
        assert headers["apikey"] == "secret-key"
        assert "https://maximo.example.invalid/maximo/oslc/os/" in url
        decoded = unquote_plus(url)
        assert 'location="IROQUOIS FALLS"' in decoded
        assert 'siteid="EAST"' in decoded
        if "mxapiwo" in url:
            return {"member": [{"wonum": "WO-9", "description": "<script>x</script>", "status": "WAPPR"}]}
        return {"member": [{"assetnum": "GSU-1", "description": "GSU Transformer", "status": "OPERATING", "location": "IROQUOIS FALLS"}]}

    monkeypatch.setattr(maximo, "_FETCH", fetch)
    snapshot = maximo.station("site:iroquois-falls")
    assert snapshot["connected"] is True
    assert snapshot["state"] == "connected"
    assert snapshot["assets"][0]["assetNum"] == "GSU-1"
    assert snapshot["workOrders"][0]["woNum"] == "WO-9"
    assert snapshot["workOrders"][0]["description"] == "<script>x</script>"
    body = json.dumps(snapshot)
    assert "secret-key" not in body
    assert "apikey" not in body


def test_http_url_is_not_configured_and_failed_fetch_redacts_secrets(database, monkeypatch):
    monkeypatch.setenv("NORTHSTAR_MAXIMO_URL", "http://maximo.example.invalid/maximo/oslc")
    monkeypatch.setenv("NORTHSTAR_MAXIMO_APIKEY", "secret-key")
    assert maximo.config()["configured"] is False
    monkeypatch.setenv("NORTHSTAR_MAXIMO_URL", "https://maximo.example.invalid/maximo/oslc")

    def boom(url, headers):
        raise ValueError("denied secret-key")

    monkeypatch.setattr(maximo, "_FETCH", boom)
    snapshot = maximo.station("site:kenora")
    assert snapshot["state"] == "failed"
    assert snapshot["connected"] is False
    assert snapshot["assets"] == []
    assert "secret-key" not in json.dumps(snapshot)


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


def test_maximo_routes_remain_operator_only_even_with_forged_public_header(service):
    for path in ["/api/maximo", "/api/maximo/equipment", "/api/maximo/station?id=site:iroquois-falls"]:
        assert service(path)[0] == 403
        assert service(path, public=True, authorized=True)[0] == 403


def test_maximo_station_roundtrip_stays_empty_until_configured(service):
    code, snapshot = service("/api/maximo", authorized=True)
    assert code == 200
    assert snapshot["state"] == "Setup pending"
    assert service("/api/maximo/station", authorized=True)[0] == 400
    assert service("/api/maximo/station?id=missing", authorized=True)[0] == 404
    code, equipment = service("/api/maximo/equipment?limit=1", authorized=True)
    assert code == 200
    assert equipment["available"] is False
    assert equipment["readOnly"] is True
    code, station = service("/api/maximo/station?id=site:iroquois-falls", authorized=True)
    assert code == 200
    assert station["assets"] == []
    assert station["workOrders"] == []
    assert station["readOnly"] is True
