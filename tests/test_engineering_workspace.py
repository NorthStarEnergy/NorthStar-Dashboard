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

    def test_uwpc_is_one_module_with_inbox_and_preserved_legacy_tools(self):
        html = (ROOT / "northstar-clean.html").read_text(encoding="utf-8")
        desk = (ROOT / "uwpc-desk.js").read_text(encoding="utf-8")
        modules = (ROOT / "module-workspace.js").read_text(encoding="utf-8")
        self.assertIn("uwpc-desk.js", html)
        self.assertIn("uwpc-desk.css", html)
        self.assertIn("register('outages:uwpc', 'UWPC'", modules)
        for element in ("uwpcOperatorInbox", "uwpcActivePlans", "uwpcPastPlans", "uwpcAuthorityRecords", "uwpcLegacyTools"):
            self.assertIn(element, desk)
        self.assertIn("Send to operator inbox", desk)
        self.assertIn("Sign off as", desk)
        self.assertIn('id="wpTemplateGallery"', html)
        self.assertIn('id="wpLibraryList"', html)

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
