# Island / Twin / Iroquois operator trainer

The default **r013 draft** imports the recovered combined single-line with 96
clickable targets and 21 units. Island's four units and the CTS connections are
modeled from r013: T4/T7 feed shared M1 at 115 kV; T8/T9 feed separate 12.5 kV
CTS buses. Twin L1 lands on T9 and L2 on T8; Iroquois L1 lands on T8 and L2 on T9.
The older 17-unit synthetic model remains separately selectable.

**Unverified items remain explicit.** IR G11–13 are isolated at 600 V, with
controls blocked until step-up routing is established. Unresolved station-service,
sluice and other inventory targets have no inferred electrical connections.
Circuit switchers have their own device type; unverified operating duty means
fixed closed training boundaries with controls disabled. Auxiliary availability
is an explicit training assumption, not evidence of a station-service circuit.
All dynamics, impedances, protection and initial positions are assumed; source
voltage/rating discrepancies are retained in each device's historical source notes.

The drawing shows simulated C/O positions, unit state and amber unresolved
markers. Wires retain source geometry and **do not indicate energization**; use
the live simulated bus-voltage strip and device terminal readings. Start, select,
execute, synchronize and stop operate only on the isolated session. Normal,
T8-loss, T9-loss and Island-line-1-loss exercises are available.

Use **Full screen** for a dedicated schematic view. Scroll over the drawing to
zoom around the pointer, drag to pan, or use Zoom in/out and Fit drawing. The
zoom range is 10-600%; Fit drawing fits both dimensions. With the viewport
focused, arrow keys pan, +/- zoom and 0 fits; Escape exits full screen. Device
details are optional and open when equipment is selected. The unverified warning
stays visible above the drawing, including in full screen.

This is a draft training model, not an accepted as-built
model or an ABB runtime integration.

The original SVG and metadata are preserved under `trainer-assets/r013/`, with
SHA-256 provenance. `python scripts/build-r013-fixture.py` reproduces the versioned
model, scenarios and derived runtime artwork; it does not execute recovered code.
See `docs/packets/2026-11-05-r013-island-cts.md` for test evidence and remaining gaps.

Run `./Start-Trainer.ps1` in PowerShell, then open http://127.0.0.1:43192/.
Python 3.10+ is the only runtime dependency. The launcher is loopback-only and
does not import the operational backend. Each session starts paused: choose an
exercise, launch, then press **Run**. Controls use **select → execute**; opening
a faceplate does not operate equipment.

For another Python installation:

```powershell
python scripts/run-switching-trainer.py --port 43192 --data-root ./trainer-data
```

The legacy source-derived complex contains Twin units 1–5, Iroquois units 1–9 and 11–13,
the MAIN Sub, 230/120 kV switchyard, Twin line breakers, station service,
auxiliaries, tap changers, and six spill gates. No unit 10 is invented.

Exercises cover normal unit start/load/stop, Twin black start and restoration,
and separating/reconnecting a running complex. The overview includes guidance
for these illustrative exercises. Breaker controls distinguish live/live sync
closure from energizing a dead bus. Automatic and manual black start, separate
generating islands, station-service transfer, gate travel and water balance are
modeled. Open-breaker units do not count as a generating station island.

Original recovered ABB graphics and companions are retained in the local
`trainer-assets/h2o-native-bases.zip` archive and downloadable from **H2O sources**.
That archive is a local delivery asset, excluded from Git publication. The
committed reference JSON contains visible control labels and source-page names,
without live process bindings. Browser controls bind only to simulation IDs.
The native archive is included in the local delivery ZIP; when using a Git-only
checkout, copy it from the recovered package before using the native download.

The browser pages are rebuilt from the recovered control families; they are
**not native ABB DisplayBuilder rendering**. Native bases remain unchanged.
Electrical terminal mapping is illustrative except for the traced links noted
in the packet. Unit ratings, loads, governor/AVR settings, timings, voltage
choices and hydraulic coefficients are explicitly assumed. This is a working
training model, not an as-built electrical model or a station operating procedure.

The original single-unit synthetic exercises remain available in the model
selector. Finish produces a downloadable JSON debrief with model/scenario hashes,
commands, alarm occurrences and achieved milestones. Restarting the server
restores saved sessions paused; outstanding selection tokens are discarded.

Implementation and verification: [packet](docs/packets/2026-11-05-twin-iroquois-complex.md).
