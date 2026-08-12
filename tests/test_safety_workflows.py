"""Regression tests for persistent field-safety workflows."""

from __future__ import annotations

import importlib
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


class HelpRequestTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        os.environ["NORTHSTAR_DB"] = str(Path(self.directory.name) / "test.db")
        import northstar_store

        self.store = importlib.reload(northstar_store)
        self.store.init_db()
        self.checkin = self.store.create_checkin(
            {"name": "Field Worker", "site": "Kenora", "alone": True}
        )

    def tearDown(self) -> None:
        self.directory.cleanup()
        os.environ.pop("NORTHSTAR_DB", None)

    def test_request_acknowledge_resolve_is_audited(self) -> None:
        requested = self.store.request_help(self.checkin["id"], "worker device")
        self.assertTrue(requested["needsHelp"])
        self.assertEqual(requested["helpState"], "requested")
        self.assertTrue(requested["helpRequestedAt"])

        acknowledged = self.store.acknowledge_help(self.checkin["id"], "shift lead")
        self.assertTrue(acknowledged["needsHelp"])
        self.assertEqual(acknowledged["helpState"], "acknowledged")
        self.assertEqual(acknowledged["helpAcknowledgedBy"], "shift lead")

        resolved = self.store.resolve_help(self.checkin["id"], "control room")
        self.assertFalse(resolved["needsHelp"])
        self.assertEqual(resolved["helpState"], "resolved")
        self.assertEqual(resolved["helpResolvedBy"], "control room")

        events = self.store.history(self.checkin["id"])
        self.assertEqual(
            [event["event"] for event in events[:3]],
            ["help resolved", "help acknowledged", "help requested"],
        )
        self.assertEqual(events[2]["priorHelpState"], "none")
        self.assertEqual(events[2]["newHelpState"], "requested")
        self.assertEqual(events[1]["newHelpState"], "acknowledged")
        self.assertEqual(events[0]["newHelpState"], "resolved")

    def test_repeated_actions_are_idempotent(self) -> None:
        first = self.store.request_help(self.checkin["id"])
        second = self.store.request_help(self.checkin["id"])
        self.assertEqual(second["helpRequestedAt"], first["helpRequestedAt"])
        self.store.acknowledge_help(self.checkin["id"], "operator one")
        repeated = self.store.acknowledge_help(self.checkin["id"], "operator two")
        self.assertEqual(repeated["helpAcknowledgedBy"], "operator one")
        help_events = [event for event in self.store.history(self.checkin["id"]) if "help" in event["event"]]
        self.assertEqual(len(help_events), 2)

    def test_help_request_survives_module_reload(self) -> None:
        self.store.request_help(self.checkin["id"])
        import northstar_store

        reloaded = importlib.reload(northstar_store)
        records = reloaded.list_checkins()
        self.assertEqual(records[0]["id"], self.checkin["id"])
        self.assertTrue(records[0]["needsHelp"])

    def test_active_help_remains_visible_after_checkout(self) -> None:
        self.store.request_help(self.checkin["id"])
        self.store.check_out(self.checkin["id"])
        records = self.store.list_checkins()
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["status"], self.store.STATUS_CHECKED_OUT)
        self.assertTrue(records[0]["needsHelp"])
        self.store.resolve_help(self.checkin["id"])
        self.assertEqual(self.store.list_checkins(), [])

    def test_checked_out_worker_cannot_open_a_new_request(self) -> None:
        self.store.check_out(self.checkin["id"])
        with self.assertRaises(ValueError):
            self.store.request_help(self.checkin["id"])


class SchemaMigrationTest(unittest.TestCase):
    def test_existing_pilot_database_gains_help_columns(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "legacy.db"
            connection = sqlite3.connect(path)
            connection.executescript(
                """
                CREATE TABLE checkins (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, site TEXT NOT NULL,
                    kind TEXT NOT NULL, company TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
                    alone INTEGER NOT NULL DEFAULT 0, checked_in TEXT NOT NULL,
                    last_heard TEXT NOT NULL, checked_out_at TEXT,
                    overdue_after_minutes INTEGER NOT NULL, expected_minutes INTEGER,
                    notes TEXT NOT NULL DEFAULT '', latitude REAL, longitude REAL
                );
                CREATE TABLE checkin_events (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT, checkin_id TEXT NOT NULL,
                    at TEXT NOT NULL, actor TEXT NOT NULL, event TEXT NOT NULL,
                    site TEXT NOT NULL, worker TEXT NOT NULL, prior_status TEXT,
                    new_status TEXT, details TEXT NOT NULL DEFAULT ''
                );
                """
            )
            connection.close()
            os.environ["NORTHSTAR_DB"] = str(path)
            try:
                import northstar_store

                store = importlib.reload(northstar_store)
                store.init_db()
                record = store.create_checkin({"name": "Migrated Worker", "site": "Kenora"})
                self.assertEqual(record["helpState"], "none")
                self.assertTrue(store.request_help(record["id"])["needsHelp"])
            finally:
                os.environ.pop("NORTHSTAR_DB", None)


if __name__ == "__main__":
    unittest.main()
