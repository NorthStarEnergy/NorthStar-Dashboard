import io
import json
import zipfile

import pytest

import northstar_store as store
import northstar_uwpc_desk as desk


ROSTER = {"manager": ["manager"], "checker": ["manager", "operator", "author"], "operator": ["operator", "relief", "author"],
          "area": ["area"], "field": ["north", "south", "replacement"]}
ACCOUNTS = sorted({name for names in ROSTER.values() for name in names})
FORM = {"title": "Two-station outage", "site": "North", "affectedSites": ["South"], "outageId": "TEST-1",
        "start": "2030-09-10T12:00:00Z", "end": "2030-09-10T14:00:00Z", "template": "pc17a",
        "kind": "SWITCHING_PLAN", "diagramRevision": "fixture", "switchingPlan": {
            "purpose": "Fixture", "steps": [{"device": "Fixture", "operation": "Fixture step"}]}}
COVER = {"due": "2030-09-10T11:00:00Z", "preparer": "author", "operators": ["operator", "relief"],
         "field": {"North": "north", "South": "south"}, "checker": "operator", "area": "area", "confirmed": True}


@pytest.fixture
def draft(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "review.db")
    roster = tmp_path / "directory.json"
    roster.write_text(json.dumps(ROSTER))
    monkeypatch.setenv("NORTHSTAR_OUTAGE_REVIEW_DIRECTORY", str(roster))
    store.init_db()
    row = desk.create(FORM, "author")
    return desk.add_source(row["id"], row["version"], "one-line.txt", "diagram", b"Fixture diagram", "author")


def change(row, action, actor="manager", **data):
    payload = {"version": row["version"], "digest": (row.get("packageReview") or {}).get("digest"), **data}
    return desk.change(row["id"], action, payload, actor, ACCOUNTS)


def sign(row, task):
    return change(row, "review-sign", task["account"], task=task["id"], confirmed=True)


def test_multiple_sites_require_current_named_reviewers(draft):
    assert draft["reviewTrigger"] == "multi-site"
    with pytest.raises(ValueError, match="significant outage"):
        change(draft, "route", operators=["operator"])
    with pytest.raises(PermissionError):
        change(draft, "review-open", "area", **COVER)
    for invalid in [{"field": {"North": "north"}}, {"checker": "author"}, {"checker": "manager"},
                    {"field": {"North": "north", "South": "north"}}, {"area": "operator"}]:
        with pytest.raises(ValueError):
            change(draft, "review-open", **{**COVER, **invalid})
    row = change(draft, "review-open", **COVER)
    review = row["packageReview"]
    assert review["tasks"][0]["signedAt"] and review["number"] == 1
    tasks = review["tasks"][1:]
    viewed = change(row, "review-view", "relief")
    assert viewed["version"] == row["version"] and viewed["packageReview"]["viewed"]["relief"]
    with pytest.raises(PermissionError):
        change(row, "review-sign", "area", task=tasks[-1]["id"], confirmed=True)
    for task in tasks[:-1]:
        row = sign(row, task)
    assert row["status"] == "PENDING_SIGNOFF"
    with pytest.raises(ValueError):
        change(row, "phase", phase="ACTIVE")
    row = sign(row, tasks[-1])
    assert row["status"] == "SIGNED_OFF"
    blob, _, _ = desk.export_record(row["id"], "package", row["version"])
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        assert b"Planning review complete" in archive.read("package-and-review-cover.pdf")
        assert json.loads(archive.read("review-record.json"))["packageReview"]["digest"] == review["digest"]
        assert archive.read(next(f for f in archive.namelist() if f.startswith("sources/"))) == b"Fixture diagram"
    with pytest.raises(desk.Conflict):
        desk.export_record(row["id"], "package", 1)
    assert change(row, "phase", phase="ACTIVE")["phase"] == "ACTIVE"


def test_corrections_revisions_and_crew_changes(draft):
    row = change(draft, "review-open", **COVER)
    task = row["packageReview"]["tasks"][-1]
    row = change(row, "review-return", "south", task=task["id"], comment="Clarify the site handoff.")
    assert row["status"] == "CHANGES_REQUESTED"
    old = row["packageReview"]["digest"]
    row = change(row, "save", "author", **{**FORM, "notes": "Clarified handoff."})
    assert "packageReview" not in row and row["lastReview"]["digest"] == old
    with pytest.raises(ValueError):
        change(row, "route", operators=["operator"])
    row = change(row, "review-open", **{**COVER, "field": {"North": "north", "South": "replacement"},
                                        "summary": "Clarified handoff and updated crew."})
    assert row["packageReview"]["number"] == 2
    assert all(not t["signedAt"] for t in row["packageReview"]["tasks"][1:])
    with pytest.raises(ValueError):
        change(row, "review-sign", "operator", task="2", confirmed=True, digest=old)
    with pytest.raises(ValueError, match="corrections"):
        sign(row, row["packageReview"]["tasks"][1])
    row = change(row, "review-answer", issue="1", comment="See revised notes.")
    with pytest.raises(PermissionError):
        change(row, "review-close", "replacement", issue="1")
    row = change(row, "review-close", "south", issue="1")
    assert row["status"] == "PENDING_SIGNOFF"
    assert any(e["event"] == "review-open" and e["detail"]["cover"]["digest"] == old for e in row["events"])
