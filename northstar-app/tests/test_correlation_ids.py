"""Packet 27 correlation-ID contract tests."""

from __future__ import annotations

import json
import unittest
from urllib.request import Request, urlopen

class CorrelationIdTests(unittest.TestCase):
    def setUp(self) -> None:
        from test_api_workflows import APITest
        self._api_test_base = APITest
        APITest.setUp(self)

    def tearDown(self) -> None:
        self._api_test_base.tearDown(self)

    def request_with_correlation(self, path: str, correlation_id: str | None) -> tuple[int, object, dict[str, str]]:
        headers = {"Content-Type": "application/json"}
        if correlation_id is not None:
            headers["X-Correlation-Id"] = correlation_id
        request = Request(self.base + path, headers=headers)
        try:
            response = urlopen(request, timeout=20)
        except Exception as error:
            response = error
        body = response.read()
        return response.status, json.loads(body), dict(response.headers.items())

    def test_supplied_safe_id_is_echoed_without_changing_success_body(self) -> None:
        status, body, headers = self.request_with_correlation("/api/health", "packet27-demo")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("X-Correlation-Id"), "packet27-demo")
        self.assertIn("status", body)

    def test_missing_id_is_generated_and_echoed(self) -> None:
        status, _, headers = self.request_with_correlation("/api/health", None)
        self.assertEqual(status, 200)
        self.assertRegex(headers.get("X-Correlation-Id", ""), r"^corr_[A-Za-z0-9]+$")

    def test_api_error_body_includes_correlation_id(self) -> None:
        status, body, headers = self.request_with_correlation("/api/checkins/not-found", "packet27-demo")
        self.assertEqual(status, 404)
        self.assertEqual(body["error"], "check-in not found")
        self.assertEqual(body["correlationId"], "packet27-demo")
        self.assertEqual(headers.get("X-Correlation-Id"), "packet27-demo")

    def test_unsafe_id_is_replaced(self) -> None:
        status, _, headers = self.request_with_correlation("/api/health", "bad value")
        self.assertEqual(status, 200)
        self.assertNotEqual(headers.get("X-Correlation-Id"), "bad value")
        self.assertRegex(headers.get("X-Correlation-Id", ""), r"^corr_[A-Za-z0-9]+$")
