"""Import a Maximo List of Service Requests workbook as a read-only snapshot."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from xml.etree import ElementTree as ET


MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL_ID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
PACKAGE_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
EXPECTED_HEADERS = (
    "Service Request", "Summary", "Location", "Reported By", "Reported Date", "Target Finish",
    "Priority", "Classification", "Status", "Owner", "Owner Group",
)
FIELDS = (
    "serviceRequest", "summary", "location", "reportedBy", "reportedAt", "targetFinish",
    "priority", "classification", "status", "owner", "ownerGroup",
)
EXCEL_EPOCH = datetime(1899, 12, 30)


def _column_index(reference: str) -> int:
    index = 0
    for letter in (character for character in str(reference or "").upper() if character.isalpha()):
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
    relations = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    target = next((node.get("Target", "") for node in relations.findall(f"{PACKAGE_REL}Relationship")
                   if node.get("Id") == relationship_id), "")
    if not relationship_id or not target:
        raise ValueError("Workbook sheet relationship is missing")
    target = target.lstrip("/")
    return (target if target.startswith("xl/") else "xl/" + target.lstrip("./"),
            str(sheet.get("name") or ""))


def _cell_value(cell: ET.Element, shared: list[str]) -> str:
    if cell.get("t") == "inlineStr":
        return "".join(cell.itertext()).strip()
    value = cell.findtext(f"{MAIN}v", default="")
    if cell.get("t") == "s":
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
        values = {_column_index(cell.get("r", "")): _cell_value(cell, shared) for cell in row.findall(f"{MAIN}c")}
        if values:
            rows.append([values.get(index, "") for index in range(1, max(values) + 1)])
    return sheet_name, rows


def _excel_timestamp(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    try:
        return (EXCEL_EPOCH + timedelta(days=float(raw))).isoformat(timespec="seconds")
    except ValueError:
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00")).isoformat(timespec="seconds")
        except ValueError:
            raise ValueError(f"Unreadable service-request timestamp: {raw}") from None


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1_048_576), b""):
            digest.update(chunk)
    return digest.hexdigest()


def import_workbook(source: Path) -> dict:
    source = Path(source)
    if source.suffix.lower() != ".xlsx" or not source.is_file():
        raise ValueError("Provide an existing .xlsx List of Service Requests workbook")
    try:
        with zipfile.ZipFile(source) as archive:
            sheet_name, rows = _worksheet_rows(archive)
    except (OSError, zipfile.BadZipFile, ET.ParseError) as exc:
        raise ValueError("The service request workbook could not be read") from exc
    if not rows:
        raise ValueError("The service request workbook contains no rows")
    headers = tuple(rows[0][:len(EXPECTED_HEADERS)])
    if headers != EXPECTED_HEADERS:
        raise ValueError("Expected the standard List of Service Requests columns")
    records: list[dict[str, str]] = []
    request_ids: set[str] = set()
    status_counts: dict[str, int] = {}
    locations: set[str] = set()
    for row_number, row in enumerate(rows[1:], start=2):
        values = (row + [""] * len(FIELDS))[:len(FIELDS)]
        record = {field: str(value or "").strip() for field, value in zip(FIELDS, values)}
        if not record["serviceRequest"]:
            raise ValueError(f"Service Request is blank on row {row_number}")
        if record["serviceRequest"] in request_ids:
            raise ValueError(f"Duplicate service request: {record['serviceRequest']}")
        request_ids.add(record["serviceRequest"])
        record["reportedAt"] = _excel_timestamp(record["reportedAt"])
        record["targetFinish"] = _excel_timestamp(record["targetFinish"])
        record["status"] = record["status"].upper() or "UNSPECIFIED"
        status_counts[record["status"]] = status_counts.get(record["status"], 0) + 1
        if record["location"]:
            locations.add(record["location"])
        records.append(record)
    return {
        "schemaVersion": 1,
        "source": {
            "filename": source.name,
            "sha256": _sha256(source),
            "sheetName": sheet_name,
            "headers": list(headers),
            "importedAt": datetime.now(timezone.utc).isoformat(),
            "recordCount": len(records),
        },
        "summary": {
            "recordCount": len(records),
            "locationCount": len(locations),
            "statuses": [{"status": status, "count": count} for status, count in sorted(status_counts.items())],
        },
        "requests": records,
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
    parser = argparse.ArgumentParser(description="Import a Maximo List of Service Requests workbook")
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        snapshot = import_workbook(args.source)
        _atomic_json_write(args.output, snapshot)
    except (OSError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(snapshot["summary"], separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
