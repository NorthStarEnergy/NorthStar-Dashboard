# NorthStar operator knowledge library

## Use it

Open **Dashboard AI → Knowledge Library**. Upload PDF, DOCX, XLSX, XLSM, UTF-8 TXT, Markdown or CSV (5 MB maximum). Excel intake indexes cached cell values and never runs workbook macros or recalculates formulas. Use a stable document identity for every revision of the same document and select its plant, or Shared / company for genuinely company-wide material.

Every upload starts **PENDING_REVIEW**. A qualified human opens the original, verifies owner/revision/effective date/review due date, records a review reason, and confirms its controlled status. Only **CURRENT_CONTROLLED** sources whose dates are currently valid support normal AI answers. Promoting a new revision supersedes the previous current revision of the same document identity and plant. A pending source is never silently approved by import or AI.

Choose a plant in Dashboard AI to search that plant plus shared documents. **Current sources and records** is the default. **Reviewed reference only** searches REFERENCE_ONLY documents and labels them as context. LEGACY_REFERENCE, pending, withdrawn and superseded documents never enter either AI search. Existing legacy SOPs remain available as originals for manual inspection; obtain a separately controlled current document rather than promoting a historical SOP.

Click citations to inspect the exact passage, revision, SHA256, review metadata or recorded database evidence. Notes, logbook entries and outages are recorded facts, not current procedures or live telemetry. Equipment actions, switching, permits, guarantees and releases remain with qualified operators.

## Build the library

Start with current dashboard help, reviewed equipment manuals, approved operating procedures, current site limits, and escalation/contact guidance. Keep one document identity per document, one site scope per intake, and a new immutable upload for each content revision. Scanned PDFs need a verified text transcription; the system does not invent OCR text. PDF extraction requires the optional pypdf runtime dependency.

For bulk intake, create a UTF-8 CSV with these columns:

`title,file,siteId,sourceKey,revision,owner`

Files can be absolute paths or paths relative to the CSV. Run `python scripts/knowledge-library.py import --manifest <manifest.csv>`. It validates listed files and imports them as pending; imports can be rerun without duplicating identical content/revisions. It does not scan directories or approve sources. `status` shows coverage; `bootstrap` registers existing legacy metadata without indexing its procedure text.

Suggested source organization: Company / Dashboard help; Company / Escalation; Plants / canonical plant name / Equipment; Plants / canonical plant name / Current procedures; Plants / canonical plant name / Limits. Folder names are organization, not approval authority. The SQLite registry records actual authority status.

## Storage and access

Tables `operator_knowledge_sources`, `operator_knowledge_chunks`, `operator_knowledge_fts`, and `operator_knowledge_reviews` live in the existing NorthStar database. Originals live alongside that database in `controlled-sources/operator-knowledge`. Back up both together using the existing protected operational-data backup process. Do not put the database, source documents or credentials in source control or release packages.

All APIs stay behind the existing operator gate, block the public check-in hostname and site-viewer role, and enforce same-origin writes. Actors come from the server session. Existing operator permissions remain; administrators can narrow AI/library access with server environment variable `NORTHSTAR_AI_SITE_ACCESS`, a JSON mapping from authenticated actor IDs to canonical site IDs. When configured, missing actors are denied; malformed policy fails closed. Shared documents remain available to permitted actors. This setting scopes this AI/library feature, not other dashboard modules.

Search uses local SQLite FTS5, bounded passages and allowlisted database projections. It excludes authentication, GPS/worker, voice, AI-history, arbitrary data files and arbitrary database tables. API-like secrets are redacted from extracted text. Source checksums are checked before retrieval; originals are downloadable only through gated handlers. Uploads with credentials should be withdrawn and replaced: redaction does not remove a secret from the original file.

Only retrieved passages/selected records and the user's question are sent through the existing server-side OpenAI Responses adapter. Empty controlled retrieval and equipment-action requests skip the model call. The Agents API environment connection is a separate code-execution facility; it is not required for dashboard inference. No API keys are included in the browser or delivery package.

## API

- GET `/api/ai/knowledge`: scoped catalog and coverage.
- GET `/api/ai/knowledge/search?q=...&siteId=...&reference=true`: reviewed reference search when explicitly requested.
- GET `/api/ai/knowledge/sources/<id>` or `/file`: passages/review history or integrity-checked original.
- GET `/api/ai/knowledge/records/<table>/<id>`: allowlisted, scoped recorded evidence.
- POST `/api/ai/knowledge/upload`: title, filename, contentBase64, siteId, sourceKey, revision, owner.
- POST `/api/ai/knowledge/sources/<id>/review`: status, reason, owner, revision, effective_from, effective_to, review_due, confirmed, expectedStatus.
- POST `/api/ai/query`: existing payload plus siteId and referenceMode (boolean).

Upload and review append audit events. AI audit records preserve source IDs, checksums, revisions, statuses, scope and snapshot identity. A new review does not rewrite past answer evidence.
