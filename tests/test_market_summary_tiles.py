import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class MarketSummaryTileTests(unittest.TestCase):
    def test_ieso_uses_the_apiroq_row_contract(self):
        script = (ROOT / "market-workspace.js").read_text(encoding="utf-8")
        self.assertIn("moveCompactPrimaryMarketTiles", script)
        self.assertIn('tile.className = \'node-card featured ieso-tile\'', script)
        self.assertIn("REAL-TIME DEMAND", script)
        self.assertIn("DAY-AHEAD DEMAND", script)

    def test_primary_tiles_use_the_compact_width(self):
        script = (ROOT / "market-workspace.js").read_text(encoding="utf-8")
        self.assertIn("flex:0 0 240px!important", script)
        self.assertIn("height:148px!important", script)
        self.assertIn("grid-template-rows:9px 18px!important", script)


if __name__ == "__main__":
    unittest.main()
