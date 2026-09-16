"""Targeted coverage for persistent, redacted dashboard knowledge retrieval."""
from __future__ import annotations

import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import northstar_knowledge as knowledge


class KnowledgeSearchTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.data = self.root / "data"
        self.data.mkdir()
        self.original = (knowledge.DATA, knowledge.DB, knowledge.INDEX_FILE, knowledge._FILE_CACHE, knowledge._PUBLIC_CACHE)
        knowledge.DATA = self.data
        knowledge.DB = self.data / "northstar.db"
        knowledge.INDEX_FILE = self.data / "knowledge-index.json"
        knowledge._FILE_CACHE = None
        knowledge._PUBLIC_CACHE = None
        procedure = self.data / "relay-protection-procedure.txt"
        procedure.write_text("Relay protection procedure for generator reliability. OPENAI_API_KEY=should-not-appear", encoding="utf-8")
        connection = sqlite3.connect(knowledge.DB)
        try:
            connection.execute("create table shift_notes (summary text, api_token text)")
            connection.execute("insert into shift_notes values (?, ?)", ("Shift handoff: relay check complete", "hidden-value"))
            connection.commit()
        finally:
            connection.close()

    def tearDown(self) -> None:
        knowledge.DATA, knowledge.DB, knowledge.INDEX_FILE, knowledge._FILE_CACHE, knowledge._PUBLIC_CACHE = self.original
        self.directory.cleanup()

    def test_search_expands_relay_terms_and_redacts_secret_values(self) -> None:
        results = knowledge.search("relay standards")
        file_result = next(row for row in results if row["source"].startswith("file:"))
        self.assertIn("Relay protection", file_result["excerpt"])
        self.assertNotIn("should-not-appear", file_result["excerpt"])

    def test_live_database_is_fresh_without_rebuilding_file_index(self) -> None:
        knowledge.search("relay")
        indexed_at = knowledge.INDEX_FILE.stat().st_mtime_ns
        connection = sqlite3.connect(knowledge.DB)
        try:
            connection.execute("insert into shift_notes values (?, ?)", ("New outage handoff note", "hidden-value"))
            connection.commit()
        finally:
            connection.close()
        results = knowledge.search("outage handoff")
        self.assertTrue(any(row["source"].startswith("database:shift_notes") for row in results))
        self.assertEqual(knowledge.INDEX_FILE.stat().st_mtime_ns, indexed_at)

    def test_status_reports_safe_coverage_counts(self) -> None:
        status = knowledge.status()
        self.assertEqual(status["fileRecords"], 1)
        self.assertEqual(status["databaseRecords"], 1)
        self.assertEqual(status["publicSources"], 0)
