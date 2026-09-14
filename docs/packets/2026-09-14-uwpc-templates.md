# NorthStar UWPC form templates — 2026-09-14

Engineering now has a NorthStar-owned draft sheet for each UWPC form and permit type.

## Available behavior

- `northstar_uwpc_templates.py` holds 15 control-room sheets: PC10A, PC17B, PC2, the three supporting guarantees, PC4, Hold-off, Caution, Terminal Point, plus PC1, PC3, PC14, PC15, and PC17A.
- Each sheet cites the 2024 section/article only. It does not copy Hydro One artwork, rule text, or glossary definitions.
- `GET /api/uwpc` includes the template index. Applying a standalone sheet stores `workProtectionTemplateId` and, when needed, the matching instrument. Companion sheets (PC1, PC3, PC14, PC15, PC17A) do not pretend to be a Work Permit.
- The Engineering gallery opens the selected sheet. Opening another sheet does not overwrite filled review answers. **SEED REVIEW PROMPTS** fills the draft form's first column only. The second column stays empty so a placeholder cannot pass the ready gate.
- The Outages UWPC tab lists the same sheets. This remains DRAFT → READY FOR QUALIFIED REVIEW → REVIEW RECORDED - NOT RELEASE.

## Inputs

No new feeds. The licensed 2024 book stays out of git.

## Validation

`243 passed, 208 subtests passed`. Coverage includes the 15-sheet index, unknown-template rejection, standalone instrument binding, companion sheets that do not become instruments, and empty seeded answers.

## Activation required

Restart the backend for the template payload. Static assets are `switching-workspace.js?v=20260914-4`, `switching-workspace.css?v=20260914-6`, and `outages-workspace.js?v=8`.
