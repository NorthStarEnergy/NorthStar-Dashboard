# Packet 26 — controlled engineering bundles and server revisions

Date: 2026-08-26  
Tag: `packet-26-controlled-engineering-bundles`

## Delivered

- Added `GET /api/switching/drafts/{id}/bundle`, an operator-gated ZIP containing `package.json`, `review-evidence.json`, `bundle-manifest.json`, and the exact stored diagram/procedure bytes.
- The manifest records each source path, type, byte count, attachment ID, and SHA-256. The HTTP response also carries a SHA-256 for the complete ZIP.
- Bundle generation is capped at 100 MB of source bytes and records an append-only `controlled-bundle-exported` audit event.
- Added `POST /api/switching/drafts/{id}/clone` with optimistic version checking. It creates a version-1 DRAFT, copies stored source bytes under new attachment IDs, preserves work rows and source identity, and clears diagram revision, qualification evidence, reviewer identity/comments, and every review check.
- Reviewed-package editing controls are disabled in the dashboard. Operators can download the controlled bundle or start a safe server revision directly from Package Control.
- Local recovery export remains available but explicitly directs operators to the controlled bundle when source bytes/evidence are required.

## Safety boundary

The ZIP is evidence, not an authorization. Cloning never carries approval evidence into the new draft. The terminal workflow remains `REVIEW RECORDED - NOT RELEASE`; no equipment command or operational release endpoint was added.

## Verification

- Python compilation and JavaScript syntax checks passed.
- Focused switching, engineering UI, authentication, and hostname-containment suite: 49 passed.
- Full regression suite: 153 passed.
- Existing operator and public-host containment rules cover both bundle download and revision creation.
