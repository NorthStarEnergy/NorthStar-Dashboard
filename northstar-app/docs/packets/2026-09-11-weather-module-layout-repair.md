# Weather module layout repair — 2026-09-11

- Removed the late `weather-periods-inline-v038` override that forced every Overview weather card to 620px wide and kept all period panels visible.
- Restored the established compact weather-strip layout and on-demand forecast expansion.
- Verification: live HTML returned HTTP 200 without the broken override; 209 tests passed.
