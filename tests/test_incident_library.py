from __future__ import annotations

import importlib
import json
import os
import tempfile
import unittest
from pathlib import Path


class IncidentLibraryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.snapshot_path = Path(self.directory.name) / "incident-index.json"
        self.snapshot_path.write_text(json.dumps({
            "source": {"filename": "Incident_Reports.zip", "fileCount": 12},
            "incidents": [
                {"recordId": "a1", "incidentId": "INC-2026-09-14-1", "occurredOn": "2026-09-14",
                 "title": "Lake elevation review", "category": "01_OCC", "reportCount": 1,
                 "evidenceFileCount": 4, "formats": [".docx", ".pdf"]},
                {"recordId": "a2", "incidentId": "INC-2025-04-03-1", "occurredOn": "2025-04-03",
                 "title": "Station outage", "category": "05_FFG_GS", "reportCount": 2,
                 "evidenceFileCount": 6, "formats": [".doc"]},
                {"recordId": "a3", "incidentId": "INC-2025-01-02-1", "occurredOn": "2025-01-02",
                 "title": "Network communication loss", "category": "01_OCC", "reportCount": 1,
                 "evidenceFileCount": 1, "formats": [".pdf"]},
            ],
        }), encoding="utf-8")
        os.environ["NORTHSTAR_INCIDENT_LIBRARY_SNAPSHOT"] = str(self.snapshot_path)
        import northstar_incident_library

        self.library = importlib.reload(northstar_incident_library)

    def tearDown(self) -> None:
        self.directory.cleanup()
        os.environ.pop("NORTHSTAR_INCIDENT_LIBRARY_SNAPSHOT", None)

    def test_catalog_is_read_only_with_category_and_year_counts(self) -> None:
        catalog = self.library.catalog()
        self.assertTrue(catalog["available"])
        self.assertTrue(catalog["readOnly"])
        self.assertEqual(catalog["caseCount"], 3)
        self.assertIn({"category": "01_OCC", "count": 2}, catalog["categories"])
        self.assertIn({"year": "2025", "count": 2}, catalog["years"])

    def test_search_and_filters_do_not_expose_source_paths(self) -> None:
        result = self.library.list_incidents(query="network", category="01_OCC", year="2025")
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["records"][0]["incidentId"], "INC-2025-01-02-1")
        self.assertNotIn("sourcePath", result["records"][0])
        self.assertFalse(hasattr(self.library, "read_document"))

    def test_invalid_year_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "four-digit"):
            self.library.list_incidents(year="next")


if __name__ == "__main__":
    unittest.main()
