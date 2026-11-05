# Dashboard change coordination

Read-only investigations require no lock. Before integration into a shared running checkout:

- Check `outputs/change-coordinator/queue.md`, `inbox/`, current handoff and active worktrees. An old READY packet may have a later verified record; reconcile by request ID and source hashes.
- Create one unique request packet using exclusive file creation.
- Acquire `outputs/change-coordinator/integration.lock` through atomic directory creation. Store owner and timestamp. If another owner holds it, prepare in isolation and leave that lock untouched.
- Only the lock owner updates shared runtime source, queue and `outputs/HANDOFF.md`. Save private preimages, compare current hashes immediately before integration, and reconcile any drift.
- Preserve every distinct requirement and integrate ready scopes one at a time. Record verification and source commit separately; applied source is not automatically authenticated or live proof.
- Workers use isolated worktrees and unique handoffs. Delegation and messages to other chats require explicit authorization.
- Save allowlisted deliverables in project outputs and the verified Work Projects/NorthStar Drive folder. Exclude operational records, credentials and private preimages.
- Update the seven-section handoff, record remaining blockers and release only your own lock in a finally block.

This procedure coordinates participating tasks; it does not enforce filesystem access control. The local `.cursor` coordinator configuration may supply additional workstation guidance. This repository copy is available to fresh clones.
