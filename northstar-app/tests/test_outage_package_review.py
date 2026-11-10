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


def approved(row):
    row = change(row, "review-open", **COVER, copyTo=["replacement"])
    for task in row["packageReview"]["tasks"][1:]:
        row = sign(row, task)
    return row


def test_registered_outage_distribution_log_and_closeout(draft):
    out = store.create_outage({"title": "Registered outage", "site": "North", "type": "Planned"})
    row = desk.create({"fromOutage": out["id"]}, "author")
    assert desk.create({"fromOutage": out["id"]}, "author")["id"] == row["id"]
    row = change(row, "save", "author", **{**FORM, "outageId": out["id"]})
    row = desk.add_source(row["id"], row["version"], "drawing.txt", "diagram", b"test drawing", "author")
    with pytest.raises(ValueError, match="switching log"):
        store.close_outage(out["id"])
    row = approved(row)
    delivery = row["distribution"]
    download = lambda: desk.export_record(row["id"], "final", copy_id=delivery["id"], actor="replacement")[0]
    final = download()
    assert set(delivery["recipients"]) == {"manager","operator","relief","area","north","south","replacement"}
    with pytest.raises(PermissionError):
        desk.export_record(row["id"], "final", copy_id=delivery["id"], actor="intruder")
    row = change(row, "final-receipt", "replacement", copyId=delivery["id"])
    with pytest.raises(PermissionError):
        change(row, "log-open", "replacement", copyId=delivery["id"])
    with pytest.raises(ValueError):
        change(row, "phase", phase="COMPLETED")
    row = change(row, "log-open", "operator", copyId=delivery["id"])
    with pytest.raises(ValueError):
        change(row, "log-close", "manager", copyId=delivery["id"], text="No entries")
    row = change(row, "log-entry", "north", site="North", step=1, text="Fixture activity", copyId=delivery["id"])
    assert row["switchLog"]["entries"][0]["device"] == "Fixture"
    row = change(row, "log-close", "operator", text="Fixture work finished", copyId=delivery["id"])
    assert store.get_outage(out["id"])["status"] == "Closed"
    with pytest.raises(ValueError):
        change(row, "log-entry", "north", copyId=delivery["id"], text="late")
    row = change(row, "closeout-note", "south", text="Follow-up recorded", copyId=delivery["id"])
    assert download() == final
    assert row["phase"] == "COMPLETED" and row["switchLog"]["notes"][0]["actor"] == "south"
    with zipfile.ZipFile(io.BytesIO(desk.export_record(row["id"], "package")[0])) as archive:
        assert b"Follow-up recorded" in archive.read("electronic-switching-log.pdf")


def test_return_withdraws_distributed_copy_and_reapproval_issues_another(draft):
    row = approved(draft)
    delivery = row["distribution"]
    row = change(row, "review-return", "south", task=row["packageReview"]["tasks"][-1]["id"], comment="Please clarify.")
    assert not row.get("distribution")
    with pytest.raises(desk.Conflict):
        desk.export_record(row["id"], "final", copy_id=delivery["id"], actor="manager")
    row = change(row, "review-answer", issue="1", comment="Clarified")
    row = change(row, "review-close", "south", issue="1")
    row = sign(row, row["packageReview"]["tasks"][-1])
    assert row["distribution"]["id"] != delivery["id"] and row["distribution"]["receipts"] == {}
