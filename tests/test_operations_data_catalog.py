import hashlib
import json
import zipfile

import pytest

import northstar_data_catalog as catalog
import northstar_store as store


@pytest.fixture
def catalog_sources(tmp_path, monkeypatch):
    data = tmp_path / "data"
    uploads = tmp_path / "uploads"
    data.mkdir()
    uploads.mkdir()
    monkeypatch.setattr(store, "DB_PATH", data / "northstar.db")
    monkeypatch.setattr(catalog, "DATA", data)
    monkeypatch.setattr(catalog, "UPLOAD_ROOT", uploads)

    with store._session() as connection:
        connection.executescript(store.SCHEMA)
        catalog.init_schema(connection)

    water = uploads / "Water_Management.zip"
    with zipfile.ZipFile(water, "w") as archive:
        archive.writestr("DATA/hourly-flow.csv", "at,flow\n2026-09-16T00:00:00Z,10\n")
        archive.writestr("Dam_Config/gates.xlsx", b"workbook fixture")
    water_catalog = data / "water-management"
    water_catalog.mkdir(parents=True)
    (water_catalog / "catalog.json").write_text(json.dumps({
        "title": "Water Management source catalog", "archiveName": water.name,
        "entryCount": 2, "extractedCsvCount": 1,
    }), encoding="utf-8")

    maximo = data / "maximo"
    (maximo / "sources").mkdir(parents=True)
    workbook = maximo / "sources" / "87438723.xlsx"
    workbook.write_bytes(b"maximo workbook fixture")
    (maximo / "equipment-master.json").write_text(json.dumps({
        "source": {"filename": workbook.name, "sha256": hashlib.sha256(workbook.read_bytes()).hexdigest(), "recordCount": 2, "sheetName": "List of Assets"},
        "summary": {"assetCount": 2},
    }), encoding="utf-8")

    sop_root = data / "controlled-sources" / "firstlight-legacy-sops"
    sop_root.mkdir(parents=True)
    (sop_root / "manifest.json").write_text(json.dumps({
        "sourceName": "FirstLight legacy SOP library", "sourceArchive": "legacy.zip",
        "sourceArchiveSha256": "a" * 64, "status": "LEGACY_REFERENCE", "documents": [{
            "relativePath": "ENGLISH/test.pdf", "bytes": 12, "sha256": "b" * 64,
            "procedureCode": "FLC-1", "revision": "R1", "language": "English",
        }],
    }), encoding="utf-8")

    for name in (
        "H2O Northwest Operating Directives (1).xlsx",
        "West Operation Station Information.docx",
        "East Operations Station Infomation.pdf",
    ):
        (uploads / name).write_bytes(name.encode("utf-8"))
    return data


def test_refresh_catalogs_known_collections_without_exposing_local_paths(catalog_sources):
    result = catalog.refresh_known_sources("test operator")
    assert result["summary"] == {"collectionCount": 4, "artifactCount": 9, "catalogReady": True}
    assert result["latestRun"]["state"] == "COMPLETED"
    assert {row["id"] for row in result["collections"]} == {
        "water-management", "maximo-equipment-master", "operating-directives", "firstlight-legacy-sops",
    }
    assert "uploads" not in json.dumps(result).lower()

    water = catalog.snapshot(collection_id="water-management")
    assert len(water["artifacts"]) == 3
    water_collection = next(row for row in water["collections"] if row["id"] == "water-management")
    assert water_collection["sourceSha256"] == hashlib.sha256(
        (catalog.UPLOAD_ROOT / "Water_Management.zip").read_bytes()
    ).hexdigest()
    assert {item["origin"] for item in water["artifacts"]} == {"original upload", "archive entry"}

    with store._session() as connection:
        event = connection.execute(
            "SELECT event_type, source, aggregate_type FROM audit_events WHERE source='data_catalog'"
        ).fetchone()
    assert tuple(event) == ("data_catalog.intake.completed", "data_catalog", "data_catalog_run")


def test_repeat_refresh_keeps_one_active_version_per_artifact(catalog_sources):
    first = catalog.refresh_known_sources("test operator")
    second = catalog.refresh_known_sources("test operator")
    assert first["summary"]["artifactCount"] == second["summary"]["artifactCount"] == 9
    with store._session() as connection:
        active = connection.execute(
            "SELECT COUNT(*) FROM data_catalog_artifacts WHERE active=1"
        ).fetchone()[0]
    assert active == 9


def test_snapshot_searches_collection_metadata(catalog_sources):
    catalog.refresh_known_sources("test operator")
    result = catalog.snapshot(query="maximo")
    assert [row["id"] for row in result["collections"]] == ["maximo-equipment-master"]
    assert result["artifacts"] == []


def test_water_csv_ingestion_is_idempotent_and_paged(catalog_sources):
    source_root = catalog.DATA / "water-management" / "source"
    source_root.mkdir(parents=True)
    (source_root / "series.csv").write_text(
        "Timestamp,Value,Units\n2025-01-01T00:00:00Z,1.2,m\n2025-01-02T00:00:00Z,1.3,m\n",
        encoding="utf-8",
    )
    first = catalog.ingest_water_csvs(batch_size=100)
    second = catalog.ingest_water_csvs(batch_size=100)
    assert first["importedFileCount"] == 1 and first["rowCount"] == 2
    assert second["unchangedFileCount"] == 1

    with store._session() as connection:
        record = connection.execute("SELECT id FROM water_source_files").fetchone()
    inventory = catalog.list_water_files(limit=1)
    assert len(inventory["files"]) == 1 and inventory["nextCursor"] is None
    page = catalog.query_water_rows(file_id=record["id"], limit=1)
    assert page["file"]["headers"] == ["Timestamp", "Value", "Units"]
    assert page["rows"][0]["values"] == ["2025-01-01T00:00:00Z", "1.2", "m"]
    assert page["nextCursor"] == 1
    next_page = catalog.query_water_rows(file_id=record["id"], cursor=page["nextCursor"], limit=1)
    assert next_page["rows"][0]["rowNumber"] == 2
    assert next_page["nextCursor"] is None


def test_catalog_artifacts_use_continuation_cursor(catalog_sources):
    catalog.refresh_known_sources("test operator")
    with store._session() as connection:
        for name in ("a.csv", "b.csv", "c.csv"):
            connection.execute(
                "INSERT INTO data_catalog_artifacts "
                "(id,collection_id,relative_path,filename,extension,byte_count,sha256,modified_at,origin,status,details_json,first_cataloged_at,last_cataloged_at,last_run_id,active) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)",
                ("id-" + name, "water-management", name, name, ".csv", 1, "", None, "fixture", "CATALOGED", "{}", "now", "now", "run"),
            )
    first = catalog.snapshot(collection_id="water-management", limit=2)
    assert [item["filename"] for item in first["artifacts"]] == ["Water_Management.zip", "a.csv"]
    assert first["nextCursor"].startswith("a.csv\0")
    second = catalog.snapshot(collection_id="water-management", limit=2, cursor=first["nextCursor"])
    assert [item["filename"] for item in second["artifacts"]] == ["b.csv", "c.csv"]
