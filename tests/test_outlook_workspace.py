"""Outlook workspace status remains nested and fail-closed."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import northstar_microsoft as microsoft


class OutlookWorkspaceStatusTest(unittest.TestCase):
    def setUp(self) -> None:
        self.previous_mode = os.environ.pop("NORTHSTAR_OUTLOOK_MODE", None)

    def tearDown(self) -> None:
        if self.previous_mode is None:
            os.environ.pop("NORTHSTAR_OUTLOOK_MODE", None)
        else:
            os.environ["NORTHSTAR_OUTLOOK_MODE"] = self.previous_mode

    def test_status_never_claims_a_mailbox_connection(self) -> None:
        self.assertEqual(microsoft.outlook_status()["state"], "not_configured")
        for mode, expected in (("shadow", "draft_only"), ("live", "awaiting_authorization")):
            with self.subTest(mode=mode):
                os.environ["NORTHSTAR_OUTLOOK_MODE"] = mode
                status = microsoft.outlook_status()
                self.assertEqual(status["state"], expected)
                self.assertFalse(status["connected"])
                self.assertFalse(status["canSync"])

    def test_dashboard_loads_the_nested_workspace_and_operator_status_route(self) -> None:
        root = Path(__file__).resolve().parent.parent
        html = (root / "northstar-clean.html").read_text(encoding="utf-8")
        script = (root / "outlook-workspace.js").read_text(encoding="utf-8")
        css = (root / "outlook-workspace.css").read_text(encoding="utf-8")
        modules = (root / "module-workspace.js").read_text(encoding="utf-8")
        backend = (root / "ieso_backend.py").read_text(encoding="utf-8")

        self.assertIn("outlook-workspace.css?v=20260922-1", html)
        self.assertIn("outlook-workspace.js?v=20260922-1", html)
        self.assertIn('id = \'outlookWorkspace\'', script)
        self.assertIn("tools.querySelector(':scope > .panel') || tools", script)
        self.assertIn("NorthstarModules?.open('tools:outlook-workspace')", script)
        self.assertIn("/api/microsoft/outlook/status", script)
        self.assertIn("mailto:", script)
        self.assertIn("outlook-workspace", css)
        self.assertIn("#outlookWorkspace", modules)
        self.assertIn('"/api/microsoft/outlook/status": ("GET",)', backend)


if __name__ == "__main__":
    unittest.main()
