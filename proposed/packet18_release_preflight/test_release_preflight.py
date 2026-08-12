"""Hand-traced tests for release_preflight.py — written 2026-08-12, NOT executed.

No sandbox with a Python interpreter was available this session. Each test below was
traced by hand against the implementation in release_preflight.py, reading both side
by side, rather than run. Run for real with:

    python -m unittest proposed.packet18_release_preflight.test_release_preflight -v

before trusting these as a substitute for actual execution.
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import release_preflight as rp  # noqa: E402


class CheckOperatorGateDefaultTests(unittest.TestCase):
    def test_passes_when_launcher_forces_access_default(self) -> None:
        # Traced: writes a minimal launcher containing exactly the pattern
        # release_preflight.py's regex expects, confirms check_operator_gate_default
        # returns passed=True. Mirrors the real line 114 of start-northstar.ps1,
        # confirmed present in the live file by direct read this session.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "start-northstar.ps1").write_text(
                "if (-not $env:NORTHSTAR_OPERATOR_GATE) { $env:NORTHSTAR_OPERATOR_GATE = 'access' }\n",
                encoding="utf-8",
            )
            with mock.patch.object(rp, "ROOT", root):
                result = rp.check_operator_gate_default()
            self.assertTrue(result.passed)

    def test_fails_when_launcher_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with mock.patch.object(rp, "ROOT", root):
                result = rp.check_operator_gate_default()
            self.assertFalse(result.passed)
            self.assertIn("not found", result.detail)

    def test_fails_when_default_forcing_line_absent(self) -> None:
        # A launcher that mentions the variable but never forces it to 'access'
        # (e.g. someone rewrote the guard to default to 'off') must fail, not
        # false-pass on a bare substring match.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "start-northstar.ps1").write_text(
                "# NORTHSTAR_OPERATOR_GATE is documented elsewhere\n",
                encoding="utf-8",
            )
            with mock.patch.object(rp, "ROOT", root):
                result = rp.check_operator_gate_default()
            self.assertFalse(result.passed)


class CheckDataGitignoredTests(unittest.TestCase):
    def test_passes_when_data_slash_present_verbatim(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".gitignore").write_text("node_modules/\ndata/\ndist/\n", encoding="utf-8")
            with mock.patch.object(rp, "ROOT", root):
                result = rp.check_data_gitignored()
            self.assertTrue(result.passed)

    def test_fails_when_entry_reworded(self) -> None:
        # e.g. "data/**" or "/data/" would silently change semantics; the exact-match
        # check is deliberately strict and should fail rather than guess.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".gitignore").write_text("data/**\n", encoding="utf-8")
            with mock.patch.object(rp, "ROOT", root):
                result = rp.check_data_gitignored()
            self.assertFalse(result.passed)


class CheckRegressionTestsPresentTests(unittest.TestCase):
    REQUIRED = [
        "test_operator_gate_covers_help_subroutes_but_not_the_workers_alarm",
        "test_static_tree_does_not_serve_secrets_or_the_database",
        "test_forged_access_header_cannot_open_the_roster_on_the_public_host",
        "test_forged_access_header_cannot_clear_a_distress_call",
    ]

    def test_passes_when_all_four_present(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            tests_dir = root / "tests"
            tests_dir.mkdir()
            body = "\n".join(f"    def {name}(self) -> None:\n        pass\n" for name in self.REQUIRED)
            (tests_dir / "test_api_workflows.py").write_text(
                f"class APITest:\n{body}", encoding="utf-8",
            )
            with mock.patch.object(rp, "ROOT", root):
                result = rp.check_regression_tests_present()
            self.assertTrue(result.passed)

    def test_fails_and_names_missing_test_when_one_is_absent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            tests_dir = root / "tests"
            tests_dir.mkdir()
            present = self.REQUIRED[:3]
            body = "\n".join(f"    def {name}(self) -> None:\n        pass\n" for name in present)
            (tests_dir / "test_api_workflows.py").write_text(
                f"class APITest:\n{body}", encoding="utf-8",
            )
            with mock.patch.object(rp, "ROOT", root):
                result = rp.check_regression_tests_present()
            self.assertFalse(result.passed)
            self.assertIn(self.REQUIRED[3], result.detail)


class CheckReleaseShaTests(unittest.TestCase):
    def test_skips_cleanly_when_env_var_unset(self) -> None:
        with mock.patch.object(rp, "_git", return_value="abc123"):
            result = rp.check_release_sha(None)
        self.assertTrue(result.passed)
        self.assertIn("skipped", result.detail)

    def test_passes_when_sha_matches_head(self) -> None:
        with mock.patch.object(rp, "_git", return_value="abc123"):
            result = rp.check_release_sha("abc123")
        self.assertTrue(result.passed)

    def test_fails_when_sha_does_not_match_head(self) -> None:
        with mock.patch.object(rp, "_git", return_value="abc123"):
            result = rp.check_release_sha("deadbeef")
        self.assertFalse(result.passed)
        self.assertIn("deadbeef", result.detail)
        self.assertIn("abc123", result.detail)


class MainExitCodeTests(unittest.TestCase):
    def test_exit_zero_when_every_check_passes(self) -> None:
        passing = [rp.CheckResult("x", True, "ok")]
        with mock.patch.object(rp, "run_all", return_value=passing):
            code = rp.main([])
        self.assertEqual(code, 0)

    def test_exit_one_when_any_check_fails(self) -> None:
        mixed = [rp.CheckResult("x", True, "ok"), rp.CheckResult("y", False, "bad")]
        with mock.patch.object(rp, "run_all", return_value=mixed):
            code = rp.main([])
        self.assertEqual(code, 1)


if __name__ == "__main__":
    unittest.main()
