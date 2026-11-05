import json
import sqlite3

import pytest

import northstar_microsoft as microsoft
import northstar_store as store


@pytest.fixture
def db():
    connection = sqlite3.connect(":memory:")
    connection.executescript(store.SCHEMA)
    yield connection
    connection.close()


@pytest.fixture
def outlook():
    return microsoft.MicrosoftSource("outlook", "users/test/mailFolders/operations", "Operations", enabled=True)


def message():
    return {"id": "mail-1", "receivedDateTime": "2026-09-11T10:00:00Z",
            "lastModifiedDateTime": "2026-09-11T10:01:00Z", "subject": "Shift update",
            "bodyPreview": "Unit inspection complete", "conversationId": "thread-1",
            "from": {"emailAddress": {"address": "operator@example.test"}},
            "webLink": "https://outlook.office.com/mail/item/1"}


def test_disabled_and_wrong_source_cannot_write(db, outlook):
    disabled = microsoft.MicrosoftSource("outlook", outlook.resource, "Operations")
    with pytest.raises(PermissionError):
        microsoft.ingest_message(db, disabled, message(), resource=disabled.resource)
    with pytest.raises(PermissionError):
        microsoft.ingest_message(db, outlook, message(), resource="users/other/mailFolders/private")
    assert db.execute("SELECT count(*) FROM audit_events").fetchone()[0] == 0
    assert disabled.status()["state"] == "not_configured"
    assert outlook.status()["connected"] is False


def test_retries_deduplicate_but_edits_and_deletions_remain(db, outlook):
    first = microsoft.ingest_message(db, outlook, message(), resource=outlook.resource)
    retry = microsoft.ingest_message(db, outlook, message(), resource=outlook.resource)
    assert first["eventId"] == retry["eventId"] and not retry["inserted"]
    microsoft.ingest_message(db, outlook, message(), resource=outlook.resource, change="updated")
    microsoft.ingest_message(db, outlook, {"id": "mail-1"}, resource=outlook.resource,
                            change="deleted", occurred_at="2026-09-11T11:00:00Z")
    assert db.execute("SELECT count(*) FROM audit_events").fetchone()[0] == 3
    assert db.execute("SELECT count(distinct aggregate_id) FROM audit_events").fetchone()[0] == 1


def test_rollback_does_not_leave_a_receipt_or_partial_event(db, outlook):
    microsoft.ingest_message(db, outlook, message(), resource=outlook.resource)
    db.rollback()
    assert db.execute("SELECT count(*) FROM audit_events").fetchone()[0] == 0
    assert microsoft.ingest_message(db, outlook, message(), resource=outlook.resource)["inserted"]


def test_teams_reply_preserves_thread_and_scrubs_html(db):
    source = microsoft.MicrosoftSource("teams", "teams/test/channels/operations/messages", "Operations channel", True)
    item = {"id": "reply-1", "replyToId": "root-1", "createdDateTime": "2026-09-11T10:00:00Z",
            "from": {"user": {"displayName": "Test Operator"}},
            "body": {"contentType": "html", "content": "<p>Read back</p><script>bad()</script><p>Confirmed &amp; logged</p>"},
            "webUrl": "javascript:alert(1)"}
    microsoft.ingest_message(db, source, item, resource=source.resource)
    payload = json.loads(db.execute("SELECT payload FROM audit_events").fetchone()[0])
    assert payload["details"] == "Read back Confirmed & logged"
    assert payload["threadId"] == "root-1"
    assert payload["originalUrl"] == ""


def test_invalid_identifiers_and_ambiguous_times_are_rejected(outlook):
    for changes in [{"id": ""}, {"receivedDateTime": "2026-09-11T10:00:00"}]:
        with pytest.raises(ValueError):
            microsoft.normalize_message(outlook, {**message(), **changes})
    with pytest.raises(ValueError):
        microsoft.normalize_message(outlook, {"id": "mail-1"}, change="deleted")


def test_preview_is_bounded_and_full_body_is_not_copied(outlook):
    envelope = microsoft.normalize_message(outlook, {**message(), "bodyPreview": "x" * 900,
        "body": {"content": "private full body"}, "attachments": [{"contentBytes": "not copied"}]})
    assert len(envelope["payload"]["details"]) == 500
    assert "private full body" not in json.dumps(envelope)
    assert "not copied" not in json.dumps(envelope)
