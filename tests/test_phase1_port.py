"""Coverage for the SQLite port of the Phase 1 addendum."""

from __future__ import annotations

import importlib
import json
import os
import tempfile
import threading
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


class Phase1PortTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        os.environ["NORTHSTAR_DB"] = str(Path(self.directory.name) / "phase1.db")
        os.environ["NORTHSTAR_QR_SECRET"] = "phase1-test-secret"
        os.environ["NORTHSTAR_PHONE_VERIFICATION_MODE"] = "dev"
        import northstar_store
        import northstar_phase1

        self.store = importlib.reload(northstar_store)
        self.phase1 = importlib.reload(northstar_phase1)
        self.store.init_db()
        import ieso_backend

        self.backend = importlib.reload(ieso_backend)
        self.server = self.backend.NorthstarHTTPServer(("127.0.0.1", 0), self.backend.Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.directory.cleanup()
        for name in ("NORTHSTAR_DB", "NORTHSTAR_QR_SECRET", "NORTHSTAR_PHONE_VERIFICATION_MODE"):
            os.environ.pop(name, None)

    def request(self, method: str, path: str, payload: object | None = None) -> tuple[int, object]:
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(
            self.base + path,
            data=data,
            method=method,
            headers={"Content-Type": "application/json"},
        )
        try:
            response = urlopen(request, timeout=5)
        except HTTPError as error:
            response = error
        body = response.read()
        return response.status, json.loads(body) if body else None

    def test_signed_qr_phone_verification_and_operator_acceptance(self) -> None:
        status, tokens = self.request("GET", "/api/checkin-tokens")
        self.assertEqual(status, 200)
        token = next(row["token"] for row in tokens if row["siteCode"] == "APIROQ")

        status, resolved = self.request("GET", "/api/checkin-tokens/resolve?token=" + token)
        self.assertEqual(status, 200)
        self.assertEqual(resolved["site"], "Iroquois Falls")

        status, verification = self.request(
            "POST",
            "/api/phone-verifications",
            {"token": token, "phone": "416-555-0123"},
        )
        self.assertEqual(status, 201)
        status, verified = self.request(
            "POST",
            f"/api/phone-verifications/{verification['verificationId']}/verify",
            {"code": verification["debugCode"]},
        )
        self.assertEqual(status, 200)
        self.assertTrue(verified["verified"])

        status, record = self.request(
            "POST",
            "/api/checkins",
            {
                "name": "Contractor A",
                "company": "Northstar Test Co.",
                "kind": "Contractor",
                "qrToken": token,
                "phone": "4165550123",
                "phoneVerificationId": verification["verificationId"],
                "provisional": True,
            },
        )
        self.assertEqual(status, 201)
        self.assertEqual(record["site"], "Iroquois Falls")
        self.assertEqual(record["verificationMethod"], "qr-phone")
        self.assertTrue(record["phoneVerified"])
        self.assertEqual(record["status"], "provisional")

        status, accepted = self.request(
            "POST",
            f"/api/checkins/{record['id']}/provisional",
            {"accept": True, "actor": "shift lead"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(accepted["status"], "on-site")
        self.assertEqual(accepted["acceptedBy"], "shift lead")

    def test_retention_coordinate_purge_and_scada_import_are_persistent(self) -> None:
        policies = self.phase1.list_retention_policies()
        location_policy = next(row for row in policies if row["dataCategory"] == "field-location")
        self.assertEqual(location_policy["retentionDays"], 90)
        self.assertEqual(self.phase1.escalation_mode("Iroquois Falls"), "Shadow")

        record = self.store.create_checkin(
            {"name": "Old Worker", "site": "Iroquois Falls", "latitude": 45.0, "longitude": -79.0}
        )
        self.phase1.attach_checkin_security(
            record["id"],
            {"verificationMethod": "operator-entered"},
        )
        reference = datetime.now(ZoneInfo("America/Toronto"))
        old = (reference - timedelta(days=120)).isoformat()
        self.phase1.record_location(record["id"], 45.0, -79.0, old)
        with self.store._session() as connection:
            connection.execute(
                "UPDATE checkins SET last_heard=?, latitude=45.0, longitude=-79.0 WHERE id=?",
                (old, record["id"]),
            )
        self.assertGreaterEqual(self.phase1.purge_expired_coordinates(reference), 1)
        self.assertIsNone(self.store.get_checkin(record["id"])["latitude"])

        csv = f"Timestamp,Output,WaterLevel\n{(reference - timedelta(minutes=5)).isoformat()},12.5,9.8\n"
        imported = self.phase1.import_scada_content("default", "unitstatus_001.csv", csv)
        self.assertEqual(imported["status"], "Imported")
        self.assertEqual(imported["imported"], 2)
        duplicate = self.phase1.import_scada_content("default", "unitstatus_001.csv", csv)
        self.assertEqual(duplicate["status"], "Duplicate")
        status, snapshot = self.request("GET", "/api/scada")
        self.assertEqual(status, 200)
        self.assertEqual(len(snapshot["readings"]), 2)
        self.assertEqual(snapshot["feeds"][0]["status"], "Current")


if __name__ == "__main__":
    unittest.main()
