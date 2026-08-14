"""The logbook is evidence. These tests prove tampering is detectable.

Append-only enforced in application code only proves the application does not
edit. It says nothing about someone opening the SQLite file with any database
browser, which is the realistic threat for a file on a Windows PC. The hash
chain is what makes that detectable, so each test here edits the database
directly, behind the store's back, exactly as such a person would.
"""

from __future__ import annotations

import sqlite3

import pytest

import northstar_store as store


@pytest.fixture()
def clean_log(tmp_path, monkeypatch):
    """A store backed by a scratch database, never the operational one."""
    db = tmp_path / "integrity.db"
    monkeypatch.setattr(store, "DB_PATH", db)
    monkeypatch.setattr(store, "BACKUP_DIR", tmp_path / "backups")
    store.init_db()
    return db


def _rows(db):
    connection = sqlite3.connect(db)
    connection.row_factory = sqlite3.Row
    try:
        return connection.execute(
            "SELECT rowid, id, subject, details, prev_hash, entry_hash FROM logbook ORDER BY rowid"
        ).fetchall()
    finally:
        connection.close()


def test_a_clean_log_verifies(clean_log):
    for n in range(5):
        store.add_logbook_entry("Test", f"entry {n}", f"details {n}", "operator")
    result = store.verify_logbook_chain()
    assert result["ok"] is True
    assert result["entries"] == 5
    assert result["brokenAt"] is None


def test_an_empty_log_verifies(clean_log):
    assert store.verify_logbook_chain()["ok"] is True


def test_each_entry_chains_to_its_predecessor(clean_log):
    store.add_logbook_entry("Test", "first", "a", "operator")
    store.add_logbook_entry("Test", "second", "b", "operator")
    rows = _rows(clean_log)
    assert rows[0]["prev_hash"] == ""
    assert rows[1]["prev_hash"] == rows[0]["entry_hash"]
    assert rows[0]["entry_hash"] != rows[1]["entry_hash"]


def test_editing_an_entry_is_detected(clean_log):
    store.add_logbook_entry("Switching", "breaker opened", "as directed", "operator")
    store.add_logbook_entry("Note", "shift handover", "nothing outstanding", "operator")
    target = _rows(clean_log)[0]["id"]

    connection = sqlite3.connect(clean_log)
    connection.execute(
        "UPDATE logbook SET details = ? WHERE id = ?", ("never happened", target)
    )
    connection.commit()
    connection.close()

    result = store.verify_logbook_chain()
    assert result["ok"] is False
    assert result["brokenAt"] == target


def test_deleting_an_entry_is_detected(clean_log):
    for n in range(4):
        store.add_logbook_entry("Test", f"entry {n}", "x", "operator")
    doomed = _rows(clean_log)[1]

    connection = sqlite3.connect(clean_log)
    connection.execute("DELETE FROM logbook WHERE id = ?", (doomed["id"],))
    connection.commit()
    connection.close()

    result = store.verify_logbook_chain()
    assert result["ok"] is False


def test_an_entry_inserted_out_of_band_is_detected(clean_log):
    store.add_logbook_entry("Test", "real", "x", "operator")
    connection = sqlite3.connect(clean_log)
    connection.execute(
        "INSERT INTO logbook (id, at, type, subject, details, source, prev_hash, entry_hash)"
        " VALUES (?,?,?,?,?,?,?,?)",
        ("event-forged", "2026-08-14T00:00:00-04:00", "Note", "forged", "", "operator", "", ""),
    )
    connection.commit()
    connection.close()

    assert store.verify_logbook_chain()["ok"] is False


def test_rewriting_the_tail_does_not_repair_an_earlier_edit(clean_log):
    """The point of a chain: fixing one row's digest does not fix the ones after."""
    for n in range(3):
        store.add_logbook_entry("Test", f"entry {n}", f"d{n}", "operator")
    rows = _rows(clean_log)
    first = rows[0]

    forged = store._logbook_hash(
        "", first["id"], _at(clean_log, first["id"]), "Test", "entry 0", "tampered", "operator"
    )
    connection = sqlite3.connect(clean_log)
    connection.execute(
        "UPDATE logbook SET details = ?, entry_hash = ? WHERE id = ?",
        ("tampered", forged, first["id"]),
    )
    connection.commit()
    connection.close()

    # Row 0 now self-consistently hashes its tampered contents, but row 1 still
    # records the ORIGINAL digest as its prev_hash, so the break simply moves.
    result = store.verify_logbook_chain()
    assert result["ok"] is False


def _at(db, record_id):
    connection = sqlite3.connect(db)
    try:
        return connection.execute("SELECT at FROM logbook WHERE id = ?", (record_id,)).fetchone()[0]
    finally:
        connection.close()


def test_truncated_fields_are_hashed_as_stored(clean_log):
    """Verification must reflect the record as kept, not the text as submitted."""
    store.add_logbook_entry("Test", "s" * 400, "d" * 9000, "operator")
    assert store.verify_logbook_chain()["ok"] is True
    row = _rows(clean_log)[0]
    assert len(row["details"]) == 4000
    assert len(row["subject"]) == 160
