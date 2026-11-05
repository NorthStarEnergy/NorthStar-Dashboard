"""Controlled local operator knowledge: immutable sources, FTS, and live record projections.

Originals and the derived search index stay inside the protected NorthStar database/data
boundary. No filesystem crawl, arbitrary SQL table enumeration, or automatic approval.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import mimetypes
import os
import posixpath
import re
import sqlite3
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote
from xml.etree import ElementTree

import northstar_events as events
import northstar_sites as sites
import northstar_store as store

VERSION = 3
MAX_BYTES = 5 * 1024 * 1024
STATUSES = {"PENDING_REVIEW", "CURRENT_CONTROLLED", "REFERENCE_ONLY", "LEGACY_REFERENCE", "SUPERSEDED", "WITHDRAWN"}
SUFFIXES = {".pdf", ".txt", ".md", ".csv", ".docx", ".xlsx", ".xlsm"}
_READY: set[str] = set()
_SECRET = re.compile(r"(?im)([\"']?[\w-]*(?:api[_-]?key|token|secret|password|credential|authorization)[\"']?\s*[:=]\s*)(?:\"[^\"]*\"|'[^']*'|[^\s,}\]]+)")
SCHEMA = """
CREATE TABLE IF NOT EXISTS operator_knowledge_sources (
 id TEXT PRIMARY KEY, source_key TEXT NOT NULL, title TEXT NOT NULL, site_id TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL, revision TEXT NOT NULL DEFAULT '', owner TEXT NOT NULL DEFAULT '',
 effective_from TEXT NOT NULL DEFAULT '', effective_to TEXT NOT NULL DEFAULT '', review_due TEXT NOT NULL DEFAULT '',
 approved_by TEXT NOT NULL DEFAULT '', approved_at TEXT NOT NULL DEFAULT '',
 sha256 TEXT NOT NULL, file_path TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL DEFAULT '',
 source_url TEXT NOT NULL DEFAULT '', source_type TEXT NOT NULL DEFAULT 'uploaded',
 created_at TEXT NOT NULL, created_by TEXT NOT NULL, index_state TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0,
 UNIQUE(source_key, sha256, revision)
);
CREATE INDEX IF NOT EXISTS idx_operator_knowledge_scope ON operator_knowledge_sources(status,site_id);
CREATE TABLE IF NOT EXISTS operator_knowledge_chunks (
 id INTEGER PRIMARY KEY, source_id TEXT NOT NULL REFERENCES operator_knowledge_sources(id),
 ordinal INTEGER NOT NULL, page INTEGER, section TEXT NOT NULL, text TEXT NOT NULL,
 UNIQUE(source_id,ordinal)
);
CREATE VIRTUAL TABLE IF NOT EXISTS operator_knowledge_fts USING fts5(title,text,tokenize='unicode61');
CREATE TABLE IF NOT EXISTS operator_knowledge_reviews (
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL,
 previous_status TEXT NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL, metadata TEXT NOT NULL
);
"""


class KnowledgeDenied(PermissionError):
    pass


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def redact(text: str) -> str:
    text = _SECRET.sub(r"\1[REDACTED]", text)
    return re.sub(r"\b(?:sk-proj-|sk-|rk-|sk_|rk_|sess_)[A-Za-z0-9_-]+", "[REDACTED]", text)


def _ensure() -> None:
    key = str(store.DB_PATH.resolve())
    with store._LOCK:
        if key in _READY and store.DB_PATH.exists():
            return
        if not store.DB_PATH.exists():
            store.init_db()
        with store._session() as con:
            con.executescript(SCHEMA)
        _READY.add(key)


def _site(value: object) -> str:
    value = str(value or "").strip()
    if not value:
        return ""
    found = sites.resolve(value)
    if not found:
        raise ValueError("Choose a known NorthStar plant or System / transmission")
    return found["id"]


def allowed_sites(actor: str) -> list[str] | None:
    """Optional server-owned site policy; current operator role otherwise sees all sites.

    Setting NORTHSTAR_AI_SITE_ACCESS activates deny-by-default mappings. Malformed
    policy fails closed, and a client-supplied actor never reaches this function.
    """
    raw = os.environ.get("NORTHSTAR_AI_SITE_ACCESS", "").strip()
    if not raw:
        return None
    try:
        policy = json.loads(raw)
        values = policy.get(actor, policy.get("*", []))
        if not isinstance(values, list):
            raise ValueError()
        return sorted({_site(value) for value in values if str(value).strip()})
    except (ValueError, TypeError, AttributeError):
        raise KnowledgeDenied("Knowledge site-access policy is invalid") from None


def access(actor: str, site_id: object = "") -> tuple[str, list[str] | None]:
    selected = _site(site_id)
    allowed = allowed_sites(actor)
    if allowed is not None and (not allowed or selected and selected not in allowed):
        raise KnowledgeDenied("This operator cannot access the selected knowledge scope")
    return selected, allowed


def _scope_sql(selected: str, allowed: list[str] | None, prefix: str = "") -> tuple[str, list[str]]:
    column = prefix + "site_id"
    if selected:
        return f" AND {column} IN ('',?)", [selected]
    if allowed is not None:
        return f" AND {column} IN ('', {','.join('?' for _ in allowed)})", allowed
    return "", []


def _date(value: object) -> str:
    value = str(value or "").strip()
    if value:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            value = parsed.astimezone(timezone.utc).isoformat()
        except ValueError:
            raise ValueError("Dates must use ISO format YYYY-MM-DD or a timestamp") from None
    return value


def _path(value: str) -> Path:
    root = (store.DB_PATH.parent / "controlled-sources" / "operator-knowledge").resolve()
    candidate = (root / value).resolve()
    if candidate.parent != root or not value or candidate.suffix.lower() not in SUFFIXES:
        raise ValueError("Invalid controlled knowledge file")
    return candidate


_XLSX_MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_XLSX_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
_PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"


def _excel_column(reference: str) -> int:
    index = 0
    for char in reference:
        if not char.isalpha():
            break
        index = index * 26 + ord(char.upper()) - ord("A") + 1
    return index


def _excel_pages(raw: bytes) -> list[tuple[int | None, str]]:
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            if sum(info.file_size for info in archive.infolist()) > 50 * MAX_BYTES:
                raise ValueError("Workbook expands beyond the intake limit")
            workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
            relationships = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
            targets = {item.get("Id"): item.get("Target", "") for item in relationships.findall(f"{_PKG_REL}Relationship")}
            try:
                shared_root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
                shared = ["".join(item.itertext()) for item in shared_root.findall(f"{_XLSX_MAIN}si")]
            except KeyError:
                shared = []
            sheets = workbook.findall(f"{_XLSX_MAIN}sheets/{_XLSX_MAIN}sheet")
            if not sheets or len(sheets) > 100:
                raise ValueError("Workbook must contain between 1 and 100 worksheets")
            pages = []
            total_cells = 0
            for sheet in sheets:
                target = targets.get(sheet.get(_XLSX_REL + "id"), "")
                path = posixpath.normpath(target.lstrip("/") if target.startswith("/") else posixpath.join("xl", target))
                if not target or not path.startswith("xl/") or path.startswith("xl/../"):
                    raise ValueError("Workbook contains an invalid worksheet reference")
                root = ElementTree.fromstring(archive.read(path))
                lines = [f"Worksheet: {sheet.get('name', 'Sheet')}"]
                for row in root.findall(f".//{_XLSX_MAIN}sheetData/{_XLSX_MAIN}row"):
                    values = {}
                    for cell in row.findall(f"{_XLSX_MAIN}c"):
                        column = _excel_column(cell.get("r", ""))
                        if not column:
                            continue
                        kind = cell.get("t")
                        if kind == "inlineStr":
                            value = "".join(cell.itertext()).strip()
                        else:
                            value = cell.findtext(f"{_XLSX_MAIN}v", default="").strip()
                            if kind == "s":
                                try:
                                    value = shared[int(value)]
                                except (IndexError, ValueError):
                                    raise ValueError("Workbook contains an invalid shared-string reference") from None
                        if value:
                            total_cells += 1
                            if total_cells > 500_000:
                                raise ValueError("Workbook exceeds the 500,000-populated-cell intake limit")
                            values[column] = value
                    if values:
                        lines.append("\t".join(values.get(index, "") for index in range(1, max(values) + 1)))
                pages.append((None, "\n".join(lines)))
            return pages
    except ValueError:
        raise
    except (OSError, zipfile.BadZipFile, KeyError, ElementTree.ParseError):
        raise ValueError("Invalid Excel workbook") from None


def _extract(raw: bytes, suffix: str) -> list[tuple[int | None, str]]:
    if suffix in {".xlsx", ".xlsm"}:
        return _excel_pages(raw)
    if suffix == ".pdf":
        if not raw.startswith(b"%PDF-"):
            raise ValueError("The uploaded PDF has an invalid header")
        try:
            from pypdf import PdfReader
        except ImportError:
            raise ValueError("PDF text extraction is unavailable; upload a UTF-8 text or Markdown transcription") from None
        try:
            reader = PdfReader(io.BytesIO(raw))
            if len(reader.pages) > 500:
                raise ValueError("PDF exceeds the 500-page intake limit")
            return [(number + 1, page.extract_text() or "") for number, page in enumerate(reader.pages)]
        except ValueError:
            raise
        except Exception:
            raise ValueError("PDF could not be read; upload a text transcription") from None
    if suffix == ".docx":
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                info = archive.getinfo("word/document.xml")
                if info.file_size > 10 * MAX_BYTES:
                    raise ValueError("Document expands beyond the intake limit")
                xml = ElementTree.fromstring(archive.read(info))
                text = "\n".join("".join(p.itertext()) for p in xml.iter() if p.tag.endswith("}p"))
                return [(None, text)]
        except (zipfile.BadZipFile, KeyError, ElementTree.ParseError):
            raise ValueError("Invalid Word document") from None
    try:
        return [(None, raw.decode("utf-8-sig"))]
    except UnicodeDecodeError:
        raise ValueError("Text sources must be UTF-8") from None


def _chunks(pages: list[tuple[int | None, str]]):
    ordinal = 0
    for page, body in pages:
        text = redact(body).strip()
        for offset in range(0, len(text), 1600):
            chunk = text[offset:offset + 1800].strip()
            if chunk:
                ordinal += 1
                yield ordinal, page, f"Page {page}" if page else f"Text passage {ordinal}", chunk
                if ordinal >= 2000:
                    raise ValueError("Source exceeds the 2,000-passage intake limit")


def _public(row: Any) -> dict[str, Any]:
    item = dict(row)
    item.pop("file_path", None)
    item["href"] = "/api/ai/knowledge/sources/" + quote(item["id"], safe="")
    item["fileHref"] = item["href"] + "/file" if item["source_type"] == "uploaded" or item["source_type"] == "orientation" else item["source_url"]
    stamp = now()
    item["aiEligible"] = bool(item["status"] == "CURRENT_CONTROLLED" and item["approved_by"] and item["effective_from"] and item["effective_from"] <= stamp and item["review_due"] > stamp and (not item["effective_to"] or item["effective_to"] > stamp))
    item["siteName"] = (sites.resolve(item["site_id"]) or {}).get("name", "Shared / company")
    return item


def catalog(actor: str = "operator", site_id: str = "") -> dict[str, Any]:
    _ensure()
    selected, allowed = access(actor, site_id)
    clause, args = _scope_sql(selected, allowed)
    with store._session() as con:
        rows = con.execute("SELECT * FROM operator_knowledge_sources WHERE 1=1" + clause + " ORDER BY created_at DESC LIMIT 1000", args).fetchall()
    return {"sources": [_public(row) for row in rows], "sites": [s for s in sites.options() if allowed is None or s["id"] in allowed], "status": status(actor), "statuses": sorted(STATUSES)}


def get_source(source_id: str, actor: str = "operator") -> dict[str, Any]:
    _ensure()
    with store._session() as con:
        row = con.execute("SELECT * FROM operator_knowledge_sources WHERE id=?", (source_id,)).fetchone()
        if not row:
            raise LookupError("Knowledge source not found")
        access(actor, row["site_id"])
        integrity = "NOT_INDEXED"
        if row["file_path"]:
            try:
                raw = _path(row["file_path"]).read_bytes()
                integrity = "VERIFIED" if hashlib.sha256(raw).hexdigest() == row["sha256"] else "FAILED"
            except (ValueError, OSError):
                integrity = "FAILED"
        result = _public(row)
        result["integrity"] = integrity
        result["passages"] = [dict(p) for p in con.execute("SELECT ordinal,page,section,text FROM operator_knowledge_chunks WHERE source_id=? ORDER BY ordinal LIMIT 2000", (source_id,))] if integrity == "VERIFIED" else []
        result["reviews"] = [dict(r) for r in con.execute("SELECT at,actor,status,reason,metadata FROM operator_knowledge_reviews WHERE source_id=? ORDER BY at DESC", (source_id,))]
        return result


def read_file(source_id: str, actor: str = "operator") -> tuple[dict[str, Any], bytes, str]:
    _ensure()
    with store._session() as con:
        row = con.execute("SELECT * FROM operator_knowledge_sources WHERE id=?", (source_id,)).fetchone()
    if not row:
        raise LookupError("Knowledge source not found")
    access(actor, row["site_id"])
    raw = _path(row["file_path"]).read_bytes()
    if hashlib.sha256(raw).hexdigest() != row["sha256"]:
        raise ValueError("Knowledge source checksum mismatch; retrieval refused")
    return _public(row), raw, mimetypes.guess_type(row["filename"])[0] or "application/octet-stream"


def upload(payload: dict[str, Any], actor: str) -> dict[str, Any]:
    _ensure()
    site_id, _ = access(actor, payload.get("siteId"))
    title = str(payload.get("title") or "").strip()[:300]
    filename = str(payload.get("filename") or "").replace("\\", "/").split("/")[-1][:200]
    suffix = Path(filename).suffix.lower()
    if not title or suffix not in SUFFIXES:
        raise ValueError("A title and PDF, TXT, Markdown, CSV, or DOCX file are required")
    try:
        raw = base64.b64decode(str(payload.get("contentBase64") or ""), validate=True)
    except (ValueError, TypeError):
        raise ValueError("Invalid uploaded file encoding") from None
    if not raw or len(raw) > MAX_BYTES:
        raise ValueError("File must be nonempty and no larger than 5 MB")
    chunks = list(_chunks(_extract(raw, suffix)))
    if not chunks:
        raise ValueError("No searchable text was extracted; upload a reviewed text transcription")
    source_key = str(payload.get("sourceKey") or title).strip()[:300]
    revision = str(payload.get("revision") or "").strip()[:100]
    if not source_key or not revision:
        raise ValueError("Document identity and revision are required")
    owner = str(payload.get("owner") or "").strip()[:200]
    digest = hashlib.sha256(raw).hexdigest()
    with store._LOCK, store._session() as con:
        prior = con.execute("SELECT * FROM operator_knowledge_sources WHERE source_key=? AND sha256=? AND revision=?", (source_key, digest, revision)).fetchone()
        if prior:
            access(actor, prior["site_id"])
            if prior["site_id"] != site_id:
                raise ValueError("This source key/revision already belongs to a different plant")
            return _public(prior) | {"deduplicated": True}
        conflict = con.execute("SELECT id FROM operator_knowledge_sources WHERE source_key=? AND site_id=? AND revision=? AND sha256<>?", (source_key,site_id,revision,digest)).fetchone()
        if conflict:
            raise ValueError("This document revision already has different content; upload a new revision")
        source_id = "oks_" + uuid.uuid4().hex
        target = _path(source_id + suffix)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        con.execute("INSERT INTO operator_knowledge_sources (id,source_key,title,site_id,status,revision,owner,sha256,file_path,filename,created_at,created_by,index_state,bytes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (source_id, source_key, title, site_id, "PENDING_REVIEW", revision, owner, digest, target.name, filename, now(), actor, "READY", len(raw)))
        for ordinal, page, section, text in chunks:
            cursor = con.execute("INSERT INTO operator_knowledge_chunks (source_id,ordinal,page,section,text) VALUES (?,?,?,?,?)", (source_id, ordinal, page, section, text))
            con.execute("INSERT INTO operator_knowledge_fts(rowid,title,text) VALUES (?,?,?)", (cursor.lastrowid, title, text))
        events.append_event(con, event_type="knowledge.source.uploaded", occurred_at=now(), actor_id=actor, aggregate_type="knowledge_source", aggregate_id=source_id, source="northstar-knowledge", summary="Knowledge source uploaded for review", payload={"sourceId": source_id, "sha256": digest, "siteId": site_id, "status": "PENDING_REVIEW"})
    return get_source(source_id, actor)


def review(source_id: str, payload: dict[str, Any], actor: str) -> dict[str, Any]:
    _ensure()
    source = get_source(source_id, actor)
    selected = str(payload.get("status") or "").strip()
    reason = str(payload.get("reason") or "").strip()[:1000]
    if selected not in STATUSES or not reason:
        raise ValueError("A valid status and review reason are required")
    if source["status"] == "LEGACY_REFERENCE" or source["source_type"] == "legacy-catalog":
        raise ValueError("Legacy SOPs cannot be promoted through the AI library; obtain a separately controlled current source")
    metadata = {name: str(payload.get(name, source.get(name)) or "").strip() for name in ("owner", "revision", "effective_from", "effective_to", "review_due")}
    if metadata["revision"] != source["revision"]:
        raise ValueError("Revision is immutable; upload a new source revision")
    for field in ("effective_from", "effective_to", "review_due"):
        metadata[field] = _date(metadata[field])
    if selected == "CURRENT_CONTROLLED":
        if payload.get("confirmed") is not True or not all(metadata[f] for f in ("owner", "revision", "effective_from", "review_due")):
            raise ValueError("Current sources require owner, revision, effective date, review due date, and explicit human confirmation")
        if metadata["review_due"] <= metadata["effective_from"] or metadata["effective_to"] and metadata["effective_to"] <= metadata["effective_from"]:
            raise ValueError("Review/expiry must be later than the effective date")
        read_file(source_id, actor)
    with store._LOCK, store._session() as con:
        current = con.execute("SELECT status FROM operator_knowledge_sources WHERE id=?", (source_id,)).fetchone()[0]
        if payload.get("expectedStatus", source["status"]) != current:
            raise ValueError("Source status changed; refresh before recording the review")
        stamp = now()
        if selected == "CURRENT_CONTROLLED":
            prior = con.execute("SELECT id FROM operator_knowledge_sources WHERE source_key=? AND site_id=? AND id<>? AND status='CURRENT_CONTROLLED'", (source["source_key"],source["site_id"],source_id)).fetchall()
            for old in prior:
                con.execute("UPDATE operator_knowledge_sources SET status='SUPERSEDED' WHERE id=?", (old["id"],))
                con.execute("INSERT INTO operator_knowledge_reviews VALUES (?,?,?,?,?,?,?,?)", ("okr_"+uuid.uuid4().hex,old["id"],stamp,actor,"CURRENT_CONTROLLED","SUPERSEDED","Replaced by reviewed revision " + source_id,json.dumps({"replacement":source_id})))
                events.append_event(con,event_type="knowledge.source.superseded",occurred_at=stamp,actor_id=actor,aggregate_type="knowledge_source",aggregate_id=old["id"],source="northstar-knowledge",summary="Knowledge revision superseded",payload={"replacement":source_id})
        con.execute("UPDATE operator_knowledge_sources SET status=?,owner=?,revision=?,effective_from=?,effective_to=?,review_due=?,approved_by=?,approved_at=? WHERE id=?", (selected, metadata["owner"], metadata["revision"], metadata["effective_from"], metadata["effective_to"], metadata["review_due"], actor if selected == "CURRENT_CONTROLLED" else "", stamp if selected == "CURRENT_CONTROLLED" else "", source_id))
        con.execute("INSERT INTO operator_knowledge_reviews VALUES (?,?,?,?,?,?,?,?)", ("okr_" + uuid.uuid4().hex, source_id, stamp, actor, current, selected, reason, json.dumps(metadata)))
        events.append_event(con, event_type="knowledge.source.reviewed", occurred_at=stamp, actor_id=actor, aggregate_type="knowledge_source", aggregate_id=source_id, source="northstar-knowledge", summary="Knowledge source review recorded", payload={"sourceId": source_id, "siteId": source["site_id"], "status": selected, "previousStatus": current, "sha256": source["sha256"], "metadata": metadata, "reason": reason})
    return get_source(source_id, actor)


def _current_sql(prefix: str = "s.") -> str:
    return f"{prefix}status='CURRENT_CONTROLLED' AND {prefix}approved_by<>'' AND {prefix}effective_from<>'' AND julianday({prefix}effective_from)<=julianday('now') AND {prefix}review_due<>'' AND julianday({prefix}review_due)>julianday('now') AND ({prefix}effective_to='' OR julianday({prefix}effective_to)>julianday('now'))"


def _terms(question: str) -> list[str]:
    from northstar_knowledge import _tokens
    return sorted(_tokens(question))[:20]


def _live_records(question: str, selected: str, allowed: list[str] | None, limit: int, target: tuple[str, str] | None = None) -> list[dict[str, Any]]:
    """Explicit projections only: no auth, worker locations, voice, draft or AI-history tables."""
    terms = _terms(question)
    result: list[dict[str, Any]] = []
    definitions = {
        "device_library_notes": ("id", ["item_id", "body", "created_at", "expires_at", "persist_on"], "created_at"),
        "logbook": ("id", ["at", "type", "subject", "details"], "at"),
        "outages": ("id", ["site", "site_id", "title", "asset", "details", "status", "opened_at"], "opened_at"),
    }
    with store._session() as con:
        for table, (key, desired, timestamp) in definitions.items():
            if target and target[0] != table:
                continue
            columns = {r["name"] for r in con.execute(f'PRAGMA table_info("{table}")')}
            if key not in columns:
                continue
            projection = [key, *[c for c in desired if c in columns]]
            fields = [c for c in projection if c not in {key, timestamp, "expires_at", "persist_on"}]
            if not fields or not terms and not target:
                continue
            where = " OR ".join(f'lower("{c}") LIKE ? ESCAPE \'\\\'' for term in terms for c in fields)
            args = ["%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%" for term in terms for c in fields]
            if target:
                where, args = f'"{key}"=?', [target[1]]
            sql = f'SELECT {",".join(projection)} FROM "{table}" WHERE ({where}) ORDER BY "{timestamp}" DESC LIMIT 100'
            for row in con.execute(sql, args):
                item = dict(row)
                site = sites.resolve(item.get("site_id") or item.get("site"))
                if table == "device_library_notes":
                    site = next((s for s in sites.known() if s["id"] in str(item.get("item_id", ""))), None)
                    try:
                        expires = _date(item.get("expires_at"))
                    except ValueError:
                        continue
                    if expires and expires <= now() and not target:
                        continue
                if table == "logbook":
                    text = " ".join(str(v) for v in item.values()).lower()
                    matches = [s for s in sites.known() if any(name.lower() in text for name in sites.match_names(s["id"]))]
                    site = matches[0] if len(matches) == 1 else None
                site_value = site["id"] if site else ""
                if selected and site_value != selected or allowed is not None and site_value not in allowed:
                    continue
                text = redact(json.dumps(item, ensure_ascii=False, default=str))
                if len(text) > 1800 and not target:
                    positions = [text.lower().find(term) for term in terms if term in text.lower()]
                    offset = max(0, min(positions, default=0) - 500)
                    text = ("..." if offset else "") + text[offset:offset + 1800]
                else:
                    text = text[:50000] if target else text[:1800]
                score = 1 if target else sum(term in text.lower() for term in terms)
                if score:
                    event_id = item[key]
                    result.append({"source": f"database:{table}:{event_id}", "path": f"database/{table}/{event_id}", "id": str(event_id), "title": item.get("title") or item.get("subject") or "Recorded operating condition", "excerpt": text, "authorityStatus": "RECORDED_FACT", "revision": "", "siteId": site_value, "retrieved_at": now(), "recorded_at": item.get(timestamp), "href": "knowledge-library.html?record=" + quote(table + "/" + str(event_id), safe=""), "score": score})
    return sorted(result, key=lambda r: (-r["score"], r["source"]))[:limit]


def get_record(table: str, record_id: str, actor: str) -> dict[str, Any]:
    _ensure()
    _, allowed = access(actor)
    records = _live_records("", "", allowed, 1, target=(table, record_id))
    if not records:
        raise LookupError("Recorded source not found in this operator scope")
    return records[0]


def search(question: str, limit: int = 12, *, site_id: str = "", actor: str = "operator", reference_mode: bool = False, current_only: bool = False) -> list[dict[str, Any]]:
    _ensure()
    selected, allowed = access(actor, site_id)
    terms = _terms(question)
    if not terms:
        return []
    limit = max(1, min(int(limit), 20))
    from northstar_knowledge import SYNONYMS
    expanded = set(terms)
    for term in terms:
        expanded.update(SYNONYMS.get(term, set()))
    match = " OR ".join('"' + term.replace('"', '""') + '"*' for term in sorted(expanded)[:40])
    scope, args = _scope_sql(selected, allowed, "s.")
    eligible = _current_sql() if not reference_mode else "s.status='REFERENCE_ONLY'"
    with store._session() as con:
        rows = con.execute("SELECT s.*,c.id AS chunk_id,c.ordinal,c.page,c.section,c.text,bm25(operator_knowledge_fts) AS rank FROM operator_knowledge_fts JOIN operator_knowledge_chunks c ON c.id=operator_knowledge_fts.rowid JOIN operator_knowledge_sources s ON s.id=c.source_id WHERE operator_knowledge_fts MATCH ? AND (" + eligible + ")" + scope + " ORDER BY rank,c.id LIMIT ?", [match, *args, limit * 3]).fetchall()
    results, checked, per_source = [], {}, {}
    for row in rows:
        if not any(term in row["text"].lower() or term in row["title"].lower() for term in terms):
            continue
        if row["id"] not in checked:
            try:
                read_file(row["id"], actor)
                checked[row["id"]] = True
            except (ValueError, OSError):
                checked[row["id"]] = False
        if not checked[row["id"]] or per_source.get(row["id"], 0) >= 2:
            continue
        per_source[row["id"]] = per_source.get(row["id"], 0) + 1
        identifier = row["id"] + ":" + str(row["ordinal"])
        results.append({"source": "document:" + row["id"], "path": identifier, "id": identifier, "sourceId": row["id"], "title": row["title"], "excerpt": row["text"], "authorityStatus": row["status"], "revision": row["revision"], "sha256": row["sha256"], "siteId": row["site_id"], "page": row["page"], "section": row["section"], "owner": row["owner"], "effectiveFrom": row["effective_from"], "reviewDue": row["review_due"], "retrieved_at": now(), "href": "knowledge-library.html?source=" + row["id"] + "#passage-" + str(row["ordinal"])})
        if len(results) >= limit:
            break
    if not reference_mode and not current_only:
        results += _live_records(question, selected, allowed, max(1, limit - len(results)))
    return results[:limit]


def read_passages(source_id: str, ordinal: int, *, actor: str = "operator", site_id: str = "",
                  reference_mode: bool = False, current_only: bool = False) -> list[dict[str, Any]]:
    """Bounded exact/adjacent retrieval with the same policy and integrity checks as search."""
    if type(ordinal) is not int or ordinal < 0 or ordinal > 100000:
        raise ValueError("Invalid passage ordinal")
    _ensure()
    selected, allowed = access(actor, site_id)
    scope, args = _scope_sql(selected, allowed, "s.")
    eligible = _current_sql()
    if reference_mode:
        eligible = "s.status='REFERENCE_ONLY'"
    elif not current_only:
        eligible = "(" + eligible + " OR s.status='REFERENCE_ONLY')"
    with store._session() as con:
        row = con.execute("SELECT s.* FROM operator_knowledge_sources s WHERE s.id=? AND (" + eligible + ")" + scope, [source_id, *args]).fetchone()
        if not row:
            raise LookupError("Source is not eligible in this scope")
        passages = con.execute("SELECT ordinal,page,section,text FROM operator_knowledge_chunks WHERE source_id=? AND ordinal BETWEEN ? AND ? ORDER BY ordinal", (source_id, max(0, ordinal - 1), ordinal + 1)).fetchall()
        if not any(p['ordinal'] == ordinal for p in passages):
            raise LookupError("Passage not found")
    read_file(source_id, actor)
    return [{"source": "document:" + source_id, "sourceId": source_id,
             "path": source_id + ":" + str(p['ordinal']), "id": source_id + ":" + str(p['ordinal']),
             "title": row['title'], "excerpt": p['text'], "authorityStatus": row['status'],
             "revision": row['revision'], "sha256": row['sha256'], "siteId": row['site_id'],
             "page": p['page'], "section": p['section'], "effectiveFrom": row['effective_from'],
             "reviewDue": row['review_due'], "retrieved_at": now(),
             "href": "knowledge-library.html?source=" + source_id + "#passage-" + str(p['ordinal'])} for p in passages]


def status(actor: str = "operator") -> dict[str, Any]:
    _ensure()
    _, allowed = access(actor)
    clause, args = _scope_sql("", allowed)
    with store._session() as con:
        counts = {r["status"]: r["n"] for r in con.execute("SELECT status,count(*) n FROM operator_knowledge_sources WHERE 1=1" + clause + " GROUP BY status", args)}
        current = con.execute("SELECT count(*) FROM operator_knowledge_sources s WHERE " + _current_sql() + _scope_sql("", allowed, "s.")[0], args).fetchone()[0]
        passages = con.execute("SELECT count(*) FROM operator_knowledge_chunks c JOIN operator_knowledge_sources s ON s.id=c.source_id WHERE 1=1" + _scope_sql("", allowed, "s.")[0], args).fetchone()[0]
    return {"indexVersion": VERSION, "engine": "sqlite-fts5", "sourceCounts": counts, "currentSources": current, "fileRecords": sum(counts.values()), "databaseRecords": 0, "liveRecordsOnDemand": True, "publicSources": 0, "totalRecords": sum(counts.values()), "passages": passages, "coverage": ["controlled-source-registry", "explicit-live-record-projections"], "libraryHref": "knowledge-library.html", "notice": "Legacy sources are excluded from AI answers. Current sources require human review and valid effective dates."}


def bootstrap() -> dict[str, Any]:
    """Register existing legacy metadata only; never ingest legacy procedure text."""
    _ensure()
    import northstar_sop_library as sop
    legacy = sop.catalog().get("documents", [])
    with store._LOCK, store._session() as con:
        for source in legacy:
            site_id = source.get("siteIds", [""])[0] if len(source.get("siteIds", [])) == 1 else ""
            con.execute("INSERT OR IGNORE INTO operator_knowledge_sources (id,source_key,title,site_id,status,revision,owner,sha256,filename,source_url,source_type,created_at,created_by,index_state,bytes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (source["id"], source["id"], source["title"], site_id, "LEGACY_REFERENCE", source.get("revision", ""), "Owner verification required", source["sha256"], source["filename"], source["href"], "legacy-catalog", now(), "system-import", "EXCLUDED", source["bytes"]))
    return status()
