# NorthStar AI environment optimization — 2026-09-28

## Changes
- Added versioned control-room guidance for events, handoffs, generation, markets, water/flows, Maximo, and controlled procedures/UWPC.
- Answers are instructed to explain evidence, preserve units and timestamps, distinguish interpretation from facts, and identify specific missing information.
- Requests now include dashboard section, authorized site, reference mode, request time, and timezone. Section labels do not grant access.
- Removed duplicated controlled-source summary from model input while preserving records and citations.
- Output budgets: fast 800, balanced 2800, thorough 4800 tokens (existing reasoning-depth floors still apply). These are ceilings, not required answer lengths; larger ceilings can increase cost/latency.
- Reject incomplete Responses API output instead of displaying it as a complete answer.
- Retained existing model selection, credential, scoped retrieval, citation checks, and operational-action refusal.

## Files
northstar_ai.py; northstar_ai_guidance.py; tests/test_ai_assistant.py; tests/test_ai_environment.py.

## Verification
- Before change: 23 passed, 1 existing failure (old fast-profile expectation was 400; implementation already used an 800 floor).
- After change: 26 passed across test_ai_environment.py, test_ai_assistant.py, and test_knowledge.py.
- git diff --check passed for modified tracked application/test files.
- Two live OpenAI calls using the existing key and configured gpt-6-sol model compared before/after on a clearly synthetic market fixture. Both cited the supplied source and calculated CAD 12.50/MWh. Updated output included the full date, arithmetic, percentage, interval-comparability check, and no unsupported cause. This is a smoke comparison, not a broad quality benchmark.
- Restarted the verified port-4180 Python backend using start-northstar.ps1 -DemoLogin -NoBrowser.
- Local health and public check-in health returned 200. Anonymous ops AI status and public check-in AI status returned 403.
- Browser reached the operator sign-in page after restart; authenticated rendered chat was not verified.

## Delivery and remaining limits
- Existing unrelated modifications preserved. Task-only patch saved alongside source snapshots.
- No commit/tag/push: task-only staging dry-run failed because northstar_ai.py already contains substantial uncommitted prerequisite changes. Publishing a coherent source release requires reconciling those changes; they were not included in an unrelated commit.
- No dashboard build number change; backend prompt is versioned northstar-operations/1.
- Conversation history is still stored by the existing application but is not supplied to the model. Source coverage and current-source approval gaps still limit answers. Those require separate targeted work, not a prompt claim that the model can access more data.

## Reference
Prompt structure follows official OpenAI guidance: https://developers.openai.com/api/docs/guides/prompt-engineering
