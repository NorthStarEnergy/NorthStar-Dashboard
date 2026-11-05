# Event Log live release — 2026-10-04

## Change
Logs opens to New Log, All, SCADA, Dispatch, C-O-M-S, SSC, Water, Market and Critical. Parent filters cover the category, and smaller child buttons narrow it. New Log opens the existing operator composer. Historical reporting is retained. The register loads every snapshot page, shows 100 rows at a time, and refreshes visible logs each minute while the composer is closed. Operator approval remains required.

## Verification
Authenticated ops.northstarenergy.ca verified all nine buttons, child menus, All reset, New Log dialog and 1,543 retrieved records. No operational entry was submitted. Focused browser fixture passed full-history filtering, parent/child reset, Critical, dialog and display paging; JavaScript syntax passed.
Full Python suite: 386 passed, 10 failed. One failure was a build-data cache version mismatch after merging local weather history; corrected and rechecked separately. Nine remaining failures concern existing cache-key expectations, retired pipeline, AI database setup and Teams detail signature; they are not claimed fixed by this UI release.

## Publication boundaries
Release merges the remote Dispatch correction with three local weather commits and includes only the Event Log changes. Canonical working tree contains many additional concurrent edits and was not staged wholesale. Live source is served from the canonical checkout; Git publication is a separate verification.

## Tonight audit
- Event Log: live rendering verified and included in this release.
- Weather: previously unpushed three commits included by merge.
- Markets spacing: served stylesheet matches current source; uncommitted.
- Left menu: Agent visible live; source remains uncommitted.
- Logo position: source includes translate(-3px,4px); uncommitted.
- Old Woman station content and transformer symbols: local changes found; separate release/rendering verification outstanding.
- Account preferences: local changes found; separate release verification outstanding.
- AI research/context and IESO advisories: local source and focused test reports exist; backend restart/live verification still outstanding. No broad backend restart performed.
