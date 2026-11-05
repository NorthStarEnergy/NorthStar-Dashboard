from __future__ import annotations

import importlib
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]


class SwitchingSimulatorHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_env = {key: os.environ.get(key) for key in (
            "NORTHSTAR_DB", "NORTHSTAR_SIM_ROOT", "NORTHSTAR_OPERATOR_GATE", "NORTHSTAR_CHECKIN_ORIGIN")}
        os.environ["NORTHSTAR_DB"] = str(Path(self.temp.name) / "operational-test.db")
        os.environ["NORTHSTAR_SIM_ROOT"] = str(Path(self.temp.name) / "isolated-simulator")
        os.environ["NORTHSTAR_OPERATOR_GATE"] = "off"
        os.environ.pop("NORTHSTAR_CHECKIN_ORIGIN", None)

        import northstar_store
        self.store = importlib.reload(northstar_store)
        self.store.init_db()
        import ieso_backend
        self.backend = importlib.reload(ieso_backend)
        from northstar_sim import service as sim_service
        sim_service._SIMULATOR = sim_service.SimulatorService(Path(self.temp.name) / "isolated-simulator", background=False)
        self.sim_service = sim_service
        self.server = self.backend.NorthstarHTTPServer(("127.0.0.1", 0), self.backend.Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(timeout=5)
        self.sim_service._SIMULATOR = None
        for key, value in self.old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.temp.cleanup()

    def request(self, method, path, payload=None, headers=None):
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(self.base + path, data=body, method=method,
                          headers={"Content-Type": "application/json", **(headers or {})})
        try:
            response = urlopen(request, timeout=10)
        except HTTPError as error:
            response = error
        return response.status, json.loads(response.read() or b"{}")

    def test_models_session_and_stale_owner_use_simulator_only_routes(self):
        operational_db = Path(self.temp.name) / "operational-test.db"
        operational_before = operational_db.read_bytes()
        status, models = self.request("GET", "/api/training/switching/models")
        self.assertEqual(status, 200)
        self.assertEqual(sum(item["readiness"] == "catalog_only" for item in models["models"]), 20)
        status, session = self.request("POST", "/api/training/switching/sessions", {"scenarioId": "NORMAL-OPEN"})
        self.assertEqual(status, 201)
        self.assertEqual(session["source"], "simulation")
        self.assertNotIn("truth", session)
        self.assertNotIn("electrical", session)
        status, body = self.request("GET", f"/api/training/switching/sessions/{session['sessionId']}")
        self.assertEqual(status, 200)
        self.assertEqual(body["sessionId"], session["sessionId"])
        self.assertTrue((Path(self.temp.name) / "isolated-simulator" / "simulator.sqlite3").exists())
        self.assertTrue((Path(self.temp.name) / "operational-test.db").exists())
        self.assertEqual(operational_db.read_bytes(), operational_before)

    def test_instructor_access_is_checked_again_for_forwarded_and_remote_host_requests(self):
        self.sim_service._SIMULATOR.local_instructor = True
        status, created = self.request("POST", "/api/training/switching/sessions", {"scenarioId": "UNIT-TRIP"})
        self.assertEqual(status, 201)
        path = f"/api/training/switching/sessions/{created['sessionId']}/instructor-state"
        self.assertEqual(self.request("GET", path)[0], 200)
        for headers in ({"X-Forwarded-For": "203.0.113.1"}, {"Host": "remote.example"}, {"Cf-Ray": "test"}):
            self.assertEqual(self.request("GET", path, headers=headers)[0], 404)

    def test_existing_gate_public_host_and_origin_rules_cover_simulator(self):
        self.backend.OPERATOR_GATE = "access"
        status, _ = self.request("GET", "/api/training/switching/models")
        self.assertEqual(status, 403)
        self.backend.CHECKIN_ORIGIN = "https://checkin.test"
        status, _ = self.request("GET", "/api/training/switching/models", headers={
            "Host": "checkin.test", "Cf-Access-Jwt-Assertion": "forged"})
        self.assertEqual(status, 403)
        self.backend.OPERATOR_GATE = "off"
        self.backend.CHECKIN_ORIGIN = ""
        status, _ = self.request("POST", "/api/training/switching/sessions", {"scenarioId": "NORMAL-OPEN"},
                                 {"Origin": "https://attacker.invalid"})
        self.assertEqual(status, 403)


if __name__ == "__main__":
    unittest.main()
