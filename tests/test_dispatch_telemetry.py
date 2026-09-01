"""APIROQ dispatch telemetry simulator and operator API."""

from __future__ import annotations

import importlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


class DispatchTelemetryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        os.environ["NORTHSTAR_DB"] = str(Path(self.directory.name) / "dispatch.db")
        os.environ["NORTHSTAR_DISPATCH_SIM"] = "on"
        os.environ["NORTHSTAR_DISPATCH_SEED"] = "42"
        os.environ["NORTHSTAR_OPERATOR_GATE"] = "off"

        import northstar_dispatch

        self.dispatch = importlib.reload(northstar_dispatch)
        self.dispatch.reset_for_tests(seed=42)

    def tearDown(self) -> None:
        for key in (
            "NORTHSTAR_DB",
            "NORTHSTAR_DISPATCH_SIM",
            "NORTHSTAR_DISPATCH_SEED",
            "NORTHSTAR_OPERATOR_GATE",
        ):
            os.environ.pop(key, None)
        self.directory.cleanup()

    def test_tick_generates_output_and_dispatch_in_operating_band(self) -> None:
        first = self.dispatch.tick(now=1_000.0)
        second = self.dispatch.tick(now=1_006.0)
        for payload in (first, second):
            self.assertEqual(payload["site"], "APIROQ")
            self.assertTrue(payload["simulated"])
            self.assertGreaterEqual(payload["outputMw"], 25.0)
            self.assertLessEqual(payload["outputMw"], 75.0)
            self.assertGreaterEqual(payload["dispatchMw"], 30.0)
            self.assertLessEqual(payload["dispatchMw"], 70.0)
            self.assertIn(payload["tracking"], {"on-target", "minor-deviation", "off-target"})
        self.assertGreater(len(second["history"]), len(first["history"]))

    def test_history_retains_recent_points_only(self) -> None:
        moment = 2_000.0
        for step in range(80):
            self.dispatch.tick(now=moment + step * 5)
        payload = self.dispatch.snapshot()
        self.assertLessEqual(len(payload["history"]), 72)

    def test_sim_off_returns_unavailable_snapshot(self) -> None:
        os.environ["NORTHSTAR_DISPATCH_SIM"] = "off"
        importlib.reload(self.dispatch)
        self.dispatch.reset_for_tests(seed=None)
        payload = self.dispatch.snapshot()
        self.assertFalse(payload["healthy"])
        self.assertIsNone(payload["outputMw"])
        self.assertIsNone(payload["dispatchMw"])


class DispatchApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        os.environ["NORTHSTAR_DB"] = str(Path(self.directory.name) / "dispatch-api.db")
        os.environ["NORTHSTAR_DISPATCH_SIM"] = "on"
        os.environ["NORTHSTAR_DISPATCH_SEED"] = "7"
        os.environ["NORTHSTAR_OPERATOR_GATE"] = "access"

        import northstar_store
        import northstar_dispatch

        self.store = importlib.reload(northstar_store)
        self.store.init_db()
        self.dispatch = importlib.reload(northstar_dispatch)
        self.dispatch.reset_for_tests(seed=7)
        self.dispatch.tick(now=10_000.0)

        import ieso_backend as backend

        self.backend = importlib.reload(backend)
        self.server = self.backend.NorthstarHTTPServer(("127.0.0.1", 0), self.backend.Handler)
        self.server_thread = __import__("threading").Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        for key in (
            "NORTHSTAR_DB",
            "NORTHSTAR_DISPATCH_SIM",
            "NORTHSTAR_DISPATCH_SEED",
            "NORTHSTAR_OPERATOR_GATE",
        ):
            os.environ.pop(key, None)
        self.directory.cleanup()

    def request(self, method: str, path: str, headers: dict | None = None):
        import http.client
        from urllib.parse import urlparse

        parsed = urlparse(self.base + path)
        connection = http.client.HTTPConnection(parsed.hostname, parsed.port, timeout=5)
        connection.request(method, parsed.path, headers=headers or {})
        response = connection.getresponse()
        body = response.read()
        connection.close()
        return response.status, response.getheader("Content-Type"), body

    def test_dispatch_endpoint_requires_operator_gate(self) -> None:
        status, _, _ = self.request("GET", "/api/dispatch/apiroq")
        self.assertEqual(status, 403)

    def test_dispatch_endpoint_returns_telemetry_with_access_header(self) -> None:
        status, content_type, body = self.request(
            "GET",
            "/api/dispatch/apiroq",
            {"Cf-Access-Jwt-Assertion": "test-token"},
        )
        self.assertEqual(status, 200)
        self.assertIn("application/json", content_type or "")
        payload = json.loads(body)
        self.assertEqual(payload["site"], "APIROQ")
        self.assertIsNotNone(payload["outputMw"])
        self.assertIsNotNone(payload["dispatchMw"])


if __name__ == "__main__":
    unittest.main()
