# 20261105-twin-iroquois-complex

## 1. Request and outcome

Build the recovered Twin Falls and Iroquois Falls H2O pages into a working
operator trainer. CTS scope was confirmed as MAIN Sub, 230 kV Switchyard and
120 kV A/B buses. The isolated trainer now supports all 17 recovered units,
normal unit controls, switchgear and tap controls, station service, auxiliaries,
six spill gates, generating islands, Twin black start and grid reconnection.

## 2. Source and isolation

Branch `codex/twin-iroquois-trainer`, starting from `0d82b65`. The existing dirty
single-unit trainer files were copied as explicit dependencies from the original
`feature/switching-simulator` worktree. That original worktree was not edited.
The dependency inventory is retained locally as `output/trainer-complex-baseline.json`.
No canonical runtime, shared coordination files, VM, operational records or live
control bindings were changed. The standalone launcher imports only the simulator
service and binds 127.0.0.1, with Host/Origin/forwarding checks retained.

Recovered sources: 97 Twin pages, 140 Iroquois pages, 480 shared symbol/popup pages.
All 388 Twin native files match the 2019 backup. All 17 unit control page names
and visible controls are recorded in `trainer-assets/h2o-controls-reference.json`.
Raw native files and process bindings stay in the separate local archive, which
is included in the delivery ZIP but is not committed or pushed.

## 3. Implementation

- Add `SIM-TWIN-IROQUOIS` alongside the original model, with 55 nodes and 126
  equipment records. Preserve scenario/model matching, ownership, revision checks,
  command tokens, idempotency, persistence and current-run debriefs.
- Model connected components through switch position and transformer/line
  branches. Solve linearized P/angle and Q/voltage equations for meshed islands
  using voltage bases, tap offsets, source references and calculated flows.
- Advance island frequency/phase from aggregate inertia, mechanical/load imbalance
  and droop. Synchronizing biases compensate droop at actual island load.
  Sync checks re-run at breaker travel completion, not just selection.
- Model generator startup, ready, online, normal unloading/rundown and emergency
  lockout; MW, gate, condense (Twin), Mvar, AVR trim, auto/manual sync, Twin
  frequency support and black-start modes. Iroquois 11–13 retain simpler controls.
- Model loss-of-auxiliary and island-frequency trips, independent unit/breaker
  resets, mechanism failure, remote/DC permissives, grounding/isolator interlocks,
  dead/live closure distinction and parallel tap controls.
- Model station-service break-before-make transfer and retransfer with breaker
  travel; AC/DC auxiliary supply, gate slew, turbine flow, pond storage and spill.
- Add overview, Twin electrical/unit, MAIN Sub, HV/120 kV, Iroquois unit,
  auxiliary/SS, water and source pages. All controls issue simulation commands.
  The native page archive is retained unchanged; the web views are rebuilt from
  the recovered control families, not ABB runtime rendering.

## 4. Verification

Behavior tests include independent operation of all 17 units, normal stop,
manual/auto black start, Twin supplying Iroquois without the grid, starting an
Iroquois unit on that island, independent Twin islands, whole-complex islanding
and reconnection, no false reconnection from a different unit, meshed power
balance, multi-voltage transformation, taps/parallel control, gate travel and
water balance, transfer/retransfer, auxiliary/DC loss, lockouts, mechanism failure,
sync drift during breaker travel, persistence, ownership and retry idempotency.

Browser verification uses the actual standalone HTTP service and real UI handlers.
Connected operation: Twin G1 start → READY → 52G close → ONLINE → 2 MW demand.
UI checks also cover the electrical, Iroquois and water pages, source links and
the separate select/execute flow. Screenshots accompany the local delivery.

Full-suite result before final focused refinements: **597 passed, 4 failed,
8 errors, 21 skipped; 347 subtests passed**. Remaining failures are the already
documented database-foundation schema, retired Sites file, and research-access
expectations. No production release is claimed from this non-green baseline.
Final focused engine/service/HTTP/unit/complex suite: **44 passed**, including
18 complex behavior tests. Node syntax checks and `git diff --check` pass.
Delivery commit and asset hashes are recorded in the local manifest.

## 5. Engineering assumptions and limits

Verified source links: TF 52L1 → MAIN Sub 52-31, TF 52L2 → 52-30, and IR 52-27
between 12 kV A/C. Other terminal assignments (including transformer/feeders and
unit grouping) are illustrative, not a verified as-built netlist. The model uses
230/120 kV despite mixed 230/240 and 115/120 labels in the sources; station service
is assumed 600 V. All 17 units are illustrative 5 MW/6 MVA machines at 300 rpm.
These ratings must not be inferred as actual station ratings.

Assumed synchronization limits: 0.15 Hz, 10°, 0.05 pu; dead threshold 0.1 pu.
Taps ±8 at 0.625%; start 6 s, opening 0.4 s and closing 0.8 s; frequency protection
57.5–62.5 Hz for 2 s; auxiliary loss 3 s. Water uses independent 100000 m² ponds,
fixed tailwater, constant inflow and illustrative discharge coefficients.

This reduced-order model omits calibrated river routing, full AC/transient
stability, transformer vector groups, protection coordination, detailed excitation
limits, saturation, surge and emergency mechanical dynamics. It does not supply
station operating instructions or certify equipment settings. Native DisplayBuilder
import/render remains unverified. Source cross-unit anomalies are retained only in
the archive; simulation unit states never share their suspicious native bindings.

## 6. Run and deliver

Use `Start-Trainer.ps1`, or `python scripts/run-switching-trainer.py --port 43192
--data-root <dedicated-folder>`. Delivery includes an isolated source snapshot,
launcher, original native archive, source provenance, verification manifest and
screenshots. The operational backend is not needed for this entry path.

## 7. Integration status

Prepared and verified in an isolated worktree. Original dirty work and canonical
runtime remain protected. Production/dashboard navigation integration and any
real station engineering validation are outside this local trainer delivery.
The repository source branch is the reviewable handoff; the local source archive
contains the recovered native bases that are intentionally excluded from Git.
