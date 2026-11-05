import importlib
import os
import tempfile
import unittest
from pathlib import Path


class AIHistoryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        os.environ["NORTHSTAR_DB"] = str(Path(self.directory.name) / "ai-history.db")
        import northstar_store
        import northstar_ai_history

        self.store = importlib.reload(northstar_store)
        self.history = importlib.reload(northstar_ai_history)
        self.store.init_db()

    def tearDown(self):
        self.directory.cleanup()
        os.environ.pop("NORTHSTAR_DB", None)

    def test_workspace_is_account_scoped(self):
        project = self.history.create_project("alice@example.test", "Relay review")
        chat = self.history.create_conversation(
            "alice@example.test", title="New chat", project_id=project["id"], scope="events"
        )
        self.history.append_message("alice@example.test", chat["id"], "user", "What changed?")
        self.history.append_message("alice@example.test", chat["id"], "assistant", "A cited summary.")

        alice = self.history.list_workspace("alice@example.test")
        bob = self.history.list_workspace("bob@example.test")
        loaded = self.history.get_conversation("alice@example.test", chat["id"])

        self.assertEqual(len(alice["projects"]), 1)
        self.assertEqual(len(alice["conversations"]), 1)
        self.assertEqual(alice["conversations"][0]["title"], "What changed")
        self.assertEqual(len(loaded["messages"]), 2)
        self.assertEqual(bob["projects"], [])
        self.assertEqual(bob["conversations"], [])

    def test_duplicate_project_names_are_rejected_per_account(self):
        self.history.create_project("alice", "Operations")
        with self.assertRaises(self.history.AIHistoryError):
            self.history.create_project("alice", "Operations")
        self.assertEqual(self.history.create_project("bob", "Operations")["name"], "Operations")

    def test_topic_titles_and_legacy_upgrade_preserve_messages_and_custom_names(self):
        prompt = "check the SOPs for info about starting and stopping units with bearing restrictions"
        chat = self.history.create_conversation("alice")
        self.history.append_message("alice", chat["id"], "user", prompt)
        self.assertEqual(self.history.get_conversation("alice", chat["id"])["title"],
                         "SOPs: unit start/stop with bearing restrictions")
        with self.store._session() as connection:
            connection.execute("UPDATE ai_conversations SET title=? WHERE conversation_id=?",
                               (prompt, chat["id"]))
        custom = self.history.create_conversation("alice", title="My bearing review")
        self.history.append_message("alice", custom["id"], "user", prompt)
        workspace = self.history.list_workspace("alice")
        titles = {item["id"]: item["title"] for item in workspace["conversations"]}
        self.assertEqual(titles[chat["id"]], "SOPs: unit start/stop with bearing restrictions")
        self.assertEqual(titles[custom["id"]], "My bearing review")
        self.assertEqual(self.history.get_conversation("alice", chat["id"])["messages"][0]["content"], prompt)
        self.assertEqual(self.history._summary_title("Can you please list all the stations"), "Stations")

    def test_conversation_can_be_archived_and_restored(self):
        chat = self.history.create_conversation("alice@example.test", title="Relay status")
        self.assertFalse(chat["archived"])
        archived = self.history.set_conversation_archived("alice@example.test", chat["id"], True)
        self.assertTrue(archived["archived"])
        self.assertTrue(self.history.list_workspace("alice@example.test")["conversations"][0]["archived"])
        restored = self.history.set_conversation_archived("alice@example.test", chat["id"], False)
        self.assertFalse(restored["archived"])

    def test_relevant_history_includes_older_topic_without_crossing_accounts(self):
        chat = self.history.create_conversation("alice", title="Operations")
        self.history.append_message("alice", chat["id"], "user", "Island Falls sluice gate inspection was discussed")
        self.history.append_message("alice", chat["id"], "assistant", "A prior, unverified summary")
        for index in range(8):
            self.history.append_message("alice", chat["id"], "user", f"Unrelated market note {index}")
            self.history.append_message("alice", chat["id"], "assistant", f"Market reply {index}")
        relevant = self.history.relevant_history("alice", chat["id"], "What was discussed about Island Falls gates?")
        self.assertIn("Island Falls sluice gate", relevant[0]["content"])
        self.assertLessEqual(len(relevant), 20)
        with self.assertRaises(self.history.AIHistoryError):
            self.history.relevant_history("bob", chat["id"], "Island Falls")

    def test_feedback_is_account_scoped_and_can_be_corrected(self):
        chat = self.history.create_conversation("alice@example.test", title="Market review")
        message = self.history.append_message(
            "alice@example.test", chat["id"], "assistant", "A sourced answer."
        )
        saved = self.history.set_message_feedback(
            "alice@example.test", message["id"], rating="missing_source", correction="Add the IESO source."
        )
        self.assertEqual(saved["rating"], "missing_source")
        self.assertEqual(saved["correction"], "Add the IESO source.")
        updated = self.history.set_message_feedback(
            "alice@example.test", message["id"], rating="helpful"
        )
        self.assertEqual(updated["rating"], "helpful")
        with self.assertRaises(self.history.AIHistoryError):
            self.history.set_message_feedback("bob@example.test", message["id"], rating="helpful")


if __name__ == "__main__":
    unittest.main()
