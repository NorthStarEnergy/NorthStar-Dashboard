"""Tests for the read-only Packet 27 release gate."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

import scripts.release_preflight as preflight


class ReleasePreflightTests(unittest.TestCase):
    def test_clean_checkout_passes_when_git_is_clean(self) -> None:
        with mock.patch.object(preflight, "git", return_value=""):
            result = preflight.run()[0]
        self.assertTrue(result[1])

    def test_dirty_checkout_fails(self) -> None:
        with mock.patch.object(preflight, "git", return_value=" M ieso_backend.py"):
            result = preflight.run()[0]
        self.assertFalse(result[1])

    def test_required_packet_files_are_checked(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "start-northstar.ps1").write_text(
                "if (-not $env:NORTHSTAR_OPERATOR_GATE) { $env:NORTHSTAR_OPERATOR_GATE = 'access' }",
                encoding="utf-8",
            )
            (root / "ieso_backend.py").write_text("127.0.0.1 CHECKIN_ORIGIN", encoding="utf-8")
            (root / ".gitignore").write_text("data/\n", encoding="utf-8")
            (root / "tests").mkdir()
            (root / "tests" / "test_correlation_ids.py").write_text("", encoding="utf-8")
            (root / "tests" / "test_api_workflows.py").write_text("", encoding="utf-8")
            (root / "northstar_events.py").write_text("", encoding="utf-8")
            with mock.patch.object(preflight, "ROOT", root), mock.patch.object(preflight, "git", return_value="head"):
                result = preflight.run()[-1]
        self.assertTrue(result[1])


if __name__ == "__main__":
    unittest.main()
