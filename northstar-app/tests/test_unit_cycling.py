from __future__ import annotations

import importlib
import os
import tempfile
import unittest
from pathlib import Path


class UnitCyclingStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        os.environ["NORTHSTAR_DB"] = str(Path(self.directory.name) / "unit-cycling.db")
        import northstar_store

        self.store = importlib.reload(northstar_store)
        self.store.init_db()

    def tearDown(self) -> None:
        self.directory.cleanup()
        os.environ.pop("NORTHSTAR_DB", None)

    @staticmethod
    def payload(**overrides: object) -> dict[str, object]:
        return {
            "station": "Iroquois Falls",
            "unitName": "Unit 1",
            "eventType": "START",
            "occurredAt": "2026-09-15T08:00",
            "runningHours": 1234.5,
            "runningDays": 51.4,
            "reason": "Scheduled return to service",
            "sourceRef": "shift-log-01",
            "notes": "Temporary test record",
            **overrides,
        }

    def test_records_are_append_only_and_latest_state_is_derived(self) -> None:
        started = self.store.create_unit_cycling_record(self.payload(), "operator@example.test")
        tripped = self.store.create_unit_cycling_record(
            self.payload(
                eventType="TRIP", occurredAt="2026-09-15T09:15",
                reason="Protection lockout during test",
                runningHours=1235.75,
            ),
            "operator@example.test",
        )

        self.assertTrue(started["immutable"])
        self.assertTrue(tripped["immutable"])
        self.assertEqual(len(self.store.list_unit_cycling_records()), 2)
        summary = self.store.unit_cycling_summary()
        self.assertEqual(summary["unitStates"][0]["state"], "TRIPPED")
        self.assertEqual(summary["unitStates"][0]["id"], tripped["id"])
        self.assertFalse(hasattr(self.store, "update_unit_cycling_record"))

    def test_trip_requires_reason_and_hours_must_be_non_negative(self) -> None:
        with self.assertRaisesRegex(ValueError, "reason"):
            self.store.create_unit_cycling_record(
                self.payload(eventType="TRIP", reason=""), "operator@example.test"
            )
        with self.assertRaisesRegex(ValueError, "running hours"):
            self.store.create_unit_cycling_record(
                self.payload(runningHours=-1), "operator@example.test"
            )

    def test_catalog_lists_only_supported_event_types(self) -> None:
        catalog = self.store.unit_cycling_catalog()
        self.assertTrue(catalog["appendOnly"])
        self.assertIn({"key": "TRIP", "label": "Trip"}, catalog["eventTypes"])
        self.assertEqual(catalog["requiresReason"], ["TRIP", "OTHER"])


if __name__ == "__main__":
    unittest.main()
