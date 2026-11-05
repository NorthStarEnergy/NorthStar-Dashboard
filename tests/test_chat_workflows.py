"""Overview live chat: rooms, source tags, Teams bridge fail-closed behaviour."""

from __future__ import annotations

import importlib
import json
import os
import sys
import tempfile
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from threading import Thread

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


class ChatWorkflowTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        os.environ["NORTHSTAR_DB"] = str(Path(self.directory.name) / "chat.db")
        os.environ["NORTHSTAR_TEAMS_MODE"] = "off"
        os.environ.pop("NORTHSTAR_TEAMS_WEBHOOK_URL", None)
        os.environ.pop("NORTHSTAR_TEAMS_PULL_URL", None)

        import northstar_store

        self.store = importlib.reload(northstar_store)
        self.store.init_db()
        import northstar_chat

        self.chat = importlib.reload(northstar_chat)

    def tearDown(self) -> None:
        for key in (
            "NORTHSTAR_DB",
            "NORTHSTAR_TEAMS_MODE",
            "NORTHSTAR_TEAMS_WEBHOOK_URL",
            "NORTHSTAR_TEAMS_PULL_URL",
        ):
            os.environ.pop(key, None)
        self.directory.cleanup()

    def test_rooms_are_fixed_and_operations_is_not_duplicated(self) -> None:
        rooms = self.chat.list_rooms()
        ids = [room["id"] for room in rooms]
        self.assertEqual(ids, ["general", "operations", "field", "contractors", "management"])
        self.assertEqual(len(ids), len(set(ids)))

    def test_posted_messages_are_tagged_northstar(self) -> None:
        message = self.chat.post_message("operations", "Breaker A open for inspection", author="ron")
        self.assertEqual(message["source"], "northstar")
        self.assertEqual(message["roomId"], "operations")
        self.assertEqual(message["author"], "ron")
        listed = self.chat.list_messages("operations")
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["id"], message["id"])

    def test_unknown_room_is_rejected(self) -> None:
        with self.assertRaises(self.chat.ChatError):
            self.chat.post_message("executive", "nope", author="ron")

    def test_teams_pull_never_invents_messages_when_disabled(self) -> None:
        result = self.chat.pull_teams_messages(actor="ron")
        self.assertEqual(result["pulled"], 0)
        self.assertEqual(result["status"], "disabled")
        self.assertEqual(result["messages"], [])

    def test_teams_shadow_post_records_bridge_without_external_call(self) -> None:
        os.environ["NORTHSTAR_TEAMS_MODE"] = "shadow"
        importlib.reload(self.chat)
        message = self.chat.post_message(
            "general",
            "Shift handover note",
            author="ron",
            post_to_teams=True,
        )
        self.assertEqual(message["source"], "northstar")
        self.assertEqual(message["meta"]["teamsBridge"]["status"], "shadow")
        self.assertIsNone(message["teamsPostId"])

    def test_live_pull_imports_teams_messages_with_source_tag(self) -> None:
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self_inner) -> None:  # noqa: N805
                body = json.dumps({
                    "messages": [
                        {
                            "id": "teams-ext-1",
                            "roomId": "field",
                            "author": "Alex M.",
                            "body": "Arrived at Kenora gate",
                        }
                    ]
                }).encode("utf-8")
                self_inner.send_response(200)
                self_inner.send_header("Content-Type", "application/json")
                self_inner.send_header("Content-Length", str(len(body)))
                self_inner.end_headers()
                self_inner.wfile.write(body)

            def log_message(self_inner, *_args) -> None:  # noqa: N805
                return

        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            os.environ["NORTHSTAR_TEAMS_MODE"] = "live"
            os.environ["NORTHSTAR_TEAMS_PULL_URL"] = (
                f"http://127.0.0.1:{server.server_address[1]}/pull"
            )
            importlib.reload(self.chat)
            result = self.chat.pull_teams_messages(actor="ron")
            self.assertEqual(result["status"], "ok")
            self.assertEqual(result["pulled"], 1)
            messages = self.chat.list_messages("field")
            self.assertEqual(len(messages), 1)
            self.assertEqual(messages[0]["source"], "teams")
            self.assertEqual(messages[0]["author"], "Alex M.")
            self.assertEqual(messages[0]["teamsPostId"], "teams-ext-1")
            # Dedup on second pull.
            again = self.chat.pull_teams_messages(actor="ron")
            self.assertEqual(again["pulled"], 0)
        finally:
            server.shutdown()


class ChatHTTPTest(unittest.TestCase):
    def setUp(self) -> None:
        from test_api_workflows import APITest

        self._api_test_base = APITest
        APITest.setUp(self)
        os.environ["NORTHSTAR_TEAMS_MODE"] = "off"
        import northstar_chat

        importlib.reload(northstar_chat)

    def tearDown(self) -> None:
        os.environ.pop("NORTHSTAR_TEAMS_MODE", None)
        self._api_test_base.tearDown(self)

    def request(self, *args, **kwargs):
        return self._api_test_base.request(self, *args, **kwargs)

    def test_chat_routes_require_operator_gate(self) -> None:
        self.backend.OPERATOR_GATE = "access"
        for method, path, payload in (
            ("GET", "/api/chat/rooms", None),
            ("GET", "/api/chat/status", None),
            ("GET", "/api/chat/messages?room=general", None),
            ("POST", "/api/chat/messages", {"room": "general", "body": "hello"}),
            ("POST", "/api/chat/teams/pull", {}),
        ):
            with self.subTest(path=path):
                status, body, _ = self.request(method, path, payload)
                self.assertEqual(status, 403)
                self.assertEqual(body["error"], "operator authentication required")

    def test_operator_can_post_and_list_messages_when_gate_is_off(self) -> None:
        status, created, _ = self.request(
            "POST",
            "/api/chat/messages",
            {"room": "contractors", "body": "Escort required at south gate"},
        )
        self.assertEqual(status, 201)
        self.assertEqual(created["source"], "northstar")
        self.assertEqual(created["roomId"], "contractors")

        status, listed, _ = self.request("GET", "/api/chat/messages?room=contractors")
        self.assertEqual(status, 200)
        self.assertEqual(len(listed["messages"]), 1)
        self.assertEqual(listed["messages"][0]["id"], created["id"])

        status, rooms, _ = self.request("GET", "/api/chat/rooms")
        self.assertEqual(status, 200)
        self.assertEqual(len(rooms["rooms"]), 5)
