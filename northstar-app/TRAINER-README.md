# Twin Falls / Iroquois operator trainer

Run `./Start-Trainer.ps1` in PowerShell, then open http://127.0.0.1:43192/.
Python 3.10+ is the only runtime dependency. The launcher is loopback-only and
does not import the operational backend. Each session starts paused: choose an
exercise, launch, then press **Run**. Controls use **select → execute**; opening
a faceplate does not operate equipment.

For another Python installation:

```powershell
python scripts/run-switching-trainer.py --port 43192 --data-root ./trainer-data
```

The source-derived complex contains Twin units 1–5, Iroquois units 1–9 and 11–13,
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
