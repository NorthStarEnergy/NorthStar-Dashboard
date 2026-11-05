# NorthStar operator knowledge library - v0.89

## Changes
- Added a controlled SQLite source/revision registry, FTS5 passage index and append-only human reviews.
- Connected scoped retrieval to existing dashboard chat, with exact-source links, plant selection and explicit reviewed-reference mode.
- Added gated upload/review/original-file/record-evidence APIs and the Knowledge Library page.
- Removed filesystem and arbitrary-table crawling. Existing notes, logbook and outages are explicit recorded-fact projections.
- Checksum failures, invalid dates, pending/legacy/superseded/withdrawn sources and absent site access cannot supply AI evidence. Corrupt sources can still be withdrawn; their passages are withheld.
- Sources have immutable revisions, intake deduplication and automatic supersession of older current revisions.
- Empty controlled search and operational-action requests skip inference. Missing or invented source IDs fall back to retrieved evidence. Retrieved text never becomes system instructions.
- Fixed New Chat activation after the sidebar moves into the AI menu. Added bulk-intake tooling and an operator guide.
- Refreshed visible build/cache metadata. Existing server credential was reused in place; no key was written or exported.

## Existing library
94 historical SOPs are registered as LEGACY_REFERENCE, with zero currently approved sources. No legacy procedure body was indexed or promoted. Existing operator records remain available on demand. Qualified document owners must upload and review current material; software completion is not document approval.

## Verification
- 19 targeted Python tests passed: controlled knowledge, gated HTTP integration, AI history and legacy SOP handling.
- 3 JavaScript regression checks passed: moved-menu New Chat, source-link escaping and rejection of unsafe links.
- Python compile checks passed for five changed backend/intake modules; syntax checks passed for both changed browser scripts.
- Isolated browser: normal test sign-in, pending source details, exact passage, and explicit review to current status rendered successfully. Test data and approval remained in a temporary database.
- Existing API credential: configured/allowed models were present in the account's model list. A real GPT-6 Sol request returned a concise answer citing an isolated dashboard-help fixture.
- Full Python suite ran: 338 passed, 9 failed. Failures involve existing model token-cap expectation, old asset cache strings, engineering links, an event-register fixture missing ai_conversations, retired Sites redirect expectation and UWPC notice text. These unrelated contracts were preserved. See the existing local full-tests.txt for details.
- Production backend restarted with its existing demo gate and loopback binding. Signed-out knowledge APIs and protected originals were refused; the public check-in hostname was refused. The production library serves the sign-in page to signed-out visitors.
- Chrome control later timed out, so the final chat menu correction has regression-test proof, not a final authenticated production screenshot. Production sign-in is still required for live operator validation.

## Files
- northstar_operator_knowledge.py
- northstar_knowledge.py
- northstar_ai.py
- ieso_backend.py
- ai-assistant-workspace.js
- ai-assistant-workspace.css
- knowledge-library.html
- knowledge-library.js
- knowledge-library.css
- scripts/knowledge-library.py
- tests/test_knowledge.py
- tests/test_knowledge_routes.py
- tests/knowledge-ui.test.cjs
- docs/OPERATOR-KNOWLEDGE-LIBRARY.md
- BUILD-VERSION.txt
- dashboard-build-data.js

## Publication and rollback
The repository already contained many unrelated source changes and advanced concurrently through builds v0.84-v0.86. A temporary-index check showed that the task-only patch does not apply to committed HEAD. No unrelated work was staged, reset, stashed or committed. A clean standalone commit/tag/GitHub packet requires reconciling that earlier source baseline first; no publication claim is made.

The delivery ZIP contains the current feature source, documentation, tests, metadata and task delta. It excludes databases, original operating documents, credentials and runtime logs. It is a feature delivery snapshot, not a complete clean-checkout application distribution. The task delta is relative to the pre-task working source, not HEAD. Never reverse it blindly over subsequent work. To suspend inference use the existing NORTHSTAR_AI_ENGINE=none setting and restart through the normal gated launcher. Keep all source/review/audit records. Never restore the broad-crawl retrieval implementation.

## Next use
Open https://ops.northstarenergy.ca/knowledge-library.html, sign in normally, then upload current dashboard help and approved plant documents. A qualified owner records the review. Open AI menu -> New Chat, select plant/source mode, and ask a question. Inspect citations before using any information operationally.
