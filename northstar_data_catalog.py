"""Controlled intake catalog for operational source collections.

This module records source-file provenance without treating imported material as
live telemetry, approved procedure, or an equipment-command surface. Raw bytes
remain in their controlled source location; the catalog exposes only operator-
safe metadata and integrity information.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import northstar_events as events


from northstar_paths import app_root

ROOT = app_root(__file__)
DATA = ROOT / "data"
UPLOAD_ROOT = Path(os.environ.get("NORTHSTAR_OPERATIONS_UPLOAD_ROOT", Path.home() / "Downloads"))
MAX_ARTIFACTS = 10_000
MAX_RESULTS = 200
MAX_PAGE_SIZE = 500

WATER_ROWS_SCHEMA = """
CREATE TABLE IF NOT EXISTS water_source_files (
    id TEXT PRIMARY KEY,
    relative_path TEXT NOT NULL UNIQUE,
    sha256 TEXT NOT NULL,
    byte_count INTEGER NOT NULL,
    row_count INTEGER NOT NULL,
    headers_json TEXT NOT NULL,
    source_modified_at TEXT NOT NULL DEFAULT '',
    imported_at TEXT NOT NULL,
    status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS water_source_rows (
    file_id TEXT NOT NULL REFERENCES water_source_files(id) ON DELETE CASCADE,
    row_number INTEGER NOT NULL,
    values_json TEXT NOT NULL,
    PRIMARY KEY(file_id, row_number)
);
CREATE TABLE IF NOT EXISTS water_source_staging_rows (
    run_id TEXT NOT NULL,
    row_number INTEGER NOT NULL,
    values_json TEXT NOT NULL,
    PRIMARY KEY(run_id, row_number)
);
CREATE INDEX IF NOT EXISTS idx_water_source_row_file
    ON water_source_rows(file_id, row_number);
"""

SCHEMA = """
CREATE TABLE IF NOT EXISTS data_catalog_collections (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    domain TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    state TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    source_filename TEXT NOT NULL DEFAULT '',
    source_sha256 TEXT NOT NULL DEFAULT '',
    source_bytes INTEGER,
    source_modified_at TEXT,
    details_json TEXT NOT NULL DEFAULT '{}',
    active_artifact_count INTEGER NOT NULL DEFAULT 0,
    latest_run_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS data_catalog_runs (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    state TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    collection_count INTEGER NOT NULL DEFAULT 0,
    artifact_count INTEGER NOT NULL DEFAULT 0,
    error_text TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS data_catalog_artifacts (
    id TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    filename TEXT NOT NULL,
    extension TEXT NOT NULL DEFAULT '',
    byte_count INTEGER,
    sha256 TEXT NOT NULL DEFAULT '',
    modified_at TEXT,
    origin TEXT NOT NULL,
    status TEXT NOT NULL,
    details_json TEXT NOT NULL DEFAULT '{}',
    first_cataloged_at TEXT NOT NULL,
    last_cataloged_at TEXT NOT NULL,
    last_run_id TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(collection_id, relative_path, sha256, byte_count, modified_at)
);

CREATE INDEX IF NOT EXISTS idx_data_catalog_collection_state
    ON data_catalog_collections(domain, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_catalog_artifact_collection
    ON data_catalog_artifacts(collection_id, active, filename);
CREATE INDEX IF NOT EXISTS idx_data_catalog_runs_completed
    ON data_catalog_runs(completed_at DESC);
"""


def init_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(SCHEMA)
    connection.executescript(WATER_ROWS_SCHEMA)
    columns = {row["name"] for row in connection.execute("PRAGMA table_info(water_source_files)")}
    if "source_modified_at" not in columns:
        connection.execute("ALTER TABLE water_source_files ADD COLUMN source_modified_at TEXT NOT NULL DEFAULT ''")


def ingest_water_csvs(actor: str = "local data intake", *, batch_size: int = 1000) -> dict[str, Any]:
    """Import extracted CSV review sources as exact string rows; preserve source files."""
    import csv
    import northstar_store as store

    root = DATA / "water-management" / "source"
    if not root.is_dir():
        raise FileNotFoundError("Water Management extracted source directory is unavailable")
    batch_size = max(100, min(int(batch_size), 5000))
    files_seen = rows_seen = files_imported = files_skipped = 0
    errors: list[dict[str, str]] = []
    with store._LOCK, store._session() as connection:
        init_schema(connection)
        known = {row["relative_path"]: row for row in connection.execute(
            "SELECT relative_path,sha256,byte_count,row_count,source_modified_at FROM water_source_files"
        )}
    for path in sorted(p for p in root.rglob("*") if p.is_file() and p.suffix.lower() == ".csv"):
        files_seen += 1
        relative = path.relative_to(root).as_posix()
        try:
            stat = path.stat()
            modified = _iso_from_timestamp(stat.st_mtime)
            previous = known.get(relative)
            if previous and previous["byte_count"] == stat.st_size and previous["source_modified_at"] == modified:
                files_skipped += 1
                rows_seen += int(previous["row_count"])
                continue
            digest = _digest_file(path)
            file_id = "water-file-" + hashlib.sha256(relative.encode("utf-8")).hexdigest()[:32]
            with path.open("r", encoding="utf-8-sig", newline="", errors="replace") as stream:
                reader = csv.reader(stream)
                headers = next(reader, [])
                headers_json = json.dumps(headers, ensure_ascii=False, separators=(",", ":"))
                run_id = uuid.uuid4().hex
                row_count = 0
                with store._LOCK, store._session() as connection:
                    init_schema(connection)
                    existing = connection.execute(
                        "SELECT sha256,byte_count,row_count,source_modified_at FROM water_source_files WHERE relative_path=?",
                        (relative,),
                    ).fetchone()
                    if existing and existing["sha256"] == digest and existing["byte_count"] == stat.st_size and existing["source_modified_at"] == modified:
                        files_skipped += 1
                        rows_seen += int(existing["row_count"])
                        continue
                    batch: list[tuple[str, int, str]] = []
                    for row_count, values in enumerate(reader, start=1):
                        batch.append((run_id, row_count, json.dumps(values, ensure_ascii=False, separators=(",", ":"))))
                        if len(batch) >= batch_size:
                            connection.executemany(
                                "INSERT INTO water_source_staging_rows(run_id,row_number,values_json) VALUES(?,?,?)", batch)
                            batch.clear()
                    if batch:
                        connection.executemany(
                            "INSERT INTO water_source_staging_rows(run_id,row_number,values_json) VALUES(?,?,?)", batch)
                    # Publish the complete file in one transaction; a parse or insert error
                    # leaves the previously imported version intact.
                    connection.execute("DELETE FROM water_source_files WHERE relative_path=?", (relative,))
                    connection.execute(
                        "INSERT INTO water_source_files(id,relative_path,sha256,byte_count,row_count,headers_json,source_modified_at,imported_at,status) VALUES(?,?,?,?,?,?,?,?,?)",
                        (file_id, relative, digest, stat.st_size, row_count, headers_json, modified, _now(), "IMPORTED"),
                    )
                    connection.execute(
                        "INSERT INTO water_source_rows(file_id,row_number,values_json) "
                        "SELECT ?,row_number,values_json FROM water_source_staging_rows WHERE run_id=? ORDER BY row_number",
                        (file_id, run_id),
                    )
                    connection.execute("DELETE FROM water_source_staging_rows WHERE run_id=?", (run_id,))
            files_imported += 1
            rows_seen += row_count
        except Exception as error:
            errors.append({"file": relative, "error": _safe_text(f"{type(error).__name__}: {error}", 300)})
    return {"sourceFileCount": files_seen, "importedFileCount": files_imported,
            "unchangedFileCount": files_skipped, "rowCount": rows_seen, "errors": errors,
            "actor": _safe_text(actor, 160)}


def query_water_rows(*, file_id: str = "", query: str = "", cursor: int = 0, limit: int = 100) -> dict[str, Any]:
    """Return a bounded page of exact source cells with stable file/row continuation."""
    import northstar_store as store

    bounded_limit = max(1, min(int(limit), MAX_PAGE_SIZE))
    after = max(0, int(cursor))
    with store._LOCK, store._session() as connection:
        init_schema(connection)
        selected = _safe_text(file_id, 100)
        if not selected:
            raise ValueError("fileId is required")
        file_row = connection.execute("SELECT * FROM water_source_files WHERE id=?", (selected,)).fetchone()
        if not file_row:
            return {"file": None, "rows": [], "nextCursor": None}
        # Cursor is a row number; optional text search is bounded to the selected source file.
        clauses = ["file_id=?", "row_number>?", "values_json LIKE ?"]
        params: list[Any] = [selected, after, f"%{_safe_text(query, 120)}%"]
        rows = connection.execute(
            "SELECT row_number,values_json FROM water_source_rows WHERE " + " AND ".join(clauses)
            + " ORDER BY row_number LIMIT ?", (*params, bounded_limit + 1),
        ).fetchall()
    more = len(rows) > bounded_limit
    rows = rows[:bounded_limit]
    return {"file": {"id": file_row["id"], "relativePath": file_row["relative_path"],
                     "sha256": file_row["sha256"], "rowCount": file_row["row_count"],
                     "headers": json.loads(file_row["headers_json"])},
            "rows": [{"rowNumber": row["row_number"], "values": json.loads(row["values_json"])} for row in rows],
            "nextCursor": rows[-1]["row_number"] if more and rows else None}


def list_water_files(*, query: str = "", cursor: str = "", limit: int = 100) -> dict[str, Any]:
    """Return an operator-safe, bounded file catalog for imported CSV sources."""
    import northstar_store as store

    bounded_limit = max(1, min(int(limit), MAX_PAGE_SIZE))
    after = _safe_text(cursor, 1_500)
    search = _safe_text(query, 200)
    with store._LOCK, store._session() as connection:
        init_schema(connection)
        rows = connection.execute(
            "SELECT id,relative_path,sha256,byte_count,row_count,headers_json,source_modified_at,imported_at "
            "FROM water_source_files WHERE relative_path>? AND relative_path LIKE ? "
            "ORDER BY relative_path LIMIT ?",
            (after, f"%{search}%", bounded_limit + 1),
        ).fetchall()
    more = len(rows) > bounded_limit
    rows = rows[:bounded_limit]
    items = [{"id": row["id"], "relativePath": row["relative_path"], "sha256": row["sha256"],
              "byteCount": row["byte_count"], "rowCount": row["row_count"],
              "headers": json.loads(row["headers_json"]), "sourceModifiedAt": row["source_modified_at"],
              "importedAt": row["imported_at"]} for row in rows]
    return {"files": items, "nextCursor": items[-1]["relativePath"] if more and items else None}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_text(value: object, limit: int = 500) -> str:
    return str(value or "").strip().replace("\x00", "")[:limit]


def _safe_relative(value: object) -> str:
    candidate = _safe_text(value, 1_500).replace("\\", "/").lstrip("/")
    parts = [part for part in candidate.split("/") if part not in {"", ".", ".."}]
    return "/".join(parts)[:1_500]


def _digest_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _iso_from_timestamp(value: float) -> str:
    return datetime.fromtimestamp(value, timezone.utc).isoformat()


def _file_artifact(path: Path, *, relative_path: str, origin: str, status: str,
                   details: dict[str, Any] | None = None, digest: str | None = None) -> dict[str, Any]:
    stat = path.stat()
    relative_path = _safe_relative(relative_path) or path.name
    return {
        "relativePath": relative_path,
        "filename": _safe_text(path.name, 500),
        "extension": path.suffix.lower()[:30],
        "byteCount": int(stat.st_size),
        "sha256": (digest if digest is not None else _digest_file(path)).lower(),
        "modifiedAt": _iso_from_timestamp(stat.st_mtime),
        "origin": origin,
        "status": status,
        "details": details or {},
    }


def _static_artifact(relative_path: str, *, byte_count: int | None, sha256: str = "",
                     origin: str, status: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    safe_path = _safe_relative(relative_path)
    return {
        "relativePath": safe_path,
        "filename": Path(safe_path).name,
        "extension": Path(safe_path).suffix.lower()[:30],
        "byteCount": byte_count if isinstance(byte_count, int) and byte_count >= 0 else None,
        "sha256": _safe_text(sha256, 64).lower(),
        "modifiedAt": None,
        "origin": origin,
        "status": status,
        "details": details or {},
    }


def _artifact_id(collection_id: str, artifact: dict[str, Any]) -> str:
    key = "\0".join(str(artifact.get(field) or "") for field in (
        "relativePath", "sha256", "byteCount", "modifiedAt", "origin"
    ))
    return f"catalog-artifact-{collection_id}-{hashlib.sha256(key.encode('utf-8')).hexdigest()[:24]}"


def _existing_digest(connection: sqlite3.Connection, collection_id: str, path: Path) -> str:
    row = connection.execute(
        "SELECT source_sha256, source_bytes, source_modified_at FROM data_catalog_collections WHERE id=?",
        (collection_id,),
    ).fetchone()
    if not row or not row["source_sha256"] or not path.exists():
        return ""
    stat = path.stat()
    if row["source_bytes"] == stat.st_size and row["source_modified_at"] == _iso_from_timestamp(stat.st_mtime):
        return str(row["source_sha256"])
    return ""


def _source_file(connection: sqlite3.Connection, collection_id: str, path: Path, *, origin: str,
                 status: str, details: dict[str, Any] | None = None) -> tuple[dict[str, Any] | None, str]:
    if not path.is_file():
        return None, ""
    known_digest = _existing_digest(connection, collection_id, path)
    artifact = _file_artifact(
        path,
        relative_path=f"source/{path.name}",
        origin=origin,
        status=status,
        details=details,
        digest=known_digest or None,
    )
    return artifact, artifact["sha256"]


def _water_collection(connection: sqlite3.Connection) -> dict[str, Any]:
    collection_id = "water-management"
    archive = UPLOAD_ROOT / "Water_Management.zip"
    catalog_path = DATA / "water-management" / "catalog.json"
    try:
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        catalog = {}
    artifacts: list[dict[str, Any]] = []
    archive_listing_available = False
    source, digest = _source_file(
        connection, collection_id, archive, origin="original upload", status="RAW_SOURCE",
        details={"readOnly": True},
    )
    if source:
        artifacts.append(source)
        try:
            with zipfile.ZipFile(archive) as bundle:
                for info in bundle.infolist()[:MAX_ARTIFACTS]:
                    if info.is_dir():
                        continue
                    artifacts.append(_static_artifact(
                        info.filename,
                        byte_count=info.file_size,
                        origin="archive entry",
                        status="CATALOGED",
                        details={"compressedBytes": info.compress_size},
                    ))
                archive_listing_available = True
        except (OSError, zipfile.BadZipFile):
            pass
    extracted = DATA / "water-management" / "source"
    if not archive_listing_available and extracted.is_dir():
        for path in sorted(item for item in extracted.rglob("*") if item.is_file())[:MAX_ARTIFACTS]:
            artifacts.append(_file_artifact(
                path,
                relative_path=path.relative_to(extracted).as_posix(),
                origin="controlled extracted review layer",
                status="CATALOGED",
            ))
    return {
        "id": collection_id,
        "title": _safe_text(catalog.get("title") or "Water Management source archive", 240),
        "domain": "WATER_OPERATIONS",
        "sourceKind": "ARCHIVE",
        "state": "CATALOGED" if artifacts else "SOURCE_UNAVAILABLE",
        "description": "Read-only operational water-management source archive and extracted review layer.",
        "sourceFilename": archive.name if source else _safe_text(catalog.get("archiveName"), 240),
        "sourceSha256": digest,
        "sourceBytes": source["byteCount"] if source else None,
        "sourceModifiedAt": source["modifiedAt"] if source else None,
        "details": {
            "catalogEntries": catalog.get("entryCount"),
            "extractedCsvCount": catalog.get("extractedCsvCount"),
            "readOnly": True,
            "originalAvailable": bool(source),
            "archiveListingAvailable": archive_listing_available,
        },
        "artifacts": artifacts,
    }


def _maximo_collection(connection: sqlite3.Connection) -> dict[str, Any]:
    del connection
    collection_id = "maximo-equipment-master"
    workbook = DATA / "maximo" / "sources" / "87438723.xlsx"
    snapshot_path = DATA / "maximo" / "equipment-master.json"
    artifacts: list[dict[str, Any]] = []
    if workbook.is_file():
        artifacts.append(_file_artifact(workbook, relative_path=f"source/{workbook.name}", origin="original upload", status="RAW_SOURCE"))
    try:
        snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        snapshot = {}
    if snapshot_path.is_file():
        artifacts.append(_file_artifact(
            snapshot_path,
            relative_path=f"normalized/{snapshot_path.name}",
            origin="normalized read-only snapshot",
            status="DERIVED",
            details={"recordCount": (snapshot.get("source") or {}).get("recordCount")},
        ))
    source = snapshot.get("source") or {}
    return {
        "id": collection_id,
        "title": "Maximo equipment master",
        "domain": "ASSET_OPERATIONS",
        "sourceKind": "WORKBOOK",
        "state": "CATALOGED" if artifacts else "SOURCE_UNAVAILABLE",
        "description": "Read-only Maximo equipment source with a normalized local snapshot.",
        "sourceFilename": _safe_text(source.get("filename") or workbook.name, 240),
        "sourceSha256": _safe_text(source.get("sha256"), 64),
        "sourceBytes": workbook.stat().st_size if workbook.is_file() else None,
        "sourceModifiedAt": _iso_from_timestamp(workbook.stat().st_mtime) if workbook.is_file() else None,
        "details": {"assetCount": (snapshot.get("summary") or {}).get("assetCount"), "sourceSheet": source.get("sheetName")},
        "artifacts": artifacts,
    }


def _legacy_sop_collection(connection: sqlite3.Connection) -> dict[str, Any]:
    del connection
    collection_id = "firstlight-legacy-sops"
    root = DATA / "controlled-sources" / "firstlight-legacy-sops"
    try:
        manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        manifest = {}
    artifacts = []
    for document in manifest.get("documents", [])[:MAX_ARTIFACTS]:
        if not isinstance(document, dict):
            continue
        relative = _safe_relative(document.get("relativePath"))
        if not relative:
            continue
        artifacts.append(_static_artifact(
            relative,
            byte_count=document.get("bytes"),
            sha256=document.get("sha256", ""),
            origin="controlled legacy reference",
            status="LEGACY_REFERENCE",
            details={
                "procedureCode": _safe_text(document.get("procedureCode"), 160),
                "revision": _safe_text(document.get("revision"), 160),
                "language": _safe_text(document.get("language"), 80),
            },
        ))
    return {
        "id": collection_id,
        "title": _safe_text(manifest.get("sourceName") or "FirstLight legacy SOP library", 240),
        "domain": "PROCEDURES",
        "sourceKind": "DOCUMENT_LIBRARY",
        "state": "LEGACY_REFERENCE" if artifacts else "SOURCE_UNAVAILABLE",
        "description": "Private legacy SOP reference library; owner, revision, and applicability require review.",
        "sourceFilename": _safe_text(manifest.get("sourceArchive"), 240),
        "sourceSha256": _safe_text(manifest.get("sourceArchiveSha256"), 64),
        "sourceBytes": None,
        "sourceModifiedAt": _safe_text(manifest.get("importedAt"), 80) or None,
        "details": {"documentCount": len(artifacts), "status": _safe_text(manifest.get("status"), 80)},
        "artifacts": artifacts,
    }


def _directive_collection(connection: sqlite3.Connection) -> dict[str, Any]:
    del connection
    collection_id = "operating-directives"
    names = (
        "H2O Northwest Operating Directives (1).xlsx",
        "West Operation Station Information.docx",
        "East Operations Station Infomation.pdf",
    )
    artifacts = []
    for name in names:
        path = UPLOAD_ROOT / name
        if path.is_file():
            artifacts.append(_file_artifact(path, relative_path=f"source/{name}", origin="original upload", status="RAW_SOURCE"))
    return {
        "id": collection_id,
        "title": "Operating directives and station information",
        "domain": "OPERATIONS_REFERENCE",
        "sourceKind": "WORKBOOK_AND_DOCUMENTS",
        "state": "CATALOGED" if artifacts else "SOURCE_UNAVAILABLE",
        "description": "Operation-origin directives retained as reference notes; not an approval or release surface.",
        "sourceFilename": "H2O Northwest Operating Directives and station information",
        "sourceSha256": "",
        "sourceBytes": sum(int(item["byteCount"] or 0) for item in artifacts) or None,
        "sourceModifiedAt": max((item["modifiedAt"] for item in artifacts), default=None),
        "details": {"sourceFilesExpected": len(names), "sourceFilesAvailable": len(artifacts)},
        "artifacts": artifacts,
    }


def _known_collections(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    return [
        _water_collection(connection),
        _maximo_collection(connection),
        _directive_collection(connection),
        _legacy_sop_collection(connection),
    ]


def _save_collection(connection: sqlite3.Connection, record: dict[str, Any], run_id: str, actor: str, at: str) -> int:
    collection_id = record["id"]
    connection.execute("UPDATE data_catalog_artifacts SET active=0 WHERE collection_id=?", (collection_id,))
    count = 0
    for artifact in record["artifacts"]:
        artifact_id = _artifact_id(collection_id, artifact)
        details = json.dumps(artifact.get("details") or {}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        connection.execute(
            "INSERT INTO data_catalog_artifacts (id,collection_id,relative_path,filename,extension,byte_count,sha256,modified_at,origin,status,details_json,first_cataloged_at,last_cataloged_at,last_run_id,active) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1) "
            "ON CONFLICT(id) DO UPDATE SET "
            "filename=excluded.filename,extension=excluded.extension,origin=excluded.origin,status=excluded.status,details_json=excluded.details_json,last_cataloged_at=excluded.last_cataloged_at,last_run_id=excluded.last_run_id,active=1",
            (artifact_id, collection_id, artifact["relativePath"], artifact["filename"], artifact["extension"], artifact["byteCount"], artifact["sha256"], artifact["modifiedAt"], artifact["origin"], artifact["status"], details, at, at, run_id),
        )
        count += 1
    details = json.dumps(record.get("details") or {}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    connection.execute(
        "INSERT INTO data_catalog_collections (id,title,domain,source_kind,state,description,source_filename,source_sha256,source_bytes,source_modified_at,details_json,active_artifact_count,latest_run_id,created_at,updated_at,updated_by) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT(id) DO UPDATE SET title=excluded.title,domain=excluded.domain,source_kind=excluded.source_kind,state=excluded.state,description=excluded.description,source_filename=excluded.source_filename,source_sha256=excluded.source_sha256,source_bytes=excluded.source_bytes,source_modified_at=excluded.source_modified_at,details_json=excluded.details_json,active_artifact_count=excluded.active_artifact_count,latest_run_id=excluded.latest_run_id,updated_at=excluded.updated_at,updated_by=excluded.updated_by",
        (collection_id, record["title"], record["domain"], record["sourceKind"], record["state"], record["description"], record["sourceFilename"], record["sourceSha256"], record["sourceBytes"], record["sourceModifiedAt"], details, count, run_id, at, at, actor),
    )
    return count


def refresh_known_sources(actor: str) -> dict[str, Any]:
    """Catalog the known source collections without copying or altering their bytes."""
    import northstar_store as store

    actor = _safe_text(actor, 160) or "operator console"
    run_id, started = f"catalog-run-{uuid.uuid4().hex}", _now()
    with store._LOCK, store._session() as connection:
        init_schema(connection)
        connection.execute(
            "INSERT INTO data_catalog_runs (id,started_at,state,actor_id) VALUES (?,?,?,?)",
            (run_id, started, "RUNNING", actor),
        )
        try:
            collections = _known_collections(connection)
            artifact_count = sum(_save_collection(connection, item, run_id, actor, started) for item in collections)
            completed = _now()
            connection.execute(
                "UPDATE data_catalog_runs SET completed_at=?,state=?,collection_count=?,artifact_count=? WHERE id=?",
                (completed, "COMPLETED", len(collections), artifact_count, run_id),
            )
            events.append_event(
                connection,
                event_type="data_catalog.intake.completed",
                occurred_at=completed,
                actor_id=actor,
                aggregate_type="data_catalog_run",
                aggregate_id=run_id,
                source="data_catalog",
                summary=f"Cataloged {len(collections)} operation data collections",
                payload={"collectionCount": len(collections), "artifactCount": artifact_count, "readOnly": True},
            )
        except Exception as error:
            connection.execute(
                "UPDATE data_catalog_runs SET completed_at=?,state=?,error_text=? WHERE id=?",
                (_now(), "FAILED", _safe_text(f"{type(error).__name__}: {error}", 1_000), run_id),
            )
            raise
    return snapshot()


def _json_object(value: object) -> dict[str, Any]:
    try:
        parsed = json.loads(str(value or "{}"))
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def snapshot(query: str = "", collection_id: str = "", limit: int = 100, cursor: str = "") -> dict[str, Any]:
    """Return operator-safe metadata only; no local paths or source bytes are exposed."""
    import northstar_store as store

    search = _safe_text(query, 200).lower()
    selected = _safe_text(collection_id, 120)
    try:
        bounded_limit = max(1, min(int(limit), MAX_RESULTS))
    except (TypeError, ValueError):
        bounded_limit = 100
    after = _safe_text(cursor, 160)
    with store._LOCK, store._session() as connection:
        init_schema(connection)
        collections = connection.execute(
            "SELECT * FROM data_catalog_collections ORDER BY domain,title"
        ).fetchall()
        latest = connection.execute(
            "SELECT * FROM data_catalog_runs ORDER BY started_at DESC LIMIT 1"
        ).fetchone()
        artifact_rows: Iterable[sqlite3.Row] = []
        if selected:
            artifact_rows = connection.execute(
                "SELECT * FROM data_catalog_artifacts WHERE collection_id=? AND active=1 AND (filename>? OR (filename=? AND id>?)) ORDER BY filename,id LIMIT ?",
                (selected, after.split("\0", 1)[0], after.split("\0", 1)[0], after.split("\0", 1)[1] if "\0" in after else "", bounded_limit + 1),
            ).fetchall()
            has_more = len(artifact_rows) > bounded_limit
            artifact_rows = list(artifact_rows[:bounded_limit])
        else:
            has_more = False
    result_collections = []
    for row in collections:
        value = {
            "id": row["id"], "title": row["title"], "domain": row["domain"], "sourceKind": row["source_kind"],
            "state": row["state"], "description": row["description"], "sourceFilename": row["source_filename"],
            "sourceSha256": row["source_sha256"], "sourceBytes": row["source_bytes"], "sourceModifiedAt": row["source_modified_at"],
            "details": _json_object(row["details_json"]), "artifactCount": row["active_artifact_count"],
            "updatedAt": row["updated_at"], "updatedBy": row["updated_by"],
        }
        haystack = " ".join(str(item) for item in (value["title"], value["domain"], value["sourceKind"], value["state"], value["description"], value["sourceFilename"])) .lower()
        if not search or search in haystack:
            result_collections.append(value)
    artifacts = [{
        "id": row["id"], "collectionId": row["collection_id"], "relativePath": row["relative_path"],
        "filename": row["filename"], "extension": row["extension"], "byteCount": row["byte_count"],
        "sha256": row["sha256"], "modifiedAt": row["modified_at"], "origin": row["origin"],
        "status": row["status"], "details": _json_object(row["details_json"]),
        "catalogedAt": row["last_cataloged_at"],
    } for row in artifact_rows]
    return {
        "note": "Metadata catalog only. Raw source files are not copied, altered, or served by this API.",
        "collections": result_collections,
        "artifacts": artifacts,
        "nextCursor": (artifacts[-1]["filename"] + "\0" + artifacts[-1]["id"]) if has_more and artifacts else None,
        "selectedCollectionId": selected,
        "latestRun": ({
            "id": latest["id"], "startedAt": latest["started_at"], "completedAt": latest["completed_at"],
            "state": latest["state"], "actorId": latest["actor_id"], "collectionCount": latest["collection_count"],
            "artifactCount": latest["artifact_count"], "error": latest["error_text"],
        } if latest else None),
        "summary": {
            "collectionCount": len(result_collections),
            "artifactCount": sum(int(item["artifactCount"] or 0) for item in result_collections),
            "catalogReady": bool(collections),
        },
    }
