"""Build a metadata-only, read-only index for a legacy incident-report ZIP."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path, PurePosixPath


INCIDENT_RE = re.compile(
    r"(?i)\bINC[-_ ]?(?P<year>\d{4})[-_ ]?(?P<month>\d{2})[-_ ]?(?P<day>\d{2})(?:[-_ ]+(?P<number>\d{1,3}))?"
)
REPORT_EXTENSIONS = {".doc", ".docx", ".dotx", ".pdf"}
MAX_ARCHIVE_BYTES = 2_000 * 1024 * 1024


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1_048_576), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_path(name: str) -> PurePosixPath:
    path = PurePosixPath(str(name or ""))
    if not path.parts or path.is_absolute() or ".." in path.parts:
        raise ValueError(f"unsafe archive entry: {name!r}")
    return path


def incident_match(parts: tuple[str, ...]) -> tuple[int, re.Match[str]] | None:
    for index, part in enumerate(parts):
        match = INCIDENT_RE.search(part)
        if match:
            return index, match
    return None


def incident_id(match: re.Match[str]) -> str:
    suffix = f"-{int(match.group('number'))}" if match.group("number") else ""
    return f"INC-{match.group('year')}-{match.group('month')}-{match.group('day')}{suffix}"


def occurred_on(match: re.Match[str]) -> str:
    try:
        return date(int(match.group("year")), int(match.group("month")), int(match.group("day"))).isoformat()
    except ValueError:
        raise ValueError(f"invalid incident date in {match.group(0)!r}") from None


def display_title(name: str, match: re.Match[str]) -> str:
    title = INCIDENT_RE.sub("", name, count=1)
    title = re.sub(r"[_-]+", " ", title).strip(" .-_")
    return re.sub(r"\s+", " ", title) or "Incident report"


def case_key(parts: tuple[str, ...], match_index: int, file_stem: str) -> tuple[str, str]:
    if match_index < len(parts) - 1:
        prefix = "/".join(parts[:match_index + 1])
        return prefix, prefix + "/"
    prefix = "/".join((*parts[:-1], file_stem))
    return prefix, "/".join(parts)


def build_index(archive_path: Path) -> dict:
    if archive_path.suffix.lower() != ".zip" or not archive_path.is_file():
        raise ValueError("provide an existing .zip incident-report archive")
    if archive_path.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ValueError("incident-report archive exceeds the 2 GB index limit")
    cases: dict[str, dict] = {}
    all_paths: list[str] = []
    with zipfile.ZipFile(archive_path) as archive:
        entries = [entry for entry in archive.infolist() if not entry.is_dir()]
        if not entries:
            raise ValueError("incident-report archive contains no files")
        for entry in entries:
            relative = safe_path(entry.filename)
            all_paths.append(relative.as_posix())
            extension = Path(relative.name).suffix.lower()
            if extension not in REPORT_EXTENSIONS:
                continue
            matched = incident_match(relative.parts)
            if not matched:
                continue
            match_index, match = matched
            key, evidence_prefix = case_key(relative.parts, match_index, Path(relative.name).stem)
            title_source = Path(relative.parts[match_index]).stem if match_index == len(relative.parts) - 1 else relative.parts[match_index]
            case = cases.setdefault(key, {
                "recordId": hashlib.sha256(key.encode("utf-8")).hexdigest()[:20],
                "incidentId": incident_id(match),
                "occurredOn": occurred_on(match),
                "title": display_title(title_source, match),
                "category": relative.parts[1] if len(relative.parts) > 1 else "Other or Unknown",
                "reportCount": 0,
                "evidencePrefix": evidence_prefix,
                "formats": set(),
            })
            case["reportCount"] += 1
            case["formats"].add(extension)
    if not cases:
        raise ValueError("no dated incident-report documents were found in the archive")
    for case in cases.values():
        prefix = case.pop("evidencePrefix")
        case["evidenceFileCount"] = sum(path.startswith(prefix) for path in all_paths)
        case["formats"] = sorted(case["formats"])
    incidents = sorted(cases.values(), key=lambda item: (item["occurredOn"], item["incidentId"], item["recordId"]), reverse=True)
    return {
        "schemaVersion": 1,
        "source": {
            "filename": archive_path.name,
            "sha256": sha256_file(archive_path),
            "indexedAt": datetime.now(timezone.utc).isoformat(),
            "fileCount": len(entries),
            "caseCount": len(incidents),
            "mode": "metadata-only",
        },
        "incidents": incidents,
    }


def atomic_write(destination: Path, payload: dict) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix=destination.name + ".", suffix=".tmp", dir=destination.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(payload, stream, ensure_ascii=False, separators=(",", ":"))
            stream.write("\n")
        os.replace(temporary, destination)
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Index a legacy incident-report archive without extracting it")
    parser.add_argument("archive", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        index = build_index(args.archive)
        atomic_write(args.output, index)
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print(json.dumps({
        "caseCount": len(index["incidents"]),
        "fileCount": index["source"]["fileCount"],
        "mode": index["source"]["mode"],
    }, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
