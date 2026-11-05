-- NorthStar data foundation v1. Separate from the operational application DB.
-- Writers MUST enable PRAGMA foreign_keys=ON on every connection.
CREATE TABLE foundation_meta (version INTEGER PRIMARY KEY CHECK(version=1), created_at TEXT NOT NULL);
CREATE TABLE domains (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE);
CREATE TABLE sites (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, area TEXT NOT NULL);
CREATE TABLE equipment (
 id TEXT PRIMARY KEY NOT NULL, site_id TEXT NOT NULL REFERENCES sites(id),
 designation TEXT NOT NULL, equipment_type TEXT NOT NULL,
 operational_asset_id TEXT, parent_id TEXT REFERENCES equipment(id),
 manufacturer TEXT, model TEXT, serial_number TEXT,
 commissioned_on TEXT, retired_on TEXT,
 UNIQUE(site_id,designation), UNIQUE(id,site_id)
);
CREATE TABLE sources (
 id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, source_kind TEXT NOT NULL
 CHECK(source_kind IN ('file','database','api','manual','scada')),
 reference TEXT NOT NULL, owner TEXT, source_timezone TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','mapped','connected','retired'))
);
CREATE TABLE import_batches (
 id TEXT PRIMARY KEY NOT NULL, source_id TEXT NOT NULL REFERENCES sources(id),
 source_revision TEXT NOT NULL, imported_at_utc TEXT NOT NULL,
 sha256 TEXT, status TEXT NOT NULL CHECK(status IN ('staged','validated','imported','rejected')),
 accepted_rows INTEGER NOT NULL DEFAULT 0 CHECK(accepted_rows>=0),
 rejected_rows INTEGER NOT NULL DEFAULT 0 CHECK(rejected_rows>=0),
 UNIQUE(source_id,source_revision)
);
CREATE TABLE series (
 id TEXT PRIMARY KEY NOT NULL, domain_id TEXT NOT NULL REFERENCES domains(id),
 site_id TEXT NOT NULL REFERENCES sites(id), equipment_id TEXT,
 source_id TEXT NOT NULL REFERENCES sources(id), source_tag TEXT NOT NULL,
 metric TEXT NOT NULL, unit TEXT NOT NULL, datum TEXT,
 measurement_kind TEXT NOT NULL CHECK(measurement_kind IN ('instant','interval_total','interval_average','counter')),
 expected_interval_seconds INTEGER CHECK(expected_interval_seconds>0),
 FOREIGN KEY(equipment_id,site_id) REFERENCES equipment(id,site_id),
 CHECK(metric NOT IN ('water_level','forebay_level','tailwater_level') OR length(trim(datum))>0 AND datum IS NOT NULL),
 UNIQUE(source_id,source_tag)
);
CREATE TABLE observations (
 series_id TEXT NOT NULL REFERENCES series(id),
 observed_at_utc TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%SZ',observed_at_utc) IS NOT NULL AND observed_at_utc=strftime('%Y-%m-%dT%H:%M:%SZ',observed_at_utc)),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
 value REAL, quality TEXT NOT NULL CHECK(quality IN ('good','estimated','suspect','missing','rejected','unreviewed')),
 record_kind TEXT NOT NULL DEFAULT 'observed' CHECK(record_kind IN ('observed','forecast')),
 issued_at_utc TEXT NOT NULL DEFAULT '',
 interval_seconds INTEGER CHECK(interval_seconds>0),
 batch_id TEXT NOT NULL REFERENCES import_batches(id), source_row TEXT NOT NULL,
 received_at_utc TEXT NOT NULL,
 CHECK(value IS NOT NULL OR quality IN ('missing','rejected')),
 CHECK(value IS NULL OR quality NOT IN ('missing','rejected')),
 CHECK((record_kind='observed' AND issued_at_utc='') OR
 (record_kind='forecast' AND strftime('%Y-%m-%dT%H:%M:%SZ',issued_at_utc) IS NOT NULL AND issued_at_utc=strftime('%Y-%m-%dT%H:%M:%SZ',issued_at_utc))),
 PRIMARY KEY(series_id,observed_at_utc,record_kind,issued_at_utc,revision)
);
CREATE INDEX observations_time ON observations(observed_at_utc,series_id);
CREATE VIEW current_observations AS
 SELECT o.* FROM observations o WHERE o.revision=(SELECT max(n.revision) FROM observations n
 WHERE n.series_id=o.series_id AND n.observed_at_utc=o.observed_at_utc
 AND n.record_kind=o.record_kind AND n.issued_at_utc=o.issued_at_utc);
CREATE TABLE runtime_intervals (
 id TEXT PRIMARY KEY NOT NULL, equipment_id TEXT NOT NULL REFERENCES equipment(id),
 started_at_utc TEXT NOT NULL, ended_at_utc TEXT,
 state TEXT NOT NULL CHECK(state IN ('running','stopped','unavailable','unknown')),
 batch_id TEXT NOT NULL REFERENCES import_batches(id), source_row TEXT NOT NULL,
 quality TEXT NOT NULL CHECK(quality IN ('good','estimated','suspect','unreviewed')),
 CHECK(strftime('%Y-%m-%dT%H:%M:%SZ',started_at_utc) IS NOT NULL AND started_at_utc=strftime('%Y-%m-%dT%H:%M:%SZ',started_at_utc)),
 CHECK(ended_at_utc IS NULL OR (strftime('%Y-%m-%dT%H:%M:%SZ',ended_at_utc) IS NOT NULL AND ended_at_utc=strftime('%Y-%m-%dT%H:%M:%SZ',ended_at_utc) AND ended_at_utc>started_at_utc)),
 UNIQUE(batch_id,source_row)
);
CREATE INDEX runtime_equipment_time ON runtime_intervals(equipment_id,started_at_utc);
CREATE TABLE generator_specs (
 equipment_id TEXT NOT NULL REFERENCES equipment(id), revision INTEGER NOT NULL CHECK(revision>=1),
 effective_from TEXT NOT NULL, rated_mw REAL CHECK(rated_mw>0),
 rated_mva REAL CHECK(rated_mva>0), rated_voltage_kv REAL CHECK(rated_voltage_kv>0),
 rated_speed_rpm REAL CHECK(rated_speed_rpm>0), turbine_type TEXT,
 source_id TEXT NOT NULL REFERENCES sources(id), source_ref TEXT NOT NULL,
 PRIMARY KEY(equipment_id,revision)
);
CREATE TABLE operation_links (
 id TEXT PRIMARY KEY NOT NULL, site_id TEXT NOT NULL REFERENCES sites(id), equipment_id TEXT,
 record_type TEXT NOT NULL CHECK(record_type IN ('logbook','outage','alarm','daily_report','maintenance','inspection','work_order')),
 source_id TEXT NOT NULL REFERENCES sources(id), external_record_id TEXT NOT NULL,
 occurred_at_utc TEXT NOT NULL, summary TEXT NOT NULL,
 FOREIGN KEY(equipment_id,site_id) REFERENCES equipment(id,site_id),
 UNIQUE(source_id,record_type,external_record_id)
);
CREATE TABLE fish_surveys (
 id TEXT PRIMARY KEY NOT NULL, site_id TEXT NOT NULL REFERENCES sites(id), reach TEXT NOT NULL,
 started_at_utc TEXT NOT NULL, ended_at_utc TEXT, method TEXT NOT NULL,
 effort_value REAL CHECK(effort_value>0), effort_unit TEXT,
 latitude REAL CHECK(latitude BETWEEN -90 AND 90), longitude REAL CHECK(longitude BETWEEN -180 AND 180),
 batch_id TEXT NOT NULL REFERENCES import_batches(id), source_row TEXT NOT NULL,
 CHECK((effort_value IS NULL AND effort_unit IS NULL) OR (effort_value IS NOT NULL AND length(trim(effort_unit))>0 AND effort_unit IS NOT NULL)),
 CHECK((latitude IS NULL)=(longitude IS NULL)),
 UNIQUE(batch_id,source_row)
);
CREATE TABLE fish_observations (
 id TEXT PRIMARY KEY NOT NULL, survey_id TEXT NOT NULL REFERENCES fish_surveys(id),
 species TEXT NOT NULL, life_stage TEXT, spawning_stage TEXT,
 measure TEXT NOT NULL CHECK(measure IN ('fish_count','redd_count','egg_count','presence')),
 count INTEGER CHECK(count IS NULL OR (count>=0 AND typeof(count)='integer')),
 presence TEXT CHECK(presence IN ('present','absent','unknown')),
 quality TEXT NOT NULL CHECK(quality IN ('good','estimated','suspect','unreviewed')),
 notes TEXT,
 CHECK((measure='presence' AND presence IS NOT NULL AND count IS NULL) OR (measure<>'presence' AND count IS NOT NULL AND presence IS NULL))
);
CREATE TABLE environmental_windows (
 id TEXT PRIMARY KEY NOT NULL, site_id TEXT NOT NULL REFERENCES sites(id), reach TEXT NOT NULL,
 species TEXT NOT NULL, starts_on TEXT NOT NULL, ends_on TEXT NOT NULL,
 purpose TEXT NOT NULL, source_id TEXT NOT NULL REFERENCES sources(id), source_ref TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','reviewed','retired')),
 reviewer TEXT, reviewed_at_utc TEXT,
 CHECK(ends_on>=starts_on),
 CHECK(status<>'reviewed' OR (reviewer IS NOT NULL AND length(trim(reviewer))>0 AND reviewed_at_utc IS NOT NULL))
);
CREATE TABLE source_mappings (
 source_id TEXT NOT NULL REFERENCES sources(id), external_kind TEXT NOT NULL,
 external_id TEXT NOT NULL, site_id TEXT NOT NULL REFERENCES sites(id), equipment_id TEXT,
 status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','reviewed','rejected')),
 notes TEXT, FOREIGN KEY(equipment_id,site_id) REFERENCES equipment(id,site_id),
 PRIMARY KEY(source_id,external_kind,external_id)
);
CREATE TRIGGER observation_source_check BEFORE INSERT ON observations BEGIN
 SELECT CASE WHEN (SELECT source_id FROM series WHERE id=NEW.series_id)<>
 (SELECT source_id FROM import_batches WHERE id=NEW.batch_id)
 THEN RAISE(ABORT,'Observation source does not match import batch') END;
 SELECT CASE WHEN (SELECT measurement_kind FROM series WHERE id=NEW.series_id) IN ('interval_total','interval_average')
 AND NEW.interval_seconds IS NULL THEN RAISE(ABORT,'Interval measurement requires duration') END;
END;
CREATE TRIGGER observation_no_update BEFORE UPDATE ON observations BEGIN
 SELECT RAISE(ABORT,'Append a new observation revision instead');
END;
CREATE TRIGGER observation_no_delete BEFORE DELETE ON observations BEGIN
 SELECT RAISE(ABORT,'Observation history is append only');
END;
CREATE TRIGGER runtime_no_overlap BEFORE INSERT ON runtime_intervals BEGIN
 SELECT CASE WHEN EXISTS (SELECT 1 FROM runtime_intervals r WHERE r.equipment_id=NEW.equipment_id
 AND (NEW.ended_at_utc IS NULL OR r.started_at_utc<NEW.ended_at_utc)
 AND (r.ended_at_utc IS NULL OR NEW.started_at_utc<r.ended_at_utc))
 THEN RAISE(ABORT,'Overlapping runtime intervals require reconciliation') END;
END;
CREATE TRIGGER runtime_update_no_overlap BEFORE UPDATE ON runtime_intervals BEGIN
 SELECT CASE WHEN EXISTS (SELECT 1 FROM runtime_intervals r WHERE r.id<>OLD.id AND r.equipment_id=NEW.equipment_id
 AND (NEW.ended_at_utc IS NULL OR r.started_at_utc<NEW.ended_at_utc)
 AND (r.ended_at_utc IS NULL OR NEW.started_at_utc<r.ended_at_utc))
 THEN RAISE(ABORT,'Overlapping runtime intervals require reconciliation') END;
END;
