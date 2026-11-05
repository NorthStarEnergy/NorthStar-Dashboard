from __future__ import annotations

import importlib
import os
import tempfile
import unittest
from pathlib import Path


class DailyOperationsStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        os.environ["NORTHSTAR_DB"] = str(Path(self.directory.name) / "daily-operations.db")
        import northstar_store

        self.store = importlib.reload(northstar_store)
        self.store.init_db()

    def tearDown(self) -> None:
        self.directory.cleanup()
        os.environ.pop("NORTHSTAR_DB", None)

    @staticmethod
    def complete_payload() -> dict[str, object]:
        return {
            "reportDate": "2026-09-15",
            "region": "EAST",
            "title": "Daily Operations Report",
            "sourceChecks": [
                {"key": key, "state": "REVIEWED", "note": "Reviewed for this shift."}
                for key in (
                    "hydrometric", "scada_production", "forecast_weather", "outages",
                    "unit_cycling", "maintenance",
                )
            ],
            "metrics": [
                {
                    "station": "Water Survey of Canada gauge 04LF001",
                    "metricKey": "water_level",
                    "value": 4.566,
                    "unit": "m",
                    "observedAt": "2026-09-15T08:00:00-04:00",
                    "source": "Water Survey of Canada",
                    "sourceRef": "wsc:04LF001",
                },
                {
                    "station": "Iroquois Falls",
                    "metricKey": "unit_status",
                    "value": "Reviewed against control-room record",
                    "unit": "",
                    "observedAt": "2026-09-15T08:00:00-04:00",
                    "source": "Operator review",
                    "sourceRef": "shift-log",
                },
            ],
            "notes": "No operating action is implied by this snapshot.",
        }

    def test_published_snapshot_is_hashed_and_immutable(self) -> None:
        draft = self.store.create_daily_operation_report(self.complete_payload(), "operator@example.test")
        self.assertEqual(draft["status"], "DRAFT")
        self.assertTrue(draft["validation"]["ready"])

        published = self.store.publish_daily_operation_report(
            draft["id"], {"version": draft["version"]}, "reviewer@example.test"
        )
        self.assertEqual(published["status"], "PUBLISHED")
        self.assertTrue(published["immutable"])
        self.assertEqual(len(published["snapshotSha256"]), 64)
        self.assertEqual(published["snapshot"]["schemaVersion"], 1)
        self.assertEqual(published["snapshot"]["metrics"][0]["sourceRef"], "wsc:04LF001")

        with self.assertRaisesRegex(ValueError, "immutable"):
            self.store.save_daily_operation_draft(
                draft["id"], {**self.complete_payload(), "version": published["version"]}, "operator@example.test"
            )
        self.assertEqual(self.store.daily_operation_history(draft["id"])[0]["event"], "published")

    def test_publish_requires_explicit_review_of_every_source(self) -> None:
        payload = self.complete_payload()
        payload["sourceChecks"] = []
        draft = self.store.create_daily_operation_report(payload, "operator@example.test")
        self.assertFalse(draft["validation"]["ready"])
        with self.assertRaisesRegex(ValueError, "cannot be published"):
            self.store.publish_daily_operation_report(
                draft["id"], {"version": draft["version"]}, "operator@example.test"
            )

    def test_stale_draft_write_is_rejected(self) -> None:
        draft = self.store.create_daily_operation_report(self.complete_payload(), "operator@example.test")
        updated = self.store.save_daily_operation_draft(
            draft["id"], {**self.complete_payload(), "version": draft["version"], "notes": "Updated note."},
            "operator@example.test",
        )
        self.assertEqual(updated["version"], 2)
        with self.assertRaisesRegex(ValueError, "changed"):
            self.store.save_daily_operation_draft(
                draft["id"], {**self.complete_payload(), "version": draft["version"]}, "operator@example.test"
            )

    def test_catalog_exposes_only_supported_regions_and_metrics(self) -> None:
        catalog = self.store.daily_operation_catalog()
        self.assertEqual(catalog["regions"], ["EAST", "WEST", "QUEBEC"])
        self.assertIn({"key": "inflow", "label": "Inflow"}, catalog["metrics"])


if __name__ == "__main__":
    unittest.main()
