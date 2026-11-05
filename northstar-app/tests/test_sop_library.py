import hashlib
import json

import pytest

import northstar_sop_library as sop_library


@pytest.fixture
def imported_sop(tmp_path, monkeypatch):
    root = tmp_path / "legacy-sops"
    document = root / "files" / "FINAL PDF SOPs" / "ENGLISH" / "FLC-2.2-C-02 - Twin Falls GS Black Start Procedure.pdf"
    document.parent.mkdir(parents=True)
    body = b"%PDF-1.7\nlegacy reference fixture\n"
    document.write_bytes(body)
    manifest = {
        "schemaVersion": 1,
        "status": "LEGACY_REFERENCE",
        "documents": [
            {
                "id": "flc-0123456789abcdef",
                "title": "Twin Falls GS Black Start Procedure",
                "procedureCode": "FLC-2.2-C-02",
                "revision": "Unspecified in filename",
                "kind": "Procedure",
                "language": "English",
                "siteIds": ["site:twin-falls"],
                "relativePath": "FINAL PDF SOPs/ENGLISH/FLC-2.2-C-02 - Twin Falls GS Black Start Procedure.pdf",
                "filename": document.name,
                "bytes": len(body),
                "sha256": hashlib.sha256(body).hexdigest(),
                "status": "LEGACY_REFERENCE",
            },
            {
                "id": "flc-fedcba9876543210",
                "title": "Unsafe path must not load",
                "relativePath": "../outside.pdf",
                "bytes": len(body),
                "sha256": hashlib.sha256(body).hexdigest(),
            },
        ],
    }
    (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    monkeypatch.setenv("NORTHSTAR_SOP_LIBRARY_ROOT", str(root))
    return document, body


def test_legacy_sop_catalog_is_scoped_and_marks_review_required(imported_sop):
    global_catalog = sop_library.catalog()
    station_catalog = sop_library.catalog("site:twin-falls")
    other_station_catalog = sop_library.catalog("site:iroquois-falls")

    assert global_catalog["status"] == "LEGACY_REFERENCE"
    assert "Verify" in global_catalog["notice"]
    assert [row["id"] for row in global_catalog["documents"]] == ["flc-0123456789abcdef"]
    assert [row["id"] for row in station_catalog["documents"]] == ["flc-0123456789abcdef"]
    assert other_station_catalog["documents"] == []
    assert global_catalog["documents"][0]["href"] == "/api/library/procedures/flc-0123456789abcdef/file"


def test_legacy_sop_reader_verifies_pdf_magic_and_manifest_checksum(imported_sop):
    document, body = imported_sop
    record, served = sop_library.read_document("flc-0123456789abcdef")
    assert record["filename"] == document.name
    assert served == body

    document.write_bytes(b"%PDF-1.7\ntampered\n")
    with pytest.raises(sop_library.DocumentIntegrityError):
        sop_library.read_document("flc-0123456789abcdef")
