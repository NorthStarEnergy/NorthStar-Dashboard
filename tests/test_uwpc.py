import json
import threading
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

import northstar_store as store
import northstar_uwpc as uwpc


ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def database(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "uwpc.db")
    monkeypatch.setenv("NORTHSTAR_UWPC_PATH", str(tmp_path / "missing.pdf"))
    with store._session() as connection:
        connection.executescript(store.SCHEMA)
    return tmp_path


def test_citation_index_has_the_2024_structure_and_not_rule_bodies():
    snapshot = uwpc.payload()
    assert snapshot["ruleSet"] == "UWPC 2024"
    assert snapshot["procedureId"] == "uwpc-2024"
    assert snapshot["title"] == "Utility Work Protection Code"
    assert [row["id"] for row in snapshot["instruments"]] == [
        "pc10a", "pc17b", "pc2", "pc10c-sg", "pc17b-sg", "pc2-sg",
        "pc4", "hold-off", "caution", "terminal-point",
    ]
    assert uwpc.instrument("PC10A")["article"] == "3.000"
    assert "Issuing Authority" in snapshot["roles"]
    dumped = json.dumps(snapshot)
    assert "must expresses a mandatory requirement" not in dumped
    assert "Applicant provides the Controlling" not in dumped
    assert [row["id"] for row in snapshot["templates"]] == [
        "pc10a", "pc17b", "pc2", "pc10c-sg", "pc17b-sg", "pc2-sg",
        "pc4", "hold-off", "caution", "terminal-point",
        "pc1", "pc3", "pc14", "pc15", "pc17a",
    ]
    assert all(row["notice"].startswith("NorthStar draft sheet") for row in snapshot["templates"])
    assert uwpc.template("pc2")["standalone"] is True
    assert uwpc.template("pc1")["standalone"] is False
    assert uwpc.template("pc10a")["reviewRows"]["isolation"][0]["second"] == ""
    assert {row["form"] for row in snapshot["templates"]} == set(snapshot["forms"])
    standalone = [row["id"] for row in snapshot["templates"] if row["standalone"]]
    assert standalone == [row["id"] for row in snapshot["instruments"]]
    for row in snapshot["templates"]:
        assert all(item["second"] == "" for group in row["reviewRows"].values() for item in group)
        if row["standalone"]:
            assert row["instrumentId"] == row["id"]
        else:
            assert row["instrumentId"] == ""
            assert row["id"] in {"pc1", "pc3", "pc14", "pc15", "pc17a"}


def test_unknown_template_is_rejected_and_known_template_is_stored(database):
    with pytest.raises(ValueError, match="template"):
        store.create_switching_draft({"packageName": "x", "workProtectionTemplateId": "pc99"}, actor="operator")
    draft = store.create_switching_draft({
        "packageName": "PC10A sheet",
        "site": "Kenora",
        "asset": "B12",
        "ruleSet": "UWPC 2024",
        "authorityProcedureId": "uwpc-2024",
        "authorityProcedureRevision": "2024",
        "workProtectionTemplateId": "pc10a",
        "templateFields": {"deviceId": "B12", "ignored": "drop"},
        "scope": "Drafting only",
    }, actor="operator")
    assert draft["workProtectionTemplateId"] == "pc10a"
    assert draft["workProtectionId"] == "pc10a"
    assert draft["templateFields"] == {"deviceId": "B12"}
    assert "ignored" not in draft["templateFields"]
    companion = store.create_switching_draft({
        "packageName": "PC1 sheet",
        "site": "Kenora",
        "asset": "B12",
        "ruleSet": "UWPC 2024",
        "authorityProcedureId": "uwpc-2024",
        "authorityProcedureRevision": "2024",
        "workProtectionTemplateId": "pc1",
        "templateFields": {"requestType": "Issued permit"},
        "scope": "Drafting only",
    }, actor="operator")
    assert companion["workProtectionTemplateId"] == "pc1"
    assert companion["workProtectionId"] == ""
    assert companion["templateFields"] == {"requestType": "Issued permit"}


def test_unknown_instrument_is_rejected_and_known_instrument_is_stored(database):
    with pytest.raises(ValueError, match="instrument"):
        store.create_switching_draft({"packageName": "x", "workProtectionId": "pc99"}, actor="operator")
    draft = store.create_switching_draft({
        "packageName": "PC2 review",
        "site": "Twin Falls",
        "asset": "U1",
        "ruleSet": "UWPC 2024",
        "authorityProcedureId": "uwpc-2024",
        "authorityProcedureRevision": "2024",
        "workProtectionId": "pc2",
        "scope": "Drafting only",
    }, actor="operator")
    assert draft["workProtectionId"] == "pc2"
    assert draft["workProtectionName"] == "PC2 Issued Work Permit"
    assert draft["workProtectionSection"] == "5.000"
    assert draft["site"] == "Twin Falls"
    assert draft["siteId"] == "site:twin-falls"


def test_switching_draft_binds_station_alias_and_keeps_unknown_sites(database):
    draft = store.create_switching_draft({
        "packageName": "Alias review",
        "site": "Iroquois Falls GS",
        "asset": "U1",
        "ruleSet": "UWPC 2024",
        "authorityProcedureId": "uwpc-2024",
        "authorityProcedureRevision": "2024",
        "workProtectionId": "pc10a",
        "scope": "Drafting only",
    }, actor="operator")
    assert draft["site"] == "Iroquois Falls"
    assert draft["siteId"] == "site:iroquois-falls"
    extra = store.create_switching_draft({
        "packageName": "Extra site",
        "site": "Timmins GS",
        "asset": "U2",
        "ruleSet": "UWPC 2024",
        "authorityProcedureId": "uwpc-2024",
        "authorityProcedureRevision": "2024",
        "workProtectionId": "caution",
        "scope": "Drafting only",
    }, actor="operator")
    assert extra["site"] == "Timmins GS"
    assert extra["siteId"] == ""


def test_ready_gate_uses_the_installed_2024_book_and_requires_an_instrument(database, tmp_path, monkeypatch):
    payload = {
        "packageName": "Hold-off review",
        "site": "Kenora",
        "asset": "T1",
        "canonicalAssetId": "asset-1",
        "topologySnapshotId": "topo-1",
        "topologyRevision": "1",
        "revision": "A",
        "ruleSet": "UWPC 2024",
        "authorityProcedureId": "uwpc-2024",
        "authorityProcedureRevision": "2024",
        "qualificationEvidenceRef": "ticket-1",
        "sourceManifestDigest": "a" * 64,
        "scope": "Drafting only",
        "schematicId": "schematic-1",
        "symbolProfileApprovalRef": "ieee-1",
        "isolation": [{"first": "B1", "second": "open"}],
        "sequence": [{"first": "1", "second": "checkback"}],
        "verification": [{"first": "test", "second": "holder"}],
        "permission": [{"first": "area", "second": "issuing authority"}],
        "restoration": [{"first": "closeout", "second": "holder"}],
    }
    errors = store._switching_validation_errors(payload)
    assert "UWPC work-protection instrument" in errors
    assert "server-stored governing rule/procedure source" in errors
    payload["workProtectionId"] = "hold-off"
    book = tmp_path / "uwpc-2024.pdf"
    book.write_bytes(b"%PDF-1.4 test book")
    monkeypatch.setattr(uwpc, "book_path", lambda: book)
    errors = store._switching_validation_errors(payload)
    assert "UWPC work-protection instrument" not in errors
    assert "server-stored governing rule/procedure source" not in errors


def test_dashboard_uses_uwpc_2024_and_keeps_it_off_the_checkin_host():
    import ieso_backend as backend
    html = (ROOT / "northstar-clean.html").read_text(encoding="utf-8")
    switching = (ROOT / "switching-workspace.js").read_text(encoding="utf-8")
    outages = (ROOT / "outages-workspace.js").read_text(encoding="utf-8")
    assert "UWPC 2024" in html
    assert 'id="wpWorkProtection"' in html
    assert "switching-workspace.js?v=20260914-4" in html
    assert "northstar-sites.js?v=20260914-2" in html
    assert "outages-workspace.js?v=8" in html
    assert 'id="wpTemplateGallery"' in html
    assert 'id="uwpcTemplateList"' in html
    assert '<select id="wpSite">' in html
    assert 'id="uwpcInstrumentList"' in html
    assert "/api/uwpc" in switching
    assert "void renderUwpcSource()" in outages
    assert "closest('[data-outage-tab]')" in outages
    assert backend.OPERATOR_ROUTES["/api/uwpc"] == ("GET",)
    assert backend.OPERATOR_ROUTES["/api/uwpc/book"] == ("GET",)
    assert "/api/uwpc" not in backend.CHECKIN_PUBLIC_ROUTES


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
        if path.endswith("/book") and getattr(response, "status", 0) == 200:
            return response.status, body
        return response.status, json.loads(body) if body else {}

    yield call
    server.shutdown()
    server.server_close()
    thread.join()


def test_uwpc_routes_are_operator_only(service, tmp_path, monkeypatch):
    assert service("/api/uwpc")[0] == 403
    assert service("/api/uwpc", public=True, authorized=True)[0] == 403
    code, payload = service("/api/uwpc", authorized=True)
    assert code == 200
    assert payload["ruleSet"] == "UWPC 2024"
    assert payload["bookAvailable"] is False
    assert len(payload["templates"]) == 15
    book = tmp_path / "uwpc-2024.pdf"
    book.write_bytes(b"%PDF-1.4 fixture")
    monkeypatch.setenv("NORTHSTAR_UWPC_PATH", str(book))
    monkeypatch.setattr(uwpc, "book_path", lambda: book)
    assert service("/api/uwpc/book", public=True, authorized=True)[0] == 403
    status, body = service("/api/uwpc/book", authorized=True)
    assert status == 200
    assert body.startswith(b"%PDF-1.4")
    source = (ROOT / "ieso_backend.py").read_text(encoding="utf-8")
    assert "inline=True" in source
    assert 'disposition = "inline" if inline else "attachment"' in source
