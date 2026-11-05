# outage-stitch source archive

Snapshot: 2026-09-14
Origin HEAD: `08fefe14361831bd8fe977c731e1caa6ca19e769` — Document Origin clone steps for outage-stitch

## Git (source of truth)

Private Origin repo: https://cursor.com/codebase/force-of-nature-genetics/outage-stitch

```bash
origin auth login
origin repo clone force-of-nature-genetics/outage-stitch
```

Merged GitHub working copy (this agent): https://github.com/footmenfrenzyremaster/cannaboard

## Archives in this folder

| File | SHA-256 | Notes |
|---|---|---|
| `outage-stitch-src.tgz` | `0a7ea55787a2aedcc26268eea8f57fe6a0c1bf3a2e3cc128846967eba71c98d6` | `git archive` of main, source only (no `package-lock.json`, no `node_modules`) |
| `outage-stitch-main.tgz` | `eea3022bd62fe4fc19dcda918a11bd50bf3587bcff697c1b0e5527d801fa33ae` | Full git archive of HEAD including lockfile |

If a `.tgz` is missing from Drive, recreate it from the Origin clone:

```bash
cd outage-stitch
git archive --format=tar.gz --prefix=outage-stitch/ -o outage-stitch-src.tgz HEAD -- ':!package-lock.json'
```

This is a records dashboard only. It does not issue switching commands, write to SCADA, or release equipment.
