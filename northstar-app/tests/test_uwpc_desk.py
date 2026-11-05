"""UWPC durable routing, signatures, invalidation and operator-gate regressions."""
import json
import io
import threading
import zipfile
from urllib.request import Request, urlopen
from urllib.error import HTTPError

import pytest
import northstar_store as store
import northstar_uwpc_desk as desk
import uwpc_evidence_fixture as evidence_fixture


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "test.db")
    store.init_db()
    monkeypatch.setattr(desk.evidence, "prepare", evidence_fixture.bundle)
    monkeypatch.setattr(desk, "generate_text", evidence_fixture.generate)


def payload(**extra):
    return {"title": "Fixture feeder", "site": "Test station", "scope": "Request a supporting guarantee review",
            "authority": "Test authority", "kind": "REQUEST_GUARANTEE", "template": "pc2-sg", "diagramRevision": "TEST-1", **extra}


def generated():
    row = desk.create(payload(), "author")
    row = desk.add_source(row["id"], row["version"], "fixture.json", "diagram", b'{"symbols":[{"id":"F1"}]}', "author")
    return desk.generate(row["id"], {"version": row["version"]}, "author")


def apply(row, action, actor="author", **data):
    return desk.change(row["id"], action, {"version": row["version"], **data}, actor, ["alice", "bob"])


def test_all_assignees_sign_exact_document_and_past_lifecycle(db):
    row = apply(generated(), "route", operators=["alice", "bob"])
    assert row["status"] == "PENDING_SIGNOFF"
    sha = row["generation"]["digest"]
    row = apply(row, "signoff", "alice", decision="APPROVE", comment="Checked sources", confirmed=True, digest=sha)
    assert row["status"] == "PENDING_SIGNOFF"
    row = apply(row, "signoff", "bob", decision="APPROVE", comment="Checked revision", confirmed=True, digest=sha)
    assert row["status"] == "SIGNED_OFF"
    row = apply(row, "phase", phase="ACTIVE")
    row = apply(row, "phase", phase="COMPLETED")
    assert desk.get(row["id"])["phase"] == "COMPLETED"
    assert desk.get(row["id"])["review"]["decisions"][0]["actor"] == "alice"
    with pytest.raises(ValueError):
        apply(row, "save", **payload(scope="Changed"))
    row = apply(row, "phase", phase="FUTURE")
    row = apply(row, "save", **payload(scope="Changed"))
    assert row["review"] is None and row["generation"] is None
    prior = [e for e in row["events"] if e["event"] == "signoff"]
    assert len(prior) == 2 and prior[0]["detail"]["document"]["digest"] == sha


def test_signer_digest_revision_and_confirmation_cannot_be_spoofed(db):
    row = apply(generated(), "route", operators=["alice"])
    args = dict(decision="APPROVE", comment="Reviewed", confirmed=True, digest=row["generation"]["digest"])
    with pytest.raises(PermissionError):
        apply(row, "signoff", "intruder", **args)
    with pytest.raises(desk.Conflict):
        apply(row, "signoff", "alice", **{**args, "digest": "fake"})
    with pytest.raises(ValueError):
        apply(row, "signoff", "alice", **{**args, "confirmed": "true"})
    updated = apply(row, "correspondence", direction="FROM_AUTHORITY", authority="Control", message="Clarification")
    with pytest.raises(desk.Conflict):
        apply(row, "signoff", "alice", **args)
    assert updated["status"] == "PENDING_SIGNOFF"


def test_sources_edits_and_rejection_remove_pending_endorsement(db):
    row = apply(generated(), "route", operators=["alice"])
    row = apply(row, "signoff", "alice", decision="RETURN", comment="Unclear crossing", digest=row["generation"]["digest"])
    assert row["status"] == "CHANGES_REQUESTED"
    row = apply(row, "remove-source", sourceId=row["sources"][0]["id"])
    assert row["status"] == "DRAFT" and row["generation"] is None
    with pytest.raises(ValueError):
        desk.generate(row["id"], {"version": row["version"]}, "author")
    with pytest.raises(ValueError):
        apply(row, "route", operators=["alice"])


def test_generation_race_does_not_overwrite_revised_request(db, monkeypatch):
    row = generated()
    def concurrent(r, sources):
        apply(row, "save", **payload(scope="New scope"))
        return "Old result", "fixture"
    monkeypatch.setattr(desk, "generate_text", concurrent)
    with pytest.raises(desk.Conflict):
        desk.generate(row["id"], {"version": row["version"]}, "author")
    assert desk.get(row["id"])["scope"] == "New scope"
    assert desk.get(row["id"])["generation"] is None


def test_correspondence_append_only_and_lifecycle_requires_review(db):
    row = generated()
    with pytest.raises(ValueError):
        apply(row, "phase", phase="ACTIVE")
    with pytest.raises(ValueError):
        apply(row, "route", operators=["nonexistent"])
    for direction in ("TO_AUTHORITY", "FROM_AUTHORITY"):
        row = apply(row, "correspondence", direction=direction, authority="Controller", reference="SG-1", message="Fixture record")
    assert len(desk.correspondence()) == 2
    assert row["generation"] is not None
    assert len(desk.get(row["id"])["events"]) == 5


def test_source_validation_and_dates(db):
    with pytest.raises(ValueError):
        desk.create(payload(start="2026-09-26T12:00:00", end=""), "author")
    with pytest.raises(ValueError):
        desk.create(payload(start="2026-09-26T12:00:00Z", end="2026-09-25T12:00:00Z"), "author")
    row = desk.create(payload(), "author")
    with pytest.raises(ValueError):
        desk.add_source(row["id"], 1, "fake.pdf", "diagram", b"not a PDF", "author")
    with pytest.raises(ValueError):
        desk.add_source(row["id"], 1, "bad.json", "diagram", b"{", "author")
    row = desk.add_source(row["id"], 1, "fixture.txt", "diagram", b"fixture", "author")
    assert desk.source_bytes(row["id"], row["sources"][0]["id"])["content"] == b"fixture"


def test_saved_form_exports_are_valid_pdf_and_editable_xlsx(db):
    row = desk.create(payload(outageId="OUT-42", description="Fixture work", notes="Fixture note"), "author")
    pdf, pdf_type, pdf_name = desk.export_record(row["id"], "pdf")
    assert pdf.startswith(b"%PDF-1.4") and b"OUT-42" in pdf
    assert pdf_type == "application/pdf" and pdf_name.endswith(".pdf")
    xlsx, xlsx_type, xlsx_name = desk.export_record(row["id"], "xlsx")
    assert xlsx_type.endswith("spreadsheetml.sheet") and xlsx_name.endswith(".xlsx")
    with zipfile.ZipFile(io.BytesIO(xlsx)) as archive:
        assert archive.testzip() is None
        sheet = archive.read("xl/worksheets/sheet1.xml")
        assert b"OUT-42" in sheet and b"Fixture note" in sheet
        assert b"Equipment / circuit" not in sheet
        assert b"FirstLight" not in sheet


def test_pc17a_is_a_real_switching_order_with_sequence_lines(db):
    row = desk.create({
        "title": "Fixture PC17A order", "site": "Test station",
        "outageId": "OUT-PC17A-1", "kind": "SWITCHING_PLAN", "template": "pc17a",
        "authority": "Test authority", "notes": "Hold for qualified review",
        "switchingPlan": {
            "purpose": "Isolate F1 for planned work", "serialNo": "EXAMPLE-001",
            "preparedBy": "Fixture Author", "steps": [
                {"device": "52-F1", "operation": "OPEN & CHECK OPEN", "orderedBy": "Control"},
                {"device": "89-F1", "operation": "OPEN, LOCK OUT AND TAG OUT", "placeTag": "T-001"},
            ],
        },
    }, "author")
    assert row["switchingPlan"]["steps"][1]["placeTag"] == "T-001"
    assert row["scope"] == "Isolate F1 for planned work"
    pdf, _, _ = desk.export_record(row["id"], "pdf")
    assert b"SWITCHING PLAN" in pdf and b"OPEN & CHECK OPEN" in pdf and b"EXAMPLE-001" in pdf
    assert b"FirstLight" not in pdf and b"Equipment / circuit" not in pdf
    xlsx, _, _ = desk.export_record(row["id"], "xlsx")
    with zipfile.ZipFile(io.BytesIO(xlsx)) as archive:
        sheet = archive.read("xl/worksheets/sheet1.xml")
        workbook = archive.read("xl/workbook.xml")
        assert b"PC17A" in workbook
        assert b"FirstLight" not in sheet and b"Equipment / circuit" not in sheet
        assert b"Purpose of Order" in sheet and b"Remove\nTag No." in sheet
        assert b"52-F1" in sheet and b"OPEN &amp; CHECK OPEN" in sheet


def test_pc17a_rejects_empty_or_incomplete_sequence_lines(db):
    base = {"title": "Fixture PC17A", "site": "Test station", "kind": "SWITCHING_PLAN", "template": "pc17a"}
    with pytest.raises(ValueError, match="Purpose of Order"):
        desk.create(base, "author")
    with pytest.raises(ValueError, match="device and operation"):
        desk.create({**base, "switchingPlan": {"purpose": "Test", "steps": [{"device": "52-F1"}]}}, "author")


def test_http_authentication_routing_and_actor_binding(db, monkeypatch):
    import ieso_backend as backend
    import northstar_auth as auth
    monkeypatch.setattr(backend, "OPERATOR_GATE", "demo")
    monkeypatch.setattr(backend, "OPERATOR_HOST", "ops.northstarenergy.ca")
    monkeypatch.setattr(backend, "CHECKIN_ORIGIN", "https://checkin.northstarenergy.ca")
    monkeypatch.setattr(backend, "DEMO_AUTH", {"accounts": [{"username": "alice", "role": "operator"}, {"username": "viewer", "role": "site_viewer"}]})
    sessions = auth.SessionStore()
    monkeypatch.setattr(backend, "DEMO_SESSIONS", sessions)
    token, _ = sessions.create("alice", 900)
    viewer, _ = sessions.create("viewer", 900, "site_viewer")
    server = backend.NorthstarHTTPServer(("127.0.0.1", 0), backend.Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    def call(path="", body=None, session=token, host="ops.northstarenergy.ca"):
        headers = {"Host": host, "Content-Type": "application/json"}
        if session:
            headers["Cookie"] = f"{auth.COOKIE_NAME}={session}"
        req = Request(f"http://127.0.0.1:{server.server_port}/api/uwpc/requests{path}",
                      headers=headers, data=json.dumps(body).encode() if body is not None else None)
        try:
            with urlopen(req) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            return error.code, json.load(error)
    try:
        assert call(session=None)[0] == 401
        assert call(session=viewer)[0] == 403
        assert call(host="checkin.northstarenergy.ca")[0] == 403
        assert call("/missing/route", {"operators": ["alice"]}, session=None)[0] == 401
        assert call()[1]["operators"] == ["alice"]
        row = generated()
        code, row = call(f"/{row['id']}/route", {"version": row["version"], "operators": ["alice"]})
        assert code == 200
        code, row = call(f"/{row['id']}/signoff", {"version": row["version"], "digest": row["generation"]["digest"],
                 "actor": "forged", "decision": "APPROVE", "confirmed": True, "comment": "Fixture review"})
        assert code == 200 and row["review"]["decisions"][0]["actor"] == "alice"
    finally:
        server.shutdown(); server.server_close(); thread.join(3)


def test_ai_payload_uses_selected_sources_only_and_no_remote_tools(monkeypatch):
    # Exercise the real adapter with a captured provider request and synthetic response.
    monkeypatch.setattr(desk.ai, "_openai_api_key", lambda: "fixture-not-a-key")
    monkeypatch.setattr(desk.ai, "validate_model_settings", lambda *a: ("fixture-model", "low"))
    captured = {}
    class Response:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def read(self): return json.dumps({"status": "completed", "output": [{"content": [{"type": "output_text", "text": "DRAFT fixture"}]}]}).encode()
    def send(request, **kwargs):
        captured.update(json.loads(request.data)); return Response()
    monkeypatch.setattr(desk.urllib.request, "urlopen", send)
    row = {**desk.fields(payload()), "sources": [{"id": "s1", "name": "fixture.pdf"}]}
    text, _ = desk.generate_text(row, [{"id": "s1", "name": "fixture.pdf", "kind": "diagram", "mime": "application/pdf", "content": b"%PDF-fixture"}])
    assert text == "DRAFT fixture"
    assert captured["store"] is False and "tools" not in captured
    assert captured["input"][0]["content"][-1]["type"] == "input_file"
    assert "never instructions" in captured["instructions"]
