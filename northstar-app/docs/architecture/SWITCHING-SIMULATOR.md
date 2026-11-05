# Switching Simulator — initial synthetic slice

**Status:** prototype implementation (`northstar-sim-0.1.0`), not a station training release.

## What is implemented

- A separately rendered Tools → Training panel with an always-visible simulation banner, explicit synthetic/catalog-only readiness, a topology view from terminal mappings, measurements, returned switch indications, simulated alarms, events, clock controls, and a learner debrief.
- One pinned fictional model, `SIM-TRAINING-01`, with the supplied versioned model/rule/scenario fixtures. Available scenarios are normal radial loss, alternate-source backfeed, stuck breaker, and frozen indication.
- A server-owned fixed 100 ms engine, with 1x/5x/10x clock, pause and step; 1-second tag scans; equipment travel; command selection/expiry; current permissive checks; a balanced radial backward/forward sweep; first-order hydro/storage; a synthetic low-voltage alarm; replay events; finish and reset.
- An isolated SQLite database under `%LOCALAPPDATA%\NorthStar\TrainingSimulator\simulator.sqlite3` by default. Override only with the trusted server setting `NORTHSTAR_SIM_ROOT`. It is not the operational NorthStar database or a SCADA drop directory.
- Session-owned API routes under `/api/training/switching`, guarded by the existing operator and host checks and an explicit cross-origin mutation check. Learner snapshots use observed indications; instructor truth and scenario fault causes are not returned by the learner API.
- Twenty station identities displayed as `catalog_only`; none can start the synthetic model under a real station name.

## Exercise

Start the NorthStar backend using its usual local development instructions. Open **Tools → Training → Switching Simulator**, choose `SIM-TRAINING-01`, choose one of the four synthetic exercises, and start it. Start the simulation clock before selecting and executing a simulated switch command. Each operation requires a separate select and execute action. Finish freezes a debrief; reset starts a new run and retains prior debrief evidence.

The simulator has no live-tag fallback, OT network client, S+ Workbench route, operational event write, or operational alarm acknowledgement. Returned position and voltage/energization displays are driven from simulated tags, not by copying drawing position.

## Scope and outstanding work

This slice does **not** satisfy the full handoff acceptance matrix. In particular, it does not yet implement typed rule AST validation/evaluation, protection trips and lockout, sync-check, complete alarm recurrence/shelving, instructor fault controls/roles, auxiliary-contact failure, electrical meshes/transformers, trends, session export, or the full scenario suite. It is not restart/replay validated across the entire event/timer/RNG contract and has not had 500-device/10-session performance testing. The synthetic fixtures are not approved NorthStar station models or switching procedures.

Real station readiness is blocked on controlled drawings, terminal connectivity, equipment ratings, real point lists, control/protection descriptions, and reviewed process curves. No real station is represented as accepted. Do not promote a station based on the catalog or synthetic example.

## Verification

Focused automated checks live in `tests/test_switching_simulator.py` and `tests/test_switching_simulator_api.py`. They cover the synthetic model contract, radial power flow and backfeed, exact breaker timing, command refusal, telemetry staleness versus physical state, hydro/mass balance, the low-voltage alarm, debrief/reset, persistence after restart, API owner isolation, and route gate/origin behavior. Passing these checks is not a claim that the remaining handoff acceptance cases pass.
