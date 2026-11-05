"""Verify the logbook hash chain and report where, if anywhere, it breaks.

    python scripts/verify-logbook.py                 # the live database
    python scripts/verify-logbook.py --db path.db    # a backup, for comparison

Read-only: it opens the database, recomputes every digest and prints the result.
It never writes, so it is safe to run against the operational database while the
backend is serving.

Exit codes: 0 verified, 1 broken, 2 could not run. Suitable for a scheduled check.

What a PASS does and does not mean. It means every row's stored fields still
hash to the digest recorded when that row was appended, so no entry has been
edited, removed, or inserted out of band SINCE THE CHAIN WAS INTRODUCED. It says
nothing about rows written before that point: those digests were computed by
backfilling whatever the table already contained. Do not present a pass as proof
the pilot data was never altered.
"""

from __future__ import annotations

import argparse
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

import northstar_store as store  # noqa: E402  (path set above)


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify the NorthStar logbook hash chain.")
    parser.add_argument("--db", help="database to check; defaults to the live one")
    args = parser.parse_args()

    if args.db:
        target = pathlib.Path(args.db).expanduser().resolve()
        if not target.exists():
            print(f"No database at {target}")
            return 2
        store.DB_PATH = target

    print(f"Database: {store.DB_PATH}")
    try:
        result = store.verify_logbook_chain()
    except Exception as exc:  # a missing column means the chain was never introduced
        print(f"Could not verify: {exc}")
        print("If this database predates the hash chain, start the backend once to migrate it.")
        return 2

    if result["ok"]:
        print(f"VERIFIED  {result['entries']} entries, chain intact.")
        print("Covers entries appended after the chain was introduced; earlier rows were")
        print("backfilled and their integrity before that point is not demonstrable.")
        return 0

    print(f"BROKEN    after {result['checked']} of {result['entries']} entries.")
    print(f"          first bad entry: {result['brokenAt']}  ({result['brokenTimestamp']})")
    print()
    print("That entry's stored fields are not what were hashed when it was written.")
    print("Treat the log as untrustworthy from that point forward and compare against")
    print("data/backups/ to establish what the record said before it changed.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
