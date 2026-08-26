# Packet 25 — durable engineering packages and schematic revisions

**Date:** 2026-08-26  
**Live target:** `https://ops.northstarenergy.ca/`  
**Tag:** `packet-25-engineering-persistence`

## Delivered

- Switching diagram and governing-procedure bytes are now stored in operator-gated SQLite BLOB records, so normal NorthStar database backups contain the complete source package.
- Uploads are capped at 25 MB each and checked by allowlisted extension, content type, file signature/parseability, SHA-256 digest, and authenticated operator route.
- Stored sources can be opened from another signed-in browser and removed only while the package remains editable. Reviewed packages remain immutable.
- Switching packages can link to a real outage ID. Every open outage exposes a **Create Plan** action that prefills site, asset, package name, scope, and outage reference.
- The Engineering workspace has a searchable server package library with status filtering and cross-browser reopen.
- One-line drawings now have server records with append-only revisions, optimistic concurrency, history hashes, optional outage linkage, and utility symbol-profile approval references.
- A current server schematic can be attached directly to a switching package. Ready-for-review refuses a missing/stale schematic revision or a missing/mismatched approval reference.
- One-line exports now include JSON, SVG, PNG, and print/PDF in addition to the existing local revision.
- The existing `DRAFT → READY FOR QUALIFIED REVIEW → REVIEW RECORDED · NOT RELEASE` boundary remains unchanged. No equipment command or operational release route was added.

## Data model

- `switching_attachments` stores protected source bytes plus filename, type, size, SHA-256, uploader, and upload time.
- `one_line_documents` stores current server drawing state and linkage metadata.
- `one_line_revisions` stores every server revision with its digest, actor, and timestamp.
- `switching_drafts.outage_id` and `switching_drafts.schematic_id` support indexed linkage and discovery.

## Verification

- Python compilation passed for the store and HTTP server.
- JavaScript syntax passed for the switching, outage, and one-line editor modules.
- Focused switching, schematic, engineering, authentication, and hostname-containment tests: **53 passed**.
- Full regression suite: **151 passed**, including an existing-database migration regression.

## Deliberate boundary still open

Operational switching release remains blocked on the owner/IT identity decision in Migration Stage 3. The shared demo operator is not a qualified-person identity system, and this packet does not pretend otherwise. A future release workflow requires verified individual identities, roles/grants, Access JWT verification, utility terminology, and formal safety approval.
