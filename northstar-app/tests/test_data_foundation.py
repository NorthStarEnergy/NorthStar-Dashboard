import importlib.util
from pathlib import Path
import sqlite3

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('setup_foundation', ROOT / 'scripts/setup-data-foundation.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


@pytest.fixture
def db(tmp_path):
    path = tmp_path / 'foundation.db'
    setup.initialize(path)
    with sqlite3.connect(path) as con:
        con.execute('PRAGMA foreign_keys=ON')
        con.execute("INSERT INTO sources(id,name,source_kind,reference) VALUES ('s','Fixture','file','fixture')")
        con.execute("INSERT INTO import_batches(id,source_id,source_revision,imported_at_utc,status) VALUES ('b','s','1','2026-01-01T00:00:00Z','validated')")
        site = con.execute('SELECT id FROM sites ORDER BY id LIMIT 1').fetchone()[0]
        con.execute("INSERT INTO equipment(id,site_id,designation,equipment_type) VALUES ('e',?,'G1','generator')", (site,))
        con.execute("INSERT INTO series(id,domain_id,site_id,equipment_id,source_id,source_tag,metric,unit,measurement_kind) VALUES ('p','power',?,'e','s','tag','active_power','MW','instant')", (site,))
        con.commit()
        yield con


def reading(db, **values):
    row = dict(series_id='p', observed_at_utc='2026-01-01T00:00:00Z', value=1.0,
               quality='good', batch_id='b', source_row='1', received_at_utc='2026-01-01T00:01:00Z')
    row.update(values)
    db.execute(f"INSERT INTO observations ({','.join(row)}) VALUES ({','.join('?' for _ in row)})", tuple(row.values()))


def test_seed_and_refuse_overwrite(tmp_path):
    path = tmp_path / 'new.db'
    result = setup.initialize(path)
    assert result['domains'] == 8 and result['observations'] == 0
    assert result['sites'] == len(setup.northstar_sites.stations())
    before = path.read_bytes()
    with pytest.raises(FileExistsError):
        setup.initialize(path)
    assert path.read_bytes() == before


def test_foreign_keys_and_site_equipment_binding(db):
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("INSERT INTO sources(id,name,source_kind,reference) VALUES (NULL,'Invalid','file','fixture')")
    with pytest.raises(sqlite3.IntegrityError):
        reading(db, series_id='unknown')
    other = db.execute("SELECT id FROM sites WHERE id<>(SELECT site_id FROM equipment WHERE id='e') LIMIT 1").fetchone()[0]
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("UPDATE series SET site_id=? WHERE id='p'", (other,))


def test_missing_is_not_zero(db):
    with pytest.raises(sqlite3.IntegrityError):
        reading(db, value=None)
    with pytest.raises(sqlite3.IntegrityError):
        reading(db, value=0, quality='missing')
    reading(db, value=None, quality='missing')


def test_utc_and_revision_history(db):
    with pytest.raises(sqlite3.IntegrityError):
        reading(db, observed_at_utc='2026-01-01 00:00')
    reading(db)
    with pytest.raises(sqlite3.IntegrityError):
        reading(db)
    reading(db, revision=2, value=2)
    assert db.execute('SELECT value FROM current_observations').fetchone()[0] == 2
    with pytest.raises(sqlite3.IntegrityError):
        db.execute('UPDATE observations SET value=3')
    with pytest.raises(sqlite3.IntegrityError):
        db.execute('DELETE FROM observations')


def test_forecasts_separate_from_actuals(db):
    reading(db)
    with pytest.raises(sqlite3.IntegrityError):
        reading(db, record_kind='forecast')
    reading(db, record_kind='forecast', issued_at_utc='2025-12-31T00:00:00Z')
    reading(db, record_kind='forecast', issued_at_utc='2025-12-31T12:00:00Z')
    assert db.execute('SELECT count(*) FROM current_observations').fetchone()[0] == 3


def test_batch_provenance_and_interval_duration(db):
    db.execute("INSERT INTO sources(id,name,source_kind,reference) VALUES ('other','Other','file','fixture2')")
    db.execute("UPDATE import_batches SET source_id='other' WHERE id='b'")
    with pytest.raises(sqlite3.IntegrityError):
        reading(db)
    db.execute("UPDATE import_batches SET source_id='s' WHERE id='b'")
    db.execute("UPDATE series SET measurement_kind='interval_total' WHERE id='p'")
    with pytest.raises(sqlite3.IntegrityError):
        reading(db)
    reading(db, interval_seconds=3600)


def test_water_datum_required(db):
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("UPDATE series SET metric='water_level',domain_id='water',unit='m'")
    db.execute("UPDATE series SET metric='water_level',domain_id='water',unit='m',datum='NAVD88'")


def test_runtime_overlap_and_reverse_time(db):
    def interval(id, start, end):
        db.execute("INSERT INTO runtime_intervals(id,equipment_id,started_at_utc,ended_at_utc,state,batch_id,source_row,quality) VALUES (?,'e',?,?,'running','b',?,'good')", (id,start,end,id))
    interval('1','2026-01-01T00:00:00Z','2026-01-01T01:00:00Z')
    with pytest.raises(sqlite3.IntegrityError):
        interval('2','2026-01-01T00:30:00Z','2026-01-01T02:00:00Z')
    with pytest.raises(sqlite3.IntegrityError):
        interval('3','2026-01-01T03:00:00Z','2026-01-01T02:00:00Z')
    interval('4','2026-01-01T01:00:00Z',None)
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("UPDATE runtime_intervals SET started_at_utc='2026-01-01T00:30:00Z' WHERE id='4'")


def test_fish_counts_and_review_evidence(db):
    site = db.execute('SELECT site_id FROM equipment LIMIT 1').fetchone()[0]
    db.execute("INSERT INTO fish_surveys(id,site_id,reach,started_at_utc,method,batch_id,source_row) VALUES ('survey',?,'Fixture reach','2026-01-01T00:00:00Z','visual','b','2')", (site,))
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("INSERT INTO fish_observations(id,survey_id,species,measure,count,quality) VALUES ('f','survey','Unknown','fish_count',-1,'good')")
    db.execute("INSERT INTO fish_observations(id,survey_id,species,measure,presence,quality) VALUES ('f','survey','Unknown','presence','unknown','unreviewed')")
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("INSERT INTO environmental_windows(id,site_id,reach,species,starts_on,ends_on,purpose,source_id,source_ref,status) VALUES ('w',?,'Fixture','Unknown','2026-01-01','2026-02-01','review','s','fixture','reviewed')", (site,))
