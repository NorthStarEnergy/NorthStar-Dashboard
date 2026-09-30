"""AI assistant contract, scope boundaries, and fail-closed behaviour."""

from __future__ import annotations

import importlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


class AIAssistantTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        os.environ["NORTHSTAR_DB"] = str(Path(self.directory.name) / "ai.db")
        os.environ["NORTHSTAR_AI_ENGINE"] = "summary"
        os.environ.pop("NORTHSTAR_AI_RESTRICTED_SCOPES", None)

        import northstar_store

        self.store = importlib.reload(northstar_store)
        self.store.init_db()
        import northstar_ai

        self.ai = importlib.reload(northstar_ai)

        import northstar_events as events

        self.store.add_logbook_entry(
            "Operator action",
            "APIROQ spill gate check",
            "Verified spill gate position after rain event.",
        )
        with self.store._LOCK, self.store._session() as connection:
            events.append_event(
                connection,
                event_type="market.price_alert",
                occurred_at="2026-09-01T10:00:00-04:00",
                actor_id="northstar-monitor",
                aggregate_type="alert",
                aggregate_id="alert_test_1",
                source="northstar-monitor",
                summary="APIROQ high limit reached",
                payload={"node": "APIROQ", "price": 145.2},
                severity="warn",
            )

    def tearDown(self) -> None:
        for key in ("NORTHSTAR_DB", "NORTHSTAR_AI_ENGINE", "NORTHSTAR_AI_RESTRICTED_SCOPES", "NORTHSTAR_AI_COMMAND", "OPENAI_API_KEY", "NORTHSTAR_AI_MODEL"):
            os.environ.pop(key, None)
        self.directory.cleanup()

    def test_summary_engine_returns_cited_events_answer(self) -> None:
        response = self.ai.query(
            "What happened at APIROQ?",
            context_scope="events",
            actor="operator",
            persist=False,
        )
        self.assertIn("APIROQ", response["answer"])
        self.assertTrue(response["citations"])
        self.assertEqual(response["label"], "Retrieved summary")
        self.assertIn(response["uncertainty"], {"high", "medium", "low", "unknown"})

    def test_site_scope_searches_events_and_logbook(self) -> None:
        response = self.ai.query(
            "What happened at APIROQ?",
            context_scope="site",
            actor="operator",
            persist=False,
        )
        self.assertTrue(response["citations"])
        self.assertIn("APIROQ", response["answer"])

    def test_dashboard_scope_cites_database_files_and_engineering_catalogs(self) -> None:
        records = [
            {"source": "database:shift_logs:1", "path": "database/shift_logs/1", "excerpt": "Shift handoff."},
            {"source": "file:data/procedures/relay.pdf", "path": "data/procedures/relay.pdf", "excerpt": "Relay procedure."},
            {"source": "public:nerc-reliability-standards", "path": "https://nerc.example", "excerpt": "NERC catalog."},
        ]
        with mock.patch.object(self.ai.knowledge, "search", return_value=records):
            response = self.ai.query("Find relay procedure", context_scope="dashboard", persist=False)

        self.assertEqual(
            [citation["source_kind"] for citation in response["citations"]],
            ["dashboard-database", "reference-file", "engineering-catalog"],
        )
        self.assertIn("Relay procedure", response["answer"])

    def test_restricted_worker_scope_is_denied_by_default(self) -> None:
        with self.assertRaises(self.ai.ScopeDenied):
            self.ai.query("Who is on site?", context_scope="worker-status", persist=False)

    def test_none_engine_fails_closed(self) -> None:
        os.environ["NORTHSTAR_AI_ENGINE"] = "none"
        importlib.reload(self.ai)
        with self.assertRaises(self.ai.AssistantUnavailable):
            self.ai.query("status?", context_scope="general", persist=False)

    def test_query_is_audited_when_persisted(self) -> None:
        response = self.ai.query("Summarize events", context_scope="events", actor="ron")
        self.assertTrue(response["persisted"])
        events = self.store.list_audit_events(limit=10, event_type="ai.query")
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["actorId"], "ron")

    @mock.patch("northstar_ai.urllib.request.urlopen")
    def test_openai_engine_uses_retrieved_context_only(self, urlopen) -> None:
        os.environ["NORTHSTAR_AI_ENGINE"] = "openai"
        os.environ["OPENAI_API_KEY"] = "test-key"
        os.environ["NORTHSTAR_AI_MODEL"] = "test-model"
        response = mock.MagicMock()
        response.read.return_value = json.dumps({
            "output": [{"content": [{"type": "output_text", "text": "Cited answer [evt_test]."}]}]
        }).encode()
        urlopen.return_value.__enter__.return_value = response

        result = self.ai.query("What happened?", context_scope="events", response_profile="fast", persist=False)

        self.assertEqual(result["answer"], "Cited answer [evt_test].")
        self.assertEqual(result["label"], "Model-assisted synthesis")
        self.assertEqual(result["model_version"], "test-model")
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.openai.com/v1/responses")
        request_body = request.data.decode()
        self.assertNotIn("test-key", request_body)
        self.assertEqual(json.loads(request_body)["max_output_tokens"], 800)
        self.assertEqual(json.loads(request_body)["reasoning"]["effort"], "none")
        self.assertFalse(json.loads(request_body)["store"])


class AIAssistantHTTPTest(unittest.TestCase):
    def setUp(self) -> None:
        from test_api_workflows import APITest

        self._api_test_base = APITest
        APITest.setUp(self)
        os.environ["NORTHSTAR_AI_ENGINE"] = "summary"
        import northstar_ai

        importlib.reload(northstar_ai)

    def tearDown(self) -> None:
        os.environ.pop("NORTHSTAR_AI_ENGINE", None)
        self._api_test_base.tearDown(self)

    def request(self, *args, **kwargs):
        return self._api_test_base.request(self, *args, **kwargs)

    def test_ai_query_requires_operator_gate_when_enabled(self) -> None:
        self.backend.OPERATOR_GATE = "access"
        status, body, _ = self.request(
            "POST",
            "/api/ai/query",
            {"question": "Summarize events", "context_scope": "events"},
        )
        self.assertEqual(status, 403)
        self.assertEqual(body["error"], "operator authentication required")

    def test_ai_query_returns_citations_when_gate_is_off(self) -> None:
        status, body, _ = self.request(
            "POST",
            "/api/ai/query",
            {"question": "Give me an operational snapshot", "context_scope": "general"},
        )
        self.assertEqual(status, 200)
        self.assertIn("answer", body)
        self.assertIn("citations", body)
        self.assertEqual(body["label"], "Retrieved summary")

    def test_legacy_ai_route_accepts_message_field(self) -> None:
        status, body, _ = self.request(
            "POST",
            "/api/ai",
            {"message": "Summarize events", "context_scope": "events"},
        )
        self.assertEqual(status, 200)
        self.assertIn("answer", body)

    def test_ai_status_is_operator_gated(self) -> None:
        self.backend.OPERATOR_GATE = "access"
        status, _, _ = self.request("GET", "/api/ai/status")
        self.assertEqual(status, 403)
