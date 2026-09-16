"""Import a Maximo equipment workbook into the protected NorthStar runtime store.

The importer accepts the standard List of Assets export and deliberately uses
only the Python standard library so the live server has no spreadsheet runtime
dependency. It preserves every source row, validates asset/parent integrity,
and writes an atomically replaceable JSON snapshot for the read-only API.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET


MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL_ID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
PACKAGE_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
EXPECTED_HEADERS = (
    "Asset", "Description", "Location", "Description", "Parent", "Rotating Item", "Site",
)
FIELDS = (
    "assetNum", "description", "location", "locationDescription", "parent", "rotatingItem", "site",
)


def _column_index(reference: str) -> int:
    letters = "".join(char for char in str(reference or "") if char.isalpha()).upper()
    index = 0
    for letter in letters:
        index = index * 26 + ord(letter) - ord("A") + 1
    return index


def _shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return ["".join(node.itertext()) for node in root.findall(f"{MAIN}si")]


def _sheet_path(archive: zipfile.ZipFile) -> tuple[str, str]:
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    sheet = workbook.find(f"{MAIN}sheets/{MAIN}sheet")
    if sheet is None:
        raise ValueError("Workbook has no worksheets")
    relationship_id = sheet.get(REL_ID)
    if not relationship_id:
        raise ValueError("Workbook sheet relationship is missing")
    relations = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    target = next((node.get("Target", "") for node in relations.findall(f"{PACKAGE_REL}Relationship")
                   if node.get("Id") == relationship_id), "")
    if not target:
        raise ValueError("Workbook sheet target is missing")
    path = target.lstrip("/")
    if not path.startswith("xl/"):
        path = "xl/" + path.lstrip("./")
    return path, str(sheet.get("name") or "")


def _cell_value(cell: ET.Element, shared: list[str]) -> str:
    cell_type = cell.get("t")
    if cell_type == "inlineStr":
        return "".join(cell.itertext()).strip()
    value = cell.findtext(f"{MAIN}v", default="")
    if cell_type == "s":
        try:
            return shared[int(value)].strip()
        except (IndexError, ValueError):
            raise ValueError("Workbook contains an invalid shared-string reference") from None
    return str(value or "").strip()


def _worksheet_rows(archive: zipfile.ZipFile) -> tuple[str, list[list[str]]]:
    shared = _shared_strings(archive)
    sheet_path, sheet_name = _sheet_path(archive)
    root = ET.fromstring(archive.read(sheet_path))
    rows: list[list[str]] = []
    for row in root.findall(f".//{MAIN}sheetData/{MAIN}row"):
        values: dict[int, str] = {}
        for cell in row.findall(f"{MAIN}c"):
            column = _column_index(cell.get("r", ""))
            if column:
                values[column] = _cell_value(cell, shared)
        if values:
            rows.append([values.get(index, "") for index in range(1, max(values) + 1)])
    return sheet_name, rows


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1_048_576), b""):
            digest.update(chunk)
    return digest.hexdigest()


def import_workbook(source: Path) -> dict:
    source = Path(source)
    if source.suffix.lower() != ".xlsx" or not source.is_file():
        raise ValueError("Provide an existing .xlsx Maximo equipment workbook")
    try:
        with zipfile.ZipFile(source) as archive:
            sheet_name, rows = _worksheet_rows(archive)
    except (OSError, zipfile.BadZipFile, ET.ParseError) as exc:
        raise ValueError("The Maximo workbook could not be read") from exc
    if not rows:
        raise ValueError("The Maximo workbook contains no rows")
    headers = tuple(rows[0][:len(EXPECTED_HEADERS)])
    if headers != EXPECTED_HEADERS:
        raise ValueError("Expected columns: Asset, Description, Location, Description, Parent, Rotating Item, Site")
    assets: list[dict[str, str]] = []
    asset_numbers: set[str] = set()
    parents: list[str] = []
    for row_number, row in enumerate(rows[1:], start=2):
        values = (row + [""] * len(FIELDS))[:len(FIELDS)]
        record = {field: str(value or "").strip() for field, value in zip(FIELDS, values)}
        if not record["assetNum"]:
            raise ValueError(f"Asset is blank on row {row_number}")
        if not record["site"]:
            raise ValueError(f"Site is blank for asset {record['assetNum']}")
        if record["assetNum"] in asset_numbers:
            raise ValueError(f"Duplicate asset number: {record['assetNum']}")
        asset_numbers.add(record["assetNum"])
        if record["parent"]:
            parents.append(record["parent"])
        assets.append(record)
    missing_parents = sorted(set(parent for parent in parents if parent not in asset_numbers))
    if missing_parents:
        raise ValueError(f"Parent assets are missing from the workbook: {', '.join(missing_parents[:8])}")
    site_counts: dict[str, int] = {}
    for asset in assets:
        site_counts[asset["site"]] = site_counts.get(asset["site"], 0) + 1
    return {
        "schemaVersion": 1,
        "source": {
            "filename": source.name,
            "sha256": _sha256(source),
            "sheetName": sheet_name,
            "headers": list(headers),
            "importedAt": datetime.now(timezone.utc).isoformat(),
            "recordCount": len(assets),
        },
        "summary": {
            "assetCount": len(assets),
            "siteCount": len(site_counts),
            "parentLinks": len(parents),
            "sites": [{"code": code, "assets": count} for code, count in sorted(site_counts.items())],
        },
        "assets": assets,
    }


def _atomic_json_write(destination: Path, snapshot: dict) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix=destination.name + ".", suffix=".tmp", dir=destination.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(snapshot, stream, ensure_ascii=False, separators=(",", ":"))
            stream.write("\n")
        os.replace(temporary, destination)
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Import a Maximo List of Assets workbook")
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--copy-source", type=Path)
    args = parser.parse_args(argv)
    try:
        snapshot = import_workbook(args.source)
        _atomic_json_write(args.output, snapshot)
        if args.copy_source:
            args.copy_source.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(args.source, args.copy_source)
    except (OSError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(snapshot["summary"], separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
