"""Regression contract for the browser, desktop, and operator mobile surfaces."""

from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


class MultiSurfaceSyncContractTest(unittest.TestCase):
    def test_desktop_and_mobile_land_on_the_same_operator_surface(self) -> None:
        desktop = (ROOT / "desktop" / "main.cjs").read_text(encoding="utf-8")
        mobile_page = (ROOT / "operator-mobile.html").read_text(encoding="utf-8")
        manifest = (ROOT / "operator-mobile.webmanifest").read_text(encoding="utf-8")

        self.assertIn('const LIVE_ORIGIN = "https://ops.northstarenergy.ca"', desktop)
        self.assertIn('const LIVE_URL = `${LIVE_ORIGIN}/northstar-clean.html`', desktop)
        self.assertIn('href="/northstar-clean.html"', mobile_page)
        self.assertRegex(mobile_page, r'src="/operator-mobile\.js(?:\?[^"]+)?"')
        self.assertRegex(manifest, r'"start_url"\s*:\s*"/operator-mobile\.html"')

    def test_mobile_reads_the_console_feeds_live_without_a_cache(self) -> None:
        mobile = (ROOT / "operator-mobile.js").read_text(encoding="utf-8")
        dashboard = (ROOT / "northstar-clean.html").read_text(encoding="utf-8")
        service_worker = (ROOT / "operator-mobile-sw.js").read_text(encoding="utf-8")

        for endpoint in ("/api/checkins", "/api/alerts", "/api/outages"):
            with self.subTest(endpoint=endpoint):
                self.assertIn(f"path: '{endpoint}'", mobile)
                self.assertIn(endpoint, dashboard)

        self.assertIn("cache: 'no-store'", mobile)
        self.assertIn("visibilitychange", mobile)
        self.assertIn("setInterval", mobile)
        self.assertNotRegex(service_worker, r"addEventListener\(\s*['\"]fetch")


if __name__ == "__main__":
    unittest.main()
