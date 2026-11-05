# Contributing to NorthStar

1. Read `AGENTS.md`, the current project `outputs/HANDOFF.md` when available, and `docs/CHANGE-COORDINATION.md`.
2. Check the coordinator queue and pending packets. Preserve all dirty work and operational data. Use a separate worktree for overlapping changes.
3. Make a focused branch from current GitHub `main`. Record dependencies on newer local source explicitly; a worktree does not include them.
4. Verify the affected behavior, run the full Python and Node suites, and run the clean-checkout preflight plus committed-source HTTP verifier before release.
5. Open a pull request with the problem, changed behavior and verification. Report authenticated/live checks separately from fixtures.
6. Merge only after required checks pass. Tag the verified release and retain the prior tag for rollback.

Never commit credentials, operational SQLite databases, runtime logs, private snapshots or delivery archives. Do not reset, restore or clean another task's work to obtain a clean checkout. Static assets may become live immediately when changed in the canonical runtime directory.
