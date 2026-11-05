from __future__ import annotations

import importlib
import os
import tempfile
import unittest
from pathlib import Path


class WaterObservationStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        os.environ["NORTHSTAR_DB"] = str(Path(self.directory.name) / "water-observations.db")
        import northstar_store

        self.store = importlib.reload(northstar_store)
        self.store.init_db()

    def tearDown(self) -> None:
        self.directory.cleanup()
        os.environ.pop("NORTHSTAR_DB", None)

    @staticmethod
    def payload(**overrides: object) -> dict[str, object]:
        return {
            "region": "EAST",
            "facility": "Lake Abitibi",
            "metricType": "ELEVATION",
            "occurredAt": "2026-09-15T08:00",
            "value": 266.1,
            "quality": "VERIFIED",
            "sourceType": "HYDROMETRIC",
            "sourceRef": "04LF001",
            "reviewBandLow": 266.2,
            "reviewBandHigh": 267.0,
            "notes": "Temporary test observation",
            **overrides,
        }

    def test_records_are_append_only_and_latest_series_state_is_derived(self) -> None:
        first = self.store.create_water_observation(self.payload(), "operator@example.test")
        correction = self.store.create_water_observation(
            self.payload(
                occurredAt="2026-09-15T09:15",
                value=266.6,
                quality="CORRECTED",
                notes="Corrected control-room observation",
            ),
            "operator@example.test",
        )

        self.assertTrue(first["immutable"])
        self.assertTrue(correction["immutable"])
        self.assertEqual(len(self.store.list_water_observations()), 2)
        summary = self.store.water_observation_summary()
        current = summary["latestReadings"][0]
        self.assertEqual(current["id"], correction["id"])
        self.assertEqual(current["bandStatus"], "WITHIN REVIEW BAND")
        self.assertFalse(hasattr(self.store, "update_water_observation"))

    def test_source_and_review_band_are_validated(self) -> None:
        with self.assertRaisesRegex(ValueError, "source reference"):
            self.store.create_water_observation(self.payload(sourceRef=""), "operator@example.test")
        with self.assertRaisesRegex(ValueError, "both review band"):
            self.store.create_water_observation(self.payload(reviewBandHigh=""), "operator@example.test")
        with self.assertRaisesRegex(ValueError, "lower value"):
            self.store.create_water_observation(
                self.payload(reviewBandLow=267.1, reviewBandHigh=267.0), "operator@example.test"
            )
        with self.assertRaisesRegex(ValueError, "cannot be negative"):
            self.store.create_water_observation(
                self.payload(metricType="OUTFLOW", value=-1), "operator@example.test"
            )

    def test_catalog_preserves_waterdb_regions_metrics_and_facilities(self) -> None:
        catalog = self.store.water_observation_catalog()
        self.assertTrue(catalog["appendOnly"])
        self.assertIn({"key": "ELEVATION", "label": "Reservoir elevation", "unit": "m"}, catalog["metrics"])
        self.assertIn({"region": "WEST", "name": "Rainy Lake"}, catalog["facilities"])
        self.assertEqual(catalog["timezone"], "America/Toronto")


if __name__ == "__main__":
    unittest.main()
