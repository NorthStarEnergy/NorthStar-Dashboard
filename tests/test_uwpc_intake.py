import pytest
import northstar_store as store
import northstar_uwpc_desk as desk


def test_intake_plan_cannot_be_sent_for_signoff_until_completed(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "intake.db")
    store.init_db()
    payload = dict(title="Fixture", site="Test", kind="SWITCHING_PLAN", template="pc17a",
                   preparationMode="INTAKE", diagramRevision="TEST-1",
                   switchingPlan={"purpose": "Fixture review", "steps": []})
    row = desk.create(payload, "author")
    assert not row["switchingPlan"]["steps"]
    row = desk.add_source(row["id"], row["version"], "drawing.txt", "diagram", b"Synthetic drawing", "author")
    monkeypatch.setattr(desk, "generate_text", lambda r, s: ("DRAFT fixture", "fixture"))
    row = desk.generate(row["id"], {"version": row["version"]}, "author")
    with pytest.raises(ValueError, match="Complete and save"):
        desk.change(row["id"], "route", {"version": row["version"], "operators": ["reviewer"]}, "author", ["reviewer"])
    payload.pop("preparationMode")
    with pytest.raises(ValueError, match="sequence line"):
        desk.change(row["id"], "save", {**payload, "version": row["version"]}, "author")
    payload["switchingPlan"]["steps"] = [{"device": "FIXTURE-ONLY", "operation": "Synthetic test entry"}]
    row = desk.change(row["id"], "save", {**payload, "version": row["version"]}, "author")
    assert row["preparationMode"] == "" and row["generation"] is None
