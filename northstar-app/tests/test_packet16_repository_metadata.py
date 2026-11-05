"""Packet 16 non-production repository/retention metadata fixture tests."""

from __future__ import annotations

import importlib
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path


class Packet16RepositoryMetadataTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        os.environ["NORTHSTAR_DB"] = str(Path(self.directory.name) / "packet16.db")
        import northstar_store

        self.store = importlib.reload(northstar_store)
        self.store.init_db()

    def tearDown(self) -> None:
        os.environ.pop("NORTHSTAR_DB", None)
        self.directory.cleanup()

    def test_packet16_tables_are_reference_only_and_policy_revision_is_required(self) -> None:
        connection = sqlite3.connect(self.store.DB_PATH)
        try:
            connection.execute(
                "INSERT INTO repository_policies "
                "(repository_id, repository_name, policy_id, policy_revision, data_owner, created_at) "
                "VALUES (?, ?, ?, ?, ?, datetime('now'))",
                ("TEST-REPO-01", "NorthStar Test Repository", "TEST-RETENTION-01", "REV-1", "Test Data Owner"),
            )
            connection.executemany(
                "INSERT INTO artifact_repository_refs "
                "(artifact_class, repository_id, object_prefix, object_revision, owner, access_rule, retention_rule) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                [
                    (kind, "TEST-REPO-01", f"test/{kind}", "OBJ-REV-1", "Test Data Owner", "test operators", "indefinite-test-retention")
                    for kind in ("diagram", "governing-procedure", "review-package", "qualification-evidence", "audit-event")
                ],
            )
            with self.assertRaises(sqlite3.IntegrityError):
                connection.execute(
                    "INSERT INTO repository_policies "
                    "(repository_id, repository_name, policy_id, policy_revision, data_owner, created_at) "
                    "VALUES (?, ?, ?, ?, ?, datetime('now'))",
                    ("TEST-REPO-02", "Invalid Test Repository", "TEST-RETENTION-02", "", "Test Data Owner"),
                )
            row = connection.execute(
                "SELECT retention_days, environment FROM repository_policies WHERE repository_id=?",
                ("TEST-REPO-01",),
            ).fetchone()
            self.assertEqual(row, (None, "TEST_ONLY"))
            self.assertEqual(
                connection.execute("SELECT COUNT(*) FROM artifact_repository_refs").fetchone()[0],
                5,
            )
        finally:
            connection.close()


if __name__ == "__main__":
    unittest.main()
