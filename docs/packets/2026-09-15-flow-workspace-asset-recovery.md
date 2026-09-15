# Flow workspace asset recovery

The dashboard now ships the Flow workspace as a complete, versioned asset set.  The
section has a real workspace root, its stylesheet and script are served from the
dashboard static tree, and the backend exposes the operator-only `/api/flows`
snapshot route.  The polling loop reads only the configured public hydrometric
sources, retains confirmed readings when a source is unavailable, and never sends
commands to a provider.

This resolves the broken-loader state that named `flows-workspace.js`: the asset is
part of the committed release instead of existing only in the running workspace.
The static-server regression suite now requests that exact file, so a future
deployment cannot omit it without failing validation.

The scheduled-service launcher now invokes Python directly instead of using a
detached `Start-Process` child. Ending the scheduled task will therefore stop
the backend it owns, allowing the next restart to load a new dashboard release.

Validation: `node tests/flows-workspace.test.cjs`, the browser recovery suite, the
focused Flow/static suite (25 passed), and the complete Python suite (265 passed).
After the service restart, both Flow assets returned HTTP 200 and `/api/flows`
returned its expected operator sign-in guard before authentication.
