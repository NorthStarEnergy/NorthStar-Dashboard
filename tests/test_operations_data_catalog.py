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
