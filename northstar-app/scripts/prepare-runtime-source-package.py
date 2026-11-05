"""Archive the current control-room runtime source without data or credentials."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "outputs" / "pc-migration-20261019"
ARCHIVE = OUTPUT / "northstar-control-room-runtime-source.zip"
REPORT = OUTPUT / "northstar-control-room-runtime-source-inventory.json"
EXCLUDED_PARTS = {".git", "data", "node_modules", "outputs", "__pycache__", ".pytest_cache", ".coordinator-private", "desktop-build"}
EXCLUDED_NAMES = {".env", ".env.local", ".northstar-demo-auth.json", ".northstar-qr-secret", ".northstar-data-postgres.json"}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def included(path: Path) -> bool:
    rel = path.relative_to(ROOT)
    if any(part in EXCLUDED_PARTS for part in rel.parts):
        return False
    return path.name not in EXCLUDED_NAMES and not path.name.startswith(".env.")


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    if ARCHIVE.exists():
        raise SystemExit(f"Refusing to replace existing archive: {ARCHIVE}")
    records = []
    with ZipFile(ARCHIVE, "w", compression=ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
        for source in sorted(p for p in ROOT.rglob("*") if p.is_file() and included(p)):
            name = source.relative_to(ROOT).as_posix()
            archive.write(source, name)
            records.append({"path": name, "bytes": source.stat().st_size, "sha256": sha256(source)})
        archive.writestr("runtime-source-manifest.json", json.dumps({"files": records}, indent=2, sort_keys=True))
    REPORT.write_text(json.dumps({
        "artifact": ARCHIVE.name,
        "ciphertext": False,
        "credentialExcluded": True,
        "excludedTopLevel": sorted(EXCLUDED_PARTS),
        "files": len(records),
        "bytes": ARCHIVE.stat().st_size,
        "sha256": sha256(ARCHIVE),
    }, indent=2) + "\n", encoding="utf-8")
    print(REPORT.read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
