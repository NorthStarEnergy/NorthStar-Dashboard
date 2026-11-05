"""Import a ZIP of legacy SOP PDFs into NorthStar's private reference library.

The import preserves the original directory layout, verifies every file is a
PDF, records checksums, and labels the material as legacy reference only. It
never reads or acts on PDF text.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath


MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024
PDF_MAGIC = b"%PDF-"
SITE_IDS_BY_PREFIX = {
    "FLC-2.1": ("site:iroquois-falls",),
    "FLC-2.2": ("site:twin-falls",),
    "FLC-2.4": ("site:island-falls",),
    "FLC-3.9": ("site:calm-lake", "site:sturgeon-falls"),
}
CODE_RE = re.compile(r"(FLC-\d+(?:\.\d+)+(?:-[A-Z0-9]+)*)", re.IGNORECASE)
REVISION_RE = re.compile(r"(?:REV(?:ISION)?|RC)[_ -]*([A-Z0-9.]+)", re.IGNORECASE)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_relative_path(name: str) -> PurePosixPath:
    value = PurePosixPath(str(name).replace("\\", "/"))
    if (
        not value.parts
        or value.is_absolute()
        or ".." in value.parts
        or any(":" in part for part in value.parts)
    ):
        raise ValueError(f"unsafe archive entry: {name!r}")
    if any(part in {"", "."} for part in value.parts):
        raise ValueError(f"unsafe archive entry: {name!r}")
    return value


def is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def document_metadata(relative_path: PurePosixPath, file_path: Path) -> dict[str, object]:
    filename = relative_path.name
    stem = Path(filename).stem
    code_match = CODE_RE.search(stem)
    code = code_match.group(1).upper() if code_match else ""
    revision_match = REVISION_RE.search(stem)
    language = "French" if any(part.upper() == "FRENCH" for part in relative_path.parts) else "English"
    site_ids: tuple[str, ...] = ()
    for prefix, mapped_sites in SITE_IDS_BY_PREFIX.items():
        if code.startswith(prefix):
            site_ids = mapped_sites
            break
    title = re.sub(r"\s+", " ", stem.replace("_", " ")).strip()
    kind = "Appendix" if "APP-" in code or "APPENDIX" in title.upper() else "Procedure"
    if "FORM" in title.upper() or "FORMULAIRE" in title.upper():
        kind = "Form"
    digest = sha256_file(file_path)
    identifier = "flc-" + hashlib.sha256(relative_path.as_posix().lower().encode("utf-8")).hexdigest()[:16]
    return {
        "id": identifier,
        "title": title,
        "procedureCode": code,
        "revision": revision_match.group(1).upper() if revision_match else "Unspecified in filename",
        "kind": kind,
        "language": language,
        "siteIds": list(site_ids),
        "relativePath": relative_path.as_posix(),
        "filename": filename,
        "bytes": file_path.stat().st_size,
        "sha256": digest,
        "status": "LEGACY_REFERENCE",
    }


def extract_archive(archive_path: Path, library_root: Path) -> list[dict[str, object]]:
    if library_root.exists() and any(library_root.iterdir()):
        raise ValueError(f"destination already contains files: {library_root}")
    library_root.mkdir(parents=True, exist_ok=True)
    files_root = (library_root / "files").resolve()
    files_root.mkdir()
    seen: set[str] = set()
    documents: list[dict[str, object]] = []

    with zipfile.ZipFile(archive_path) as archive:
        entries = [entry for entry in archive.infolist() if not entry.is_dir()]
        total_size = sum(entry.file_size for entry in entries)
        if total_size > MAX_UNCOMPRESSED_BYTES:
            raise ValueError("archive exceeds the 500 MB import limit")
        for entry in entries:
            relative_path = safe_relative_path(entry.filename)
            if relative_path.suffix.lower() != ".pdf":
                raise ValueError(f"archive contains a non-PDF file: {entry.filename}")
            collision_key = relative_path.as_posix().lower()
            if collision_key in seen:
                raise ValueError(f"archive contains a duplicate path: {entry.filename}")
            seen.add(collision_key)
            destination = (files_root.joinpath(*relative_path.parts)).resolve()
            if not is_within(destination, files_root):
                raise ValueError(f"archive entry escapes destination: {entry.filename}")
            destination.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(entry) as source, destination.open("xb") as target:
                shutil.copyfileobj(source, target, length=1024 * 1024)
            with destination.open("rb") as handle:
                if handle.read(len(PDF_MAGIC)) != PDF_MAGIC:
                    raise ValueError(f"archive entry is not a PDF: {entry.filename}")
            documents.append(document_metadata(relative_path, destination))

    if not documents:
        raise ValueError("archive did not contain any PDF documents")
    documents.sort(key=lambda document: (
        str(document["language"]), str(document["procedureCode"]), str(document["title"])
    ))
    return documents


def write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def write_import_summary(path: Path, manifest: dict[str, object], archive_name: str) -> None:
    documents = manifest["documents"]
    assert isinstance(documents, list)
    english = sum(item.get("language") == "English" for item in documents if isinstance(item, dict))
    french = sum(item.get("language") == "French" for item in documents if isinstance(item, dict))
    path.write_text(
        "# FirstLight legacy SOP library import\n\n"
        "Status: LEGACY_REFERENCE — review the owner, revision, and current applicability before use.\n\n"
        f"- Source archive: `{archive_name}`\n"
        f"- PDFs imported: {len(documents)} ({english} English, {french} French)\n"
        f"- Imported at: {manifest['importedAt']}\n"
        f"- Source archive SHA-256: `{manifest['sourceArchiveSha256']}`\n"
        "- Storage: private `data/controlled-sources`; documents are not public static files.\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="ZIP archive containing PDF SOPs")
    parser.add_argument("library_root", type=Path, help="private controlled-source destination")
    parser.add_argument("output_dir", type=Path, help="local delivery folder")
    args = parser.parse_args()

    archive_path = args.archive.resolve()
    if not archive_path.is_file():
        raise ValueError(f"archive not found: {archive_path}")
    library_root = args.library_root.resolve()
    output_dir = args.output_dir.resolve()
    documents = extract_archive(archive_path, library_root)
    manifest: dict[str, object] = {
        "schemaVersion": 1,
        "sourceName": "FirstLight legacy SOP library",
        "status": "LEGACY_REFERENCE",
        "notice": (
            "These source PDFs are legacy reference material supplied for general guidance. "
            "They are not approved as current NorthStar procedures and must be reviewed before reliance."
        ),
        "importedAt": datetime.now(timezone.utc).isoformat(),
        "sourceArchive": archive_path.name,
        "sourceArchiveSha256": sha256_file(archive_path),
        "documents": documents,
    }
    write_json(library_root / "manifest.json", manifest)
    write_import_summary(library_root / "README.md", manifest, archive_path.name)

    output_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(archive_path, output_dir / archive_path.name)
    write_json(output_dir / "SOP-library-import-manifest.json", manifest)
    write_import_summary(output_dir / "README.md", manifest, archive_path.name)
    print(json.dumps({"libraryRoot": str(library_root), "outputDir": str(output_dir), "documents": len(documents)}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(f"SOP import failed: {error}", file=sys.stderr)
        raise SystemExit(2)
