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
