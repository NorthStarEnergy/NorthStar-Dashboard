import base64
import json
import pytest
import northstar_store as store
import northstar_operator_knowledge as k
import northstar_uwpc_evidence as e
import northstar_uwpc_desk as desk


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "evidence.db")
    monkeypatch.setenv("NORTHSTAR_AI_SITE_ACCESS", "")
    store.init_db()


def upload(key, site="", approve=True, revision="1"):
    source = k.upload(dict(title=key, filename="fixture.txt", sourceKey=key, revision=revision,
        siteId=site, owner="Fixture owner", contentBase64=base64.b64encode(
            b"1.001 Synthetic fixture clause about feeder review only. This is not real UWPC guidance.").decode()), "fixture-import")
    if approve:
        source = k.review(source["id"], dict(status="CURRENT_CONTROLLED", reason="Synthetic test only",
            confirmed=True, effective_from="2020-01-01", review_due="2099-01-01"), "fixture-reviewer")
    return source


def complete():
    return [upload(key, "site:kenora" if key.startswith(("uwpc-procedure:", "uwpc-example:")) else "")
            for key in ["uwpc-2024", "uwpc-amendments", "uwpc-procedure:test", "uwpc-example:test"]]


def prepare(site="Kenora"):
    return e.prepare(dict(site=site, scope="feeder review", template="pc17a"), "fixture-reviewer")


def output(bundle, **updates):
    passage = bundle["passages"][0]
    finding = dict(claim="Fixture interpretation requires review", citationId=passage["id"],
                   clause="1.001", quote=passage["excerpt"], status="NEEDS_REVIEW") | updates
    return json.dumps(dict(draft="Fixture draft [" + passage["id"] + "]", findings=[finding]))


def test_pending_code_and_other_station_never_supply_authority(db):
    source = upload("uwpc-2024", approve=False)
    upload("uwpc-procedure:other", "site:iroquois-falls")
    bundle = prepare()
    assert bundle["passages"] == [] and len(bundle["missing"]) == 4
    assert bundle["inventory"][0]["status"] == "PENDING_REVIEW"
    assert not any(x["id"] == source["id"] for x in bundle["sources"])


def test_complete_evidence_has_revision_clause_and_exact_citations(db):
    complete()
    bundle = prepare()
    assert bundle["missing"] == [] and len(bundle["passages"]) == 4
    assert all(p["revision"] and p["sha256"] and "1.001" in p["clauseMentions"] for p in bundle["passages"])
    text, check = e.validate(output(bundle), bundle)
    assert check["canRoute"] and check["semanticVerification"] == "NOT_PERFORMED"
    assert "CITATIONS_CHECKED_REVIEW_REQUIRED" in text


@pytest.mark.parametrize("updates", [{"citationId": "oks_invented:99"}, {"clause": "8.999"}, {"quote": "A fabricated quote not in this source."}, {"status": "COMPLIANT"}])
def test_unknown_citation_fabricated_quote_and_approval_are_withheld(db, updates):
    complete(); bundle = prepare()
    text, check = e.validate(output(bundle, **updates), bundle)
    assert not check["canRoute"] and check["errors"] and "Fixture draft" not in text


def test_missing_evidence_withholds_even_well_formed_unsupported_claim(db):
    text, check = e.validate(json.dumps({"draft": "Everything is compliant and safe.", "findings": []}), prepare())
    assert "Everything is compliant" not in text and not check["canRoute"]


@pytest.mark.parametrize("change", ["withdraw", "expire", "supersede", "tamper"])
def test_changed_or_expired_sources_invalidate_review(db, change):
    sources = complete(); bundle = prepare(); source = sources[0]
    if change == "withdraw":
        k.review(source["id"], dict(status="WITHDRAWN", reason="Fixture withdrawal"), "fixture-reviewer")
    elif change == "expire":
        k.review(source["id"], dict(status="CURRENT_CONTROLLED", reason="Fixture expiry", confirmed=True,
            review_due="2021-01-01"), "fixture-reviewer")
    elif change == "supersede":
        upload("uwpc-2024", revision="2")
    else:
        with store._session() as con:
            name = con.execute("SELECT file_path FROM operator_knowledge_sources WHERE id=?", (source["id"],)).fetchone()[0]
        k._path(name).write_bytes(b"tampered")
    with pytest.raises(ValueError, match="changed or expired"):
        e.recheck(bundle, "fixture-reviewer")
    assert source["id"] not in {s["id"] for s in prepare()["sources"]}


def test_unknown_site_and_denied_actor_cannot_borrow_procedures(db, monkeypatch):
    complete()
    assert prepare("invented station")["missing"]
    monkeypatch.setenv("NORTHSTAR_AI_SITE_ACCESS", '{"limited":["site:iroquois-falls"]}')
    with pytest.raises(k.KnowledgeDenied):
        e.prepare(dict(site="Kenora", scope="feeder"), "limited")


def test_missing_sources_skips_model_and_cannot_route(db, monkeypatch):
    row = desk.create(dict(title="Fixture", site="Kenora", scope="feeder", kind="REQUEST_GUARANTEE",
                          template="pc10c-sg", diagramRevision="TEST"), "fixture-author")
    row = desk.add_source(row["id"], row["version"], "fixture.txt", "diagram", b"Fixture only", "fixture-author")
    monkeypatch.setattr(desk, "generate_text", lambda *a: pytest.fail("No AI call without controlled evidence"))
    row = desk.generate(row["id"], {"version": row["version"]}, "fixture-author")
    assert row["generation"]["evidenceCheck"]["status"] == "NOT_ASSESSED"
    with pytest.raises(ValueError, match="incomplete or unverified"):
        desk.change(row["id"], "route", {"version": row["version"], "operators": ["reviewer"]}, "fixture-author", ["reviewer"])


def test_withdrawal_blocks_approval_but_allows_return_for_changes(db, monkeypatch):
    sources = complete()
    monkeypatch.setattr(desk, "generate_text", lambda row, sources: (output(row["_controlledEvidence"]), "fixture"))
    row = desk.create(dict(title="Fixture", site="Kenora", scope="feeder review", kind="REQUEST_GUARANTEE",
                          template="pc10c-sg", diagramRevision="TEST"), "fixture-author")
    row = desk.add_source(row["id"], row["version"], "fixture.txt", "diagram", b"Fixture only", "fixture-author")
    row = desk.generate(row["id"], {"version": row["version"]}, "fixture-author")
    row = desk.change(row["id"], "route", {"version": row["version"], "operators": ["reviewer"]}, "fixture-author", ["reviewer"])
    k.review(sources[0]["id"], dict(status="WITHDRAWN", reason="Fixture withdrawal"), "fixture-reviewer")
    payload = dict(version=row["version"], decision="APPROVE", comment="Fixture", confirmed=True, digest=row["generation"]["digest"])
    with pytest.raises(ValueError, match="changed or expired"):
        desk.change(row["id"], "signoff", payload, "reviewer", ["reviewer"])
    row = desk.change(row["id"], "signoff", payload | {"decision": "RETURN"}, "reviewer", ["reviewer"])
    assert row["status"] == "CHANGES_REQUESTED"
