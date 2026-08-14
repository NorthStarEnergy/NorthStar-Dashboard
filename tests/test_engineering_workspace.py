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
        self.assertIn("data-open-engineering", outages)


if __name__ == "__main__":
    unittest.main()
