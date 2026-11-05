"""Initialize the separate NorthStar data foundation; never migrate the live DB."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import northstar_sites

DOMAINS = (
    ('runtime', 'Unit runtime and cycling'),
    ('power', 'Power and energy'),
    ('water', 'Water levels and flows'),
    ('weather', 'Weather observations and forecasts'),
    ('operations', 'Operations and maintenance'),
    ('generators', 'Generator specifications and condition'),
    ('equipment', 'Equipment and asset register'),
    ('ecology', 'Fish spawning and environmental observations'),
)


def initialize(path: Path) -> dict:
    path = path.resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation prevents modifying ANY existing database, including live data.
    with path.open('xb'):
        pass
    connection = None
    try:
        connection = sqlite3.connect(path)
        connection.execute('PRAGMA foreign_keys=ON')
        schema = (ROOT / 'database-foundation/schema.sql').read_text(encoding='utf-8')
        connection.executescript('BEGIN IMMEDIATE;\n' + schema)
        connection.execute('INSERT INTO foundation_meta VALUES (1, ?)',
                           (datetime.now(timezone.utc).isoformat(),))
        connection.executemany('INSERT INTO domains VALUES (?, ?)', DOMAINS)
        connection.executemany('INSERT INTO sites VALUES (?, ?, ?)',
                               [(s['id'], s['name'], s['area']) for s in northstar_sites.stations()])
        connection.commit()
        integrity = connection.execute('PRAGMA integrity_check').fetchone()[0]
        foreign_keys = connection.execute('PRAGMA foreign_key_check').fetchall()
        if integrity != 'ok' or foreign_keys:
            raise RuntimeError('Database verification failed')
        return {'path': str(path), 'schema_version': 1, 'domains': len(DOMAINS),
                'sites': connection.execute('SELECT count(*) FROM sites').fetchone()[0],
                'tables': connection.execute("SELECT count(*) FROM sqlite_master WHERE type='table'").fetchone()[0],
                'observations': 0, 'integrity': integrity, 'foreign_key_violations': len(foreign_keys),
                'integration': 'foundation only; no imports, API, or live service connection'}
    except BaseException:
        if connection is not None:
            connection.close()
            connection = None
        path.unlink(missing_ok=True)
        raise
    finally:
        if connection is not None:
            connection.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, default=ROOT / 'data/northstar-foundation.db')
    args = parser.parse_args()
    print(json.dumps(initialize(args.database), indent=2))
