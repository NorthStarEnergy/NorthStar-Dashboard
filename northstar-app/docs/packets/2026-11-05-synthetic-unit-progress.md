# Synthetic unit trainer — local implementation / verification record

Base: `0d82b65`, branch `feature/switching-simulator`. Work is local and uncommitted.

## Run

From the project directory, with Python 3.12:

```powershell
python scripts/run-switching-trainer.py --data-root "$env:LOCALAPPDATA\NorthStar\SyntheticTrainer"
```

Open `http://127.0.0.1:43190/`. This serves the same Training panel markup and
JavaScript as the dashboard, but imports only the simulator service. It has no
operational backend/feed imports. Choose UNIT-STARTUP, launch, RUN, SELECT START,
then EXECUTE. After READY_TO_SYNCHRONIZE, open the generator breaker faceplate,
SELECT CLOSE and EXECUTE. Select/execute a MW demand, then normal stop.

The local instructor button injects a five-second fictional load overload.
OC1 trips CB1; loss of bus voltage trips GB1. Reset each breaker separately after
the cause clears. Reset does not close either breaker or restart the unit.

## Coverage

All values and timings are fictional, sourced from the versioned fixtures under
`northstar_sim/fixtures/`. No mappings to real S+ 52G1/86G1/94G1 were established.

| Control | ID / transition | Checks / observed feedback | Verification |
|---|---|---|---|
| Start | GEN1 STOPPED → START_CHECK → STARTING → READY_TO_SYNCHRONIZE | Remote, DC, GB1 open/unlocked, ground open, brakes, HPU; sequence/speed/voltage tags | `test_start_sync_ramp_stop` |
| Close | GB1 READY → SYNCHRONIZING → ONLINE | Current sync window and interlocks, delayed mechanism; GB1 position scan | `test_start_sync_ramp_stop` |
| MW demand | GEN1 ONLINE | Bounded MW, remote/DC/online; gate/flow/head constrain ramp | `test_start_sync_ramp_stop` |
| Mvar demand | GEN1 ONLINE | Bounded Mvar, remote/DC/online; reduced-order demand, not validated AVR | `test_reactive_demand_requires_online_and_changes_calculated_current` |
| Normal stop | GEN1 ONLINE → STOPPING → STOPPED | Unload, gate closure, delayed disconnect, rundown; sequence/position | `test_start_sync_ramp_stop` |
| Fault injection | LOAD1 overload → CB1 trip → GB1 undervoltage trip | Per-request local instructor authorization; latched independent lockouts | `test_injected_overload_trip_and_reset` |
| Reset lockout | CB1 or GB1 | Breaker open, DC/remote, protection condition false; no automatic restart | `test_injected_overload_trip_and_reset` |
| Instructor truth/faults | Session-owned service routes | Direct local request, server configuration, session capability; revoked on restore | Unit service and HTTP instructor tests |
| Clock / alarm ack / finish / reset | Existing simulator API | Revision/idempotency, separate alarm occurrence acknowledgement | Existing simulator tests |

## Verified so far

- Model fixture validates with 31 distinct tags, seven typed rules, and a synthetic sequence.
- Simulator engine/service/API tests include five unit-flow tests and per-request HTTP instructor checks.
- Final focused simulator/authentication/hostname/API workflow check: **93 passed,
  257 subtests passed**. Includes the forged-header/public-host security regressions.
- Full-suite run: **576 passed, 7 failed, 8 errors, 21 skipped, 347 subtests
  passed** in 132.61 seconds. Failures/errors are in data foundation, legacy Sites
  pipeline, one-line symbol library and research access (the categories already
  reported in the pre-S+ baseline). This is not a green full-suite release.
- JavaScript parses with Node 22.
- Browser interaction through the isolated launcher: launched UNIT-STARTUP,
  started, reached READY_TO_SYNCHRONIZE, closed GB1, reached ONLINE, selected and
  executed a 0.50 MW demand, observed 2.83 m³/s flow and 43.84 A current, and
  normal-stopped to STOPPED with GB1 open. Uses the real panel handlers and real
  simulator API. Screenshots were blocked because the desktop tab was not visible;
  no screenshot evidence is claimed.
- A second browser start/close cycle followed by the local instructor overload
  produced CB1 and GB1 trips, a LOCKED_OUT indication and an alarm occurrence.
  Both independent reset commands were selected and executed through the panel.

## Remaining release work

This is not completion of the entire S+ handoff acceptance matrix. Dashboard
Library/navigation integration still requires verification: its routing redirected
the Training entry during browser checking. The isolated launcher is the currently
verified entry path. Broader browser failure journeys, annotated screenshots,
deterministic replay/ZIP export, trends, shelving policy, auxiliary fault scenarios,
multiple-unit modeling, comprehensive typed derived-rule execution and cycle
handling, and full state-machine abort/timeout coverage remain outstanding.

Real stations remain catalog-only. No controlled topology or operating procedure
was supplied. The radial solver and reduced-order unit dynamics are not a station
or relay transient model. Dead-bus closure is refused for this grid-following unit.
The panel includes a learner-safe JSON debrief download with pinned rule/sequence
hashes and current-run events. No production deployment, commit, tag, push or
release certification is claimed.
# Follow-on complex trainer

The Twin/Iroquois extension is implemented in
[2026-11-05-twin-iroquois-complex.md](2026-11-05-twin-iroquois-complex.md).
It adds multiple units, connected voltage levels, generating islands, black start,
station service, auxiliaries and spill controls. The single-unit progress record
below is retained as historical context.
