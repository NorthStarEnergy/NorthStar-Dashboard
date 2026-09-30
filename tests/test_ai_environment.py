"""Request-boundary checks for NorthStar answer context and incomplete responses."""
import json
import unittest
from unittest import mock

import northstar_ai as ai


class AIEnvironmentTest(unittest.TestCase):
    def response(self, payload):
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(payload).encode()
        return response

    def test_query_passes_scoped_environment_and_preserves_evidence(self):
        context = {
            "scope": "dashboard", "siteId": "site:kenora", "referenceMode": True,
            "controlledRetrieval": True,
            "records": [{"excerpt": "Recorded observation", "authorityStatus": "RECORDED_FACT"}],
            "summary": "Duplicated evidence should not be sent twice",
            "citations": [{"id": "record-1", "source": "fixture"}],
        }
        completed = {"status": "completed", "output": [{"content": [
            {"type": "output_text", "text": "Recorded observation [record-1]."}
        ]}]}
        with mock.patch.object(ai, "_build_context", return_value=context), \
             mock.patch.object(ai, "engine_name", return_value="openai"), \
             mock.patch.object(ai, "_openai_api_key", return_value="test-key"), \
             mock.patch.object(ai, "validate_model_settings", return_value=("test-model", "low")), \
             mock.patch.object(ai.urllib.request, "urlopen", return_value=self.response(completed)) as send:
            result = ai.query("Summarize observations", context_scope="dashboard",
                              section="water", site_id="site:kenora", reference_mode=True, persist=False)
        body = json.loads(send.call_args.args[0].data)
        evidence = json.loads(body["input"].split("Retrieved records:\n", 1)[1])
        self.assertEqual(evidence["environment"]["section"], "water")
        self.assertEqual(evidence["environment"]["timezone"], "America/Toronto")
        self.assertTrue(evidence["environment"]["requestedAt"])
        self.assertEqual(evidence["siteId"], "site:kenora")
        self.assertTrue(evidence["referenceMode"])
        self.assertEqual(evidence["records"], context["records"])
        self.assertEqual(evidence["citations"], context["citations"])
        self.assertIsNone(evidence["summary"])
        self.assertEqual(result["answer"], "Recorded observation [record-1].")
        self.assertEqual(result["prompt_version"], ai.guidance.PROMPT_VERSION)
        self.assertEqual(body["max_output_tokens"], 2800)
        self.assertFalse(body["store"])
        self.assertNotIn("tools", body)
        self.assertNotIn("tool_choice", body)

    def test_general_research_includes_recent_history_and_web_search(self):
        completed = {"status": "completed", "output": [{"content": [
            {"type": "output_text", "text": "Current public context."}
        ]}]}
        history = [
            {"role": "user", "content": "Tell me about Ontario demand."},
            {"role": "assistant", "content": "Which interval?"},
        ]
        with mock.patch.object(ai, "_openai_api_key", return_value="test-key"), \
             mock.patch.object(ai, "validate_model_settings", return_value=("test-model", "low")), \
             mock.patch.object(ai.urllib.request, "urlopen", return_value=self.response(completed)) as send:
            ai._run_openai_engine(
                "The latest interval",
                {"scope": "general", "controlledRetrieval": False},
                conversation_history=history,
            )
        body = json.loads(send.call_args.args[0].data)
        self.assertEqual(body["tools"], [{"type": "web_search", "search_context_size": "medium"}])
        self.assertEqual(body["tool_choice"], "auto")
        self.assertIn("Tell me about Ontario demand.", body["input"])
        self.assertIn("Current question: The latest interval", body["input"])

    def test_web_search_citations_are_returned_as_clickable_sources(self):
        completed = {"status": "completed", "output": [{"content": [{
            "type": "output_text",
            "text": "Public background with a cited source.",
            "annotations": [{
                "type": "url_citation",
                "url": "https://example.com/reference",
                "title": "Public reference",
                "start_index": 0,
                "end_index": 17,
            }],
        }]}]}
        with mock.patch.object(ai, "_openai_api_key", return_value="test-key"), \
             mock.patch.object(ai, "validate_model_settings", return_value=("test-model", "low")), \
             mock.patch.object(ai.urllib.request, "urlopen", return_value=self.response(completed)):
            answer, citations = ai._run_openai_engine("Research this", {"scope": "general"})
        self.assertEqual(answer, "Public background with a cited source.")
        self.assertEqual(citations[0]["href"], "https://example.com/reference")
        self.assertEqual(citations[0]["source_kind"], "web")

    def test_partial_model_output_is_not_returned_as_a_complete_answer(self):
        incomplete = {"status": "incomplete", "output": [{"content": [
            {"type": "output_text", "text": "Unsupported partial conclusion"}
        ]}]}
        with mock.patch.object(ai, "_openai_api_key", return_value="test-key"), \
             mock.patch.object(ai, "validate_model_settings", return_value=("test-model", "low")), \
             mock.patch.object(ai.urllib.request, "urlopen", return_value=self.response(incomplete)):
            with self.assertRaisesRegex(ai.AssistantUnavailable, "cut short"):
                ai._run_openai_engine("Summarize", {})
