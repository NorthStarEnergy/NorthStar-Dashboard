# Pipeline reconciliation and menu typography

V1 left navigation now uses the same 12px Arial typography as v2. Existing colors and geometry rules are retained. The hosted alarm-navigation fixture now creates a fixture alarm through the existing test-input event, so background alarm refresh cannot erase an unrelated synthetic count. A forced refresh reproduces the previous failure. Rendered typography comparison covers switching between both builds.

Audit covered 35 worktrees, local branches/tags, 108 inbox filenames and later queue reconciliation records. Historical ready scopes were already released; private recovery snapshots remain local. Three missing historical weather tags were verified as ancestors of published main and pushed explicitly. Chart c46a983 was completed by its original owner. Protected saved layout remains unchanged.

Validation: 483 Python passed,12 PostgreSQL checks skipped locally;65 Node passed; rendered menu parity, forced alarm refresh, Agent navigation, Event Log and market spacing passed without page errors. Committed-source HTTP/preflight and hosted CI tracked in outputs/HANDOFF.md. Authenticated production/native rendering and prior backend activation remain separate limitations.
