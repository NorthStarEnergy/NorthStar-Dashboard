"""Control room event presentation tests."""

from __future__ import annotations

import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


class EventPresentationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        os.environ["NORTHSTAR_DB"] = str(Path(self.directory.name) / "events.db")
        import northstar_store as store

        self.store = importlib.reload(store)
        self.store.init_db()
        import northstar_events as events

        self.events = importlib.reload(events)

    def tearDown(self) -> None:
        os.environ.pop("NORTHSTAR_DB", None)
        self.directory.cleanup()

    def test_logbook_outlook_entry_is_classified_as_email(self) -> None:
        self.store.add_logbook_entry(
            "Outlook email",
            "Shift handoff from night crew",
            "Please review the APIROQ notes.",
        )
        row = self.store.list_audit_events(limit=1)[0]
        self.assertEqual(row["display"]["channel"], "email")
        self.assertEqual(row["display"]["filterGroup"], "comms")
        self.assertEqual(row["display"]["logClass"], "COMMUNICATION")

    def test_market_alert_is_classified_as_alarm_or_market(self) -> None:
        with self.store._LOCK, self.store._session() as connection:
            self.events.append_event(
                connection,
                event_type="market.price_alert",
                occurred_at="2026-09-01T10:00:00-04:00",
                actor_id="northstar-monitor",
                aggregate_type="price_alert",
                aggregate_id="alert_1",
                source="market",
                summary="APIROQ high limit reached",
                payload={"node": "APIROQ", "price": 145.2},
                severity="warn",
            )
        row = self.store.list_audit_events(limit=1)[0]
        self.assertIn(row["display"]["channel"], {"alarm", "market"})
        self.assertEqual(row["display"]["filterGroup"], "alarms")

    def test_client_update_is_classified_as_a_system_event(self) -> None:
        with self.store._LOCK, self.store._session() as connection:
            self.events.append_event(
                connection,
                event_type="system.client_update.applied",
                occurred_at="2026-09-22T10:00:00-04:00",
                actor_id="NorthStar desktop update service",
                aggregate_type="system",
                aggregate_id="dashboard-client",
                source="system",
                summary="CLIENT UPDATED · v0.59",
                payload={"recordKind": "client_release"},
            )
        row = self.store.list_audit_events(limit=1)[0]
        self.assertEqual(row["display"]["channel"], "system")
        self.assertEqual(row["display"]["logClass"], "SYSTEM")
        self.assertEqual(row["display"]["filterGroup"], "system")

    def test_workforce_help_request_is_classified_as_safety(self) -> None:
        with self.store._LOCK, self.store._session() as connection:
            self.events.append_event(
                connection,
                event_type="workforce.help_requested",
                occurred_at="2026-09-01T10:00:00-04:00",
                actor_id="worker",
                aggregate_type="checkin",
                aggregate_id="checkin-1",
                source="workforce",
                summary="Pat Smith: help requested",
                payload={"site": "Kenora", "worker": "Pat Smith"},
                severity="critical",
            )
        row = self.store.list_audit_events(limit=1)[0]
        self.assertEqual(row["display"]["channel"], "safety")
        self.assertEqual(row["display"]["logClass"], "SAFETY")

    def test_switching_event_is_classified_as_engineering(self) -> None:
        with self.store._LOCK, self.store._session() as connection:
            self.events.append_event(
                connection,
                event_type="switching.ready_for_review",
                occurred_at="2026-09-01T10:00:00-04:00",
                actor_id="operator",
                aggregate_type="switching_draft",
                aggregate_id="draft-1",
                source="switching",
                summary="READY FOR QUALIFIED REVIEW",
                payload={"details": "Package submitted"},
            )
        row = self.store.list_audit_events(limit=1)[0]
        self.assertEqual(row["display"]["channel"], "engineering")
        self.assertEqual(row["display"]["filterGroup"], "engineering")
        self.assertTrue(row["href"].startswith("event-detail.html?id="))

    def test_library_note_is_classified_as_library_and_has_a_report_href(self) -> None:
        with self.store._LOCK, self.store._session() as connection:
            self.events.append_event(
                connection,
                event_id="libnote_demo",
                event_type="library.note.added",
                occurred_at="2026-09-13T10:00:00-04:00",
                actor_id="operator",
                aggregate_type="device",
                aggregate_id="menu:site:twin-falls:notes",
                source="library",
                summary="Library note",
                payload={"details": "Do not acknowledge this alarm from a note", "category": "library"},
            )
        row = self.store.list_audit_events(limit=1)[0]
        self.assertEqual(row["href"], "event-detail.html?id=libnote_demo")
        self.assertEqual(row["display"]["channel"], "library")
        self.assertEqual(row["display"]["channelLabel"], "LIBRARY")
