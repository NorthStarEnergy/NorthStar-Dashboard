"""2024 Utility Work Protection Code — citation index only.

This module names the governing edition and the Code's published structure
(section numbers, instrument names, authority roles). It does not reproduce
rule text, glossary definitions, or form illustrations.

Copyright of the Code is owned by Hydro One Networks Inc. Operators attach
or place their licensed 2024 book at the configured path. This origin does
not issue Work Permits, Supporting Guarantees, or operational release.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
RULE_SET = "UWPC 2024"
PROCEDURE_ID = "uwpc-2024"
EDITION = "2024"
TITLE = "Utility Work Protection Code"
OWNER = "Hydro One Networks Inc."
NOTE = (
    "Citation index for the 2024 Utility Work Protection Code. "
    "This origin does not reproduce the Code, issue a Work Permit, "
    "or record operational release."
)

SECTIONS: tuple[dict[str, str], ...] = (
    {"id": "glossary", "number": "Glossary", "title": "Glossary of Terms"},
    {"id": "1", "number": "1", "title": "The Fundamentals of Work Protection"},
    {"id": "2", "number": "2", "title": "Responsibilities - Work Group Members & Holders"},
    {"id": "3", "number": "3", "title": "PC10A Self-Administered Work Permits"},
    {"id": "4", "number": "4", "title": "PC17B Self-Administered Work Permits"},
    {"id": "5", "number": "5", "title": "PC2 Issued Work Permits"},
    {"id": "6", "number": "6", "title": "Supporting Guarantees"},
    {"id": "7", "number": "7", "title": "De-Energizing Isolated Equipment"},
    {"id": "8", "number": "8", "title": "Equipment Protection"},
)

INSTRUMENTS: tuple[dict[str, str], ...] = (
    {"id": "pc10a", "name": "PC10A Self-Administered Work Permit", "section": "3", "article": "3.000", "kind": "work-permit"},
    {"id": "pc17b", "name": "PC17B Self-Administered Work Permit", "section": "4", "article": "4.000", "kind": "work-permit"},
    {"id": "pc2", "name": "PC2 Issued Work Permit", "section": "5", "article": "5.000", "kind": "work-permit"},
    {"id": "pc10c-sg", "name": "PC10C Supporting Guarantee", "section": "6", "article": "6.030", "kind": "supporting-guarantee"},
    {"id": "pc17b-sg", "name": "PC17B Supporting Guarantee", "section": "6", "article": "6.050", "kind": "supporting-guarantee"},
    {"id": "pc2-sg", "name": "PC2 Supporting Guarantee", "section": "6", "article": "6.070", "kind": "supporting-guarantee"},
    {"id": "pc4", "name": "PC4 De-Energizing Device Tag", "section": "7", "article": "7.030", "kind": "de-energizing"},
    {"id": "hold-off", "name": "Hold-off", "section": "8", "article": "HO1.00", "kind": "equipment-protection"},
    {"id": "caution", "name": "Caution Tag", "section": "8", "article": "EP1.00", "kind": "equipment-protection"},
    {"id": "terminal-point", "name": "Terminal Point Tag", "section": "8", "article": "TP1.00", "kind": "equipment-protection"},
)

ROLES: tuple[str, ...] = (
    "Applicant",
    "Holder",
    "Work Group Member",
    "Controlling Authority",
    "Issuing Authority",
    "Establishing Authority",
)

FORMS: tuple[str, ...] = (
    "PC1", "PC2", "PC3", "PC4", "PC10A", "PC10C", "PC14", "PC15", "PC17A", "PC17B",
    "Hold-off Tag", "Caution Tag", "Terminal Point Tag",
)


def book_path() -> Path:
    override = os.environ.get("NORTHSTAR_UWPC_PATH", "").strip()
    if override:
        return Path(override).expanduser()
    return ROOT / "data" / "controlled-sources" / "uwpc-2024.pdf"


def book_available() -> bool:
    path = book_path()
    if not path.is_file() or path.stat().st_size <= 0:
        return False
    with path.open("rb") as handle:
        return handle.read(5).startswith(b"%PDF-")


def book_digest() -> str:
    path = book_path()
    if not path.is_file():
        return ""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def instrument(instrument_id: str) -> dict[str, str] | None:
    key = str(instrument_id or "").strip().lower()
    for row in INSTRUMENTS:
        if row["id"] == key:
            return dict(row)
    return None


def uses_governing_code(payload: dict[str, Any] | None) -> bool:
    record = payload or {}
    return (
        str(record.get("ruleSet") or "").strip() == RULE_SET
        and str(record.get("authorityProcedureId") or "").strip() == PROCEDURE_ID
    )


def payload() -> dict[str, Any]:
    digest = book_digest() if book_available() else ""
    return {
        "ruleSet": RULE_SET,
        "procedureId": PROCEDURE_ID,
        "edition": EDITION,
        "title": TITLE,
        "owner": OWNER,
        "note": NOTE,
        "bookAvailable": book_available(),
        "bookSha256": digest,
        "bookHref": "/api/uwpc/book" if book_available() else "",
        "sections": [dict(row) for row in SECTIONS],
        "instruments": [dict(row) for row in INSTRUMENTS],
        "roles": list(ROLES),
        "forms": list(FORMS),
    }
