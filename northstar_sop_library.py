"""Private reader for imported legacy SOP PDFs.

The library is reference-only. It does not promote a supplied document to a
current controlled procedure, and it never executes or interprets its text.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path, PurePosixPath
from typing import Any


ROOT = Path(__file__).resolve().parent
DEFAULT_LIBRARY_ROOT = ROOT / "data" / "controlled-sources" / "firstlight-legacy-sops"
PDF_MAGIC = b"%PDF-"
DOC_ID_RE = re.compile(r"^flc-[a-f0-9]{16}$")
NOTICE = (
    "Legacy reference only. Verify the document owner, revision, and current applicability "
    "before relying on any procedure. This library does not authorize work or operational action."
)


class DocumentIntegrityError(LookupError):
    """The private document did not match its imported manifest."""


def library_root() -> Path:
    configured = os.environ.get("NORTHSTAR_SOP_LIBRARY_ROOT", "").strip()
    return Path(configured).expanduser() if configured else DEFAULT_LIBRARY_ROOT


def _within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def _path_for(root: Path, value: object) -> Path | None:
    try:
        relative = PurePosixPath(str(value or "").replace("\\", "/"))
    except (TypeError, ValueError):
        return None
    if (
        not relative.parts
        or relative.is_absolute()
        or ".." in relative.parts
        or any(":" in part for part in relative.parts)
    ):
        return None
    path = (root / "files" / Path(*relative.parts)).resolve()
    return path if _within(path, (root / "files").resolve()) else None


def _manifest_entries(include_unavailable: bool = False) -> list[dict[str, Any]]:
    root = library_root().resolve()
    manifest_path = root / "manifest.json"
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(raw, dict) or raw.get("status") != "LEGACY_REFERENCE":
        return []
    entries: list[dict[str, Any]] = []
    for candidate in raw.get("documents", []):
        if not isinstance(candidate, dict):
            continue
        document_id = str(candidate.get("id") or "")
        path = _path_for(root, candidate.get("relativePath"))
        expected_size = candidate.get("bytes")
        expected_hash = str(candidate.get("sha256") or "").lower()
        if (
            not DOC_ID_RE.fullmatch(document_id)
            or path is None
            or path.suffix.lower() != ".pdf"
            or not isinstance(expected_size, int)
            or expected_size < 1
            or not re.fullmatch(r"[a-f0-9]{64}", expected_hash)
        ):
            continue
        record = {
            "id": document_id,
            "title": str(candidate.get("title") or path.stem)[:500],
            "procedureCode": str(candidate.get("procedureCode") or "")[:160],
            "revision": str(candidate.get("revision") or "Unspecified")[:160],
            "kind": str(candidate.get("kind") or "Procedure")[:80],
            "language": str(candidate.get("language") or "")[:80],
            "siteIds": [str(site) for site in candidate.get("siteIds", []) if str(site).startswith("site:")],
            "filename": path.name,
            "bytes": expected_size,
            "sha256": expected_hash,
            "path": path,
        }
        try:
            with path.open("rb") as handle:
                is_pdf = handle.read(len(PDF_MAGIC)) == PDF_MAGIC
        except OSError:
            if include_unavailable:
                entries.append(record)
            continue
        if not is_pdf or path.stat().st_size != expected_size:
            if include_unavailable:
                entries.append(record)
            continue
        entries.append(record)
    return sorted(entries, key=lambda item: (item["language"], item["procedureCode"], item["title"], item["id"]))


def catalog(site_id: str = "") -> dict[str, Any]:
    scope = str(site_id or "").strip()
    documents = [
        item for item in _manifest_entries()
        if not scope or not item["siteIds"] or scope in item["siteIds"]
    ]
    return {
        "sourceName": "FirstLight legacy SOP library",
        "status": "LEGACY_REFERENCE",
        "notice": NOTICE,
        "documents": [{
            key: value for key, value in item.items() if key != "path"
        } | {"href": f"/api/library/procedures/{item['id']}/file"} for item in documents],
    }


def read_document(document_id: str) -> tuple[dict[str, Any], bytes]:
    selected = next((
        item for item in _manifest_entries(include_unavailable=True)
        if item["id"] == str(document_id or "")
    ), None)
    if selected is None:
        raise LookupError("legacy SOP document not found")
    try:
        body = selected["path"].read_bytes()
    except OSError as error:
        raise LookupError("legacy SOP document is unavailable") from error
    if not body.startswith(PDF_MAGIC):
        raise DocumentIntegrityError("legacy SOP document is not a PDF")
    digest = hashlib.sha256(body).hexdigest()
    if digest != selected["sha256"]:
        raise DocumentIntegrityError("legacy SOP document checksum does not match the import manifest")
    record = {key: value for key, value in selected.items() if key != "path"}
    record["href"] = f"/api/library/procedures/{record['id']}/file"
    return record, body
