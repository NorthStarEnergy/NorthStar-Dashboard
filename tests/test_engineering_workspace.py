import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class EngineeringWorkspaceTests(unittest.TestCase):
    def test_engineering_remains_a_dedicated_dashboard_section(self):
        html = (ROOT / "northstar-clean.html").read_text(encoding="utf-8")
        self.assertIn('<section id="switching" class="section">', html)

        outages = (ROOT / "outages-workspace.js").read_text(encoding="utf-8")
        self.assertNotIn("switchingPane.append(switching)", outages)
        self.assertNotIn("document.querySelector('[data-tab=\"outages\"]')?.click()", outages)

    def test_engineering_has_workspace_navigation_and_outage_cross_link(self):
        switching = (ROOT / "switching-workspace.js").read_text(encoding="utf-8")
        outages = (ROOT / "outages-workspace.js").read_text(encoding="utf-8")
        self.assertIn("engineering-hub", switching)
        self.assertIn("Engineering Drawings & Work Protection", switching)
        self.assertIn("/api/uwpc", switching)
        self.assertIn("UWPC 2024", switching)
        self.assertIn("data-open-engineering", outages)
        html = (ROOT / "northstar-clean.html").read_text(encoding="utf-8")
        self.assertIn('id="uwpcInstrumentList"', html)
        self.assertIn('<select id="wpSite">', html)
        self.assertIn("outages-workspace.js?v=7", html)

    def test_outages_can_prefill_a_server_backed_switching_package(self):
        html = (ROOT / "northstar-clean.html").read_text(encoding="utf-8")
        switching = (ROOT / "switching-workspace.js").read_text(encoding="utf-8")
        outages = (ROOT / "outages-workspace.js").read_text(encoding="utf-8")
        self.assertIn('id="wpLibraryList"', html)
        self.assertIn('id="wpOutageId"', html)
        self.assertIn('id="wpSchematicId"', html)
        self.assertIn("loadDraftLibrary", switching)
        self.assertIn("attachSchematic", switching)
        self.assertIn("data-create-switching", outages)

    def test_reviewed_packages_have_controlled_export_and_revision_actions(self):
        html = (ROOT / "northstar-clean.html").read_text(encoding="utf-8")
        switching = (ROOT / "switching-workspace.js").read_text(encoding="utf-8")
        self.assertIn('id="wpDownloadBundle"', html)
        self.assertIn('id="wpCloneRevision"', html)
        self.assertIn("downloadControlledBundle", switching)
        self.assertIn("cloneServerRevision", switching)
        self.assertIn("review evidence, and stored sources", switching)


if __name__ == "__main__":
    unittest.main()
