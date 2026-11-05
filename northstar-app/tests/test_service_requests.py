from __future__ import annotations

import importlib
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo


class ServiceRequestsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.snapshot_path = Path(self.directory.name) / "service-requests.json"
        now = datetime.now(ZoneInfo("America/Toronto"))
        self.snapshot_path.write_text(json.dumps({
            "source": {"filename": "88021365.xlsx", "sheetName": "List of Service Requests"},
            "requests": [
                {"serviceRequest": "100", "summary": "Overdue gate check", "location": "EAST-A",
                 "status": "NEW", "targetFinish": (now - timedelta(days=1)).isoformat()},
                {"serviceRequest": "101", "summary": "Scheduled flow check", "location": "WEST-B",
                 "status": "QUEUED", "targetFinish": (now + timedelta(days=3)).isoformat()},
                {"serviceRequest": "102", "summary": "Completed work", "location": "EAST-A",
                 "status": "CLOSED", "targetFinish": (now - timedelta(days=2)).isoformat()},
                {"serviceRequest": "103", "summary": "Unscheduled request", "location": "QC-C",
                 "status": "DEFERRED", "targetFinish": ""},
            ],
        }), encoding="utf-8")
        os.environ["NORTHSTAR_SERVICE_REQUESTS_SNAPSHOT"] = str(self.snapshot_path)
        import northstar_service_requests

        self.requests = importlib.reload(northstar_service_requests)

    def tearDown(self) -> None:
        self.directory.cleanup()
        os.environ.pop("NORTHSTAR_SERVICE_REQUESTS_SNAPSHOT", None)

    def test_catalog_is_read_only_and_reports_status_counts(self) -> None:
        catalog = self.requests.catalog()
        self.assertTrue(catalog["available"])
        self.assertTrue(catalog["readOnly"])
        self.assertEqual(catalog["recordCount"], 4)
        self.assertEqual(catalog["openCount"], 3)
        self.assertIn({"status": "NEW", "count": 1}, catalog["statuses"])

    def test_filtering_and_due_states_preserve_source_rows(self) -> None:
        overdue = self.requests.list_requests(due="overdue")
        self.assertEqual(overdue["total"], 1)
        self.assertEqual(overdue["records"][0]["serviceRequest"], "100")
        self.assertEqual(overdue["records"][0]["dueState"], "OVERDUE")

        next_week = self.requests.list_requests(due="next_7")
        self.assertEqual(next_week["total"], 1)
        self.assertEqual(next_week["records"][0]["serviceRequest"], "101")
        self.assertEqual(next_week["records"][0]["dueState"], "DUE NEXT 7 DAYS")

        searched = self.requests.list_requests(query="unscheduled")
        self.assertEqual(searched["total"], 1)
        self.assertEqual(searched["records"][0]["serviceRequest"], "103")
        self.assertFalse(hasattr(self.requests, "save_service_request"))

    def test_invalid_due_filter_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "due filter"):
            self.requests.list_requests(due="tomorrow")


if __name__ == "__main__":
    unittest.main()
