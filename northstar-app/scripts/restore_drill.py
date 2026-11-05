#!/usr/bin/env python3
"""Backup restore drill — Packet 18 §18.2 / MIGRATION_SEQUENCE.md Stage 0.3.

Verifies that a daily backup under data/backups/*.db actually restores into a
usable, structurally sound database, WITHOUT ever opening or modifying the
live data/northstar.db.

This is deliberately standard-library only (sqlite3, shutil, pathlib), to
match this project's stated dependency policy (see AGENTS.md: "the project
ships with tzdata as its only dependency").

What this script does NOT do:
  - It does not touch data/northstar.db (the live database) at all.
  - It does not run the pytest suite against the restored copy. Doing that
    for real requires pointing NORTHSTAR_DB at the restored file and running
    `python -m pytest tests -q` by hand (see the printed instructions at the
    end) — that is a separate, deliberate step so nobody mistakes this
    script's exit code for a full test-suite pass.
  - It does not claim success it hasn't checked. Every check below is a real
    read against the actual restored file.

Usage:
    python scripts/restore_drill.py                  # uses the newest backup
    python scripts/restore_drill.py path\to\backup.db # uses a specific file

Exit code is 0 only if every check below passes.
"""

from __future__ import annotations

import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKUP_DIR = ROOT / "data" / "backups"

# Tables a healthy Northstar database should have (from northstar_store.py's
# CREATE TABLE statements as of this drill's authoring). If the schema grows,
# add new tables here rather than silently ignoring them.
EXPECTED_TABLES = {
    "checkins",
    "checkin_events",
    "logbook",
    "outages",
    "outage_events",
    "alert_settings",
    "alerts",
    "alert_events",
    "switching_drafts",
    "switching_draft_events",
    "repository_policies",
    "artifact_repository_refs",
}


def pick_backup(explicit: str | None) -> Path:
    if explicit:
        path = Path(explicit)
        if not path.is_file():
            raise SystemExit(f"Backup file not found: {path}")
        return path
    candidates = sorted(BACKUP_DIR.glob("northstar-*.db"))
    if not candidates:
        raise SystemExit(f"No backups found under {BACKUP_DIR}")
    return candidates[-1]


def run_drill(backup_path: Path) -> bool:
    print(f"Restore drill starting for: {backup_path}")
    print(f"Backup file size: {backup_path.stat().st_size:,} bytes")

    all_ok = True

    with tempfile.TemporaryDirectory(prefix="northstar-restore-drill-") as tmp:
        restored = Path(tmp) / "restored.db"
        # This is the actual "restore": copy the backup somewhere that is
        # not the live data directory, then only ever touch the copy.
        shutil.copy2(backup_path, restored)
        print(f"Copied to isolated scratch path: {restored}")

        conn = sqlite3.connect(f"file:{restored}?mode=ro", uri=True)
        try:
            cur = conn.cursor()

            # 1. SQLite's own integrity check.
            cur.execute("PRAGMA integrity_check")
            result = cur.fetchone()[0]
            ok = result == "ok"
            all_ok &= ok
            print(f"[{'PASS' if ok else 'FAIL'}] PRAGMA integrity_check -> {result}")

            # 2. Foreign key check (won't catch anything if FKs were off when
            #    the backup was written, but costs nothing to ask).
            cur.execute("PRAGMA foreign_key_check")
            fk_violations = cur.fetchall()
            ok = not fk_violations
            all_ok &= ok
            print(
                f"[{'PASS' if ok else 'FAIL'}] PRAGMA foreign_key_check -> "
                f"{len(fk_violations)} violation(s)"
            )

            # 3. Every expected table exists.
            cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
            present = {row[0] for row in cur.fetchall()}
            missing = EXPECTED_TABLES - present
            ok = not missing
            all_ok &= ok
            print(
                f"[{'PASS' if ok else 'FAIL'}] expected tables present -> "
                f"missing: {sorted(missing) if missing else 'none'}"
            )

            # 4. Row counts, for a human to sanity-check against what they
            #    expect operationally. This script does not know what count
            #    is "right" — it only reports what's actually in the file.
            print("Row counts in restored copy:")
            for table in sorted(EXPECTED_TABLES & present):
                cur.execute(f"SELECT COUNT(*) FROM {table}")
                count = cur.fetchone()[0]
                print(f"  {table}: {count}")

            # 5. The append-only audit trail should never be empty if any
            #    checkin has ever happened — a healthy sign, not a hard
            #    requirement (a brand-new install would legitimately have 0).
            if "checkins" in present and "checkin_events" in present:
                cur.execute("SELECT COUNT(*) FROM checkins")
                checkin_count = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM checkin_events")
                event_count = cur.fetchone()[0]
                if checkin_count > 0 and event_count == 0:
                    all_ok = False
                    print(
                        "[FAIL] checkins exist but checkin_events is empty — "
                        "the audit trail rule in AGENTS.md/FIELD-STAFF-PERSISTENCE-HANDOFF.md "
                        "says every state change must append an event"
                    )
                else:
                    print(
                        f"[PASS] audit trail present: {checkin_count} checkin(s), "
                        f"{event_count} event row(s)"
                    )
        finally:
            conn.close()

    return all_ok


def main() -> int:
    explicit = sys.argv[1] if len(sys.argv) > 1 else None
    backup_path = pick_backup(explicit)
    ok = run_drill(backup_path)

    print()
    if ok:
        print("RESULT: PASS — the restored copy is structurally sound.")
    else:
        print("RESULT: FAIL — see the FAIL lines above.")

    print()
    print("This script checks structure, not application behaviour. To finish")
    print("the drill properly, also run the real test suite against a restored")
    print("copy (never against data/northstar.db itself):")
    print()
    print("  $restored = Copy-Item data\\backups\\<file>.db data\\northstar-restore-test.db -PassThru")
    print("  $env:NORTHSTAR_DB = $restored.FullName")
    print("  python -m pytest tests -q")
    print("  Remove-Item Env:\\NORTHSTAR_DB")
    print("  Remove-Item data\\northstar-restore-test.db")

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
