"""Create an encrypted, source-consistent NorthStar migration package.

The package uses the NSMIG001 envelope expected by the new PC.  It never
prints secret values and removes plaintext staging files after encryption.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from zipfile import ZIP_STORED, ZipFile

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import northstar_store as store

HEADER = b"NSMIG001"
CHUNK = 16 * 1024 * 1024
CONTROLLED_DIRS = (
    "controlled-sources", "daily-report", "incident-library", "market-history",
    "maximo", "service-requests", "voice-models", "water-management",
)
CONTROLLED_FILES = (
    "dashboard-layout-default.json", "engineering-reference-sources.json",
    "knowledge-index.json", "northstar-foundation.db", "voice-local.enabled",
)
SENSITIVE_FILES = (
    ".env.local", "data/.northstar-demo-auth.json", "data/.northstar-qr-secret",
    "data/.northstar-data-postgres.json", "data/postgres-runtime/admin.json",
)


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(CHUNK), b""):
            h.update(block)
    return h.hexdigest()


def add_file(archive: ZipFile, source: Path, name: str, manifest: list[dict]) -> None:
    archive.write(source, name)
    manifest.append({"path": name, "bytes": source.stat().st_size, "sha256": digest(source)})


def add_tree(archive: ZipFile, source: Path, prefix: str, manifest: list[dict]) -> None:
    if not source.exists():
        return
    for item in sorted(path for path in source.rglob("*") if path.is_file()):
        add_file(archive, item, f"{prefix}/{item.relative_to(source).as_posix()}", manifest)


def source_manifest() -> dict:
    revision = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, capture_output=True)
    status = subprocess.run(["git", "status", "--porcelain=v1"], cwd=ROOT, text=True, capture_output=True)
    build = (ROOT / "BUILD-VERSION.txt").read_text(encoding="utf-8", errors="replace").splitlines()
    return {
        "gitRevision": revision.stdout.strip() if revision.returncode == 0 else None,
        "dirtyPaths": [line[3:] for line in status.stdout.splitlines() if line.strip()],
        "buildVersion": build[:3],
        "requirements": (ROOT / "requirements.txt").read_text(encoding="utf-8", errors="replace").splitlines(),
    }


def sqlite_snapshot(destination: Path) -> dict:
    """Use the application's SQLite backup API pattern while it remains live."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    with store._LOCK:
        source = sqlite3.connect(store.DB_PATH, timeout=30)
        try:
            target = sqlite3.connect(destination)
            try:
                source.backup(target)
            finally:
                target.close()
        finally:
            source.close()
    with sqlite3.connect(destination) as verify:
        check = verify.execute("PRAGMA quick_check").fetchone()[0]
    if check.lower() != "ok":
        raise RuntimeError(f"SQLite migration snapshot quick_check failed: {check}")
    return {"bytes": destination.stat().st_size, "sha256": digest(destination), "quickCheck": check}


def postgres_snapshot(destination: Path) -> dict:
    config_path = ROOT / "data/.northstar-data-postgres.json"
    runtime_path = ROOT / "data/postgres-runtime/runtime.json"
    if not config_path.exists() or not runtime_path.exists():
        return {"configured": False}
    settings = json.loads(config_path.read_text(encoding="utf-8"))
    runtime = json.loads(runtime_path.read_text(encoding="utf-8"))
    executable = Path(runtime["bin"]) / ("pg_dump.exe" if os.name == "nt" else "pg_dump")
    restore = Path(runtime["bin"]) / ("pg_restore.exe" if os.name == "nt" else "pg_restore")
    if not executable.exists() or not restore.exists():
        return {"configured": True, "created": False, "reason": "PostgreSQL dump binaries unavailable"}
    environment = os.environ.copy()
    environment["PGPASSWORD"] = str(settings["password"])
    destination.parent.mkdir(parents=True, exist_ok=True)
    command = [str(executable), "--host", str(settings["host"]), "--port", str(settings["port"]),
               "--username", str(settings["user"]), "--format=custom", "--no-owner", "--no-privileges",
               "--file", str(destination), str(settings["dbname"])]
    result = subprocess.run(command, env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                            stderr=subprocess.PIPE, text=True)
    if result.returncode:
        raise RuntimeError("PostgreSQL logical backup failed without changing the live database.")
    checked = subprocess.run([str(restore), "--list", str(destination)], env=environment,
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                             text=True)
    if checked.returncode:
        raise RuntimeError("PostgreSQL logical backup verification failed.")
    return {"configured": True, "created": True, "bytes": destination.stat().st_size,
            "sha256": digest(destination), "format": "pg_dump custom", "verified": True}


def encrypt(plain: Path, encrypted: Path, recipient: Path) -> dict:
    key = serialization.load_pem_public_key(recipient.read_bytes())
    aes = os.urandom(32)
    nonce = os.urandom(12)
    wrapped = key.encrypt(aes, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    if len(wrapped) != 384:
        raise RuntimeError("Recipient key does not produce the required 384-byte RSA-3072 envelope.")
    cipher = Cipher(algorithms.AES(aes), modes.GCM(nonce)).encryptor()
    with plain.open("rb") as source, encrypted.open("wb") as target:
        target.write(HEADER)
        target.write(wrapped)
        target.write(nonce)
        for block in iter(lambda: source.read(CHUNK), b""):
            target.write(cipher.update(block))
        target.write(cipher.finalize())
        target.write(cipher.tag)
    return {"bytes": encrypted.stat().st_size, "sha256": digest(encrypted), "recipientPublicKeySha256": digest(recipient)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recipient-public-key", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "outputs/pc-migration-20261019")
    args = parser.parse_args()
    output = args.output.resolve()
    private = output / "private-staging"
    plain = output / "northstar-live-migration.zip"
    encrypted = output / "northstar-live-migration.nsmig"
    report = output / "migration-inventory.json"
    if encrypted.exists():
        raise RuntimeError(f"Refusing to replace existing encrypted migration bundle: {encrypted}")
    if private.exists() or plain.exists():
        raise RuntimeError("Remove a prior incomplete private staging directory before retrying.")
    private.mkdir(parents=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    sqlite_file = private / f"northstar-{timestamp}.db"
    postgres_file = private / f"northstar-data-{timestamp}.dump"
    manifest: list[dict] = []
    try:
        daily = store.daily_backup()
        sqlite = sqlite_snapshot(sqlite_file)
        postgres = postgres_snapshot(postgres_file)
        with ZipFile(plain, "w", compression=ZIP_STORED, allowZip64=True) as archive:
            add_file(archive, sqlite_file, "data/northstar.db", manifest)
            if postgres.get("created"):
                add_file(archive, postgres_file, "data/northstar_data.pg_dump", manifest)
            for name in CONTROLLED_DIRS:
                add_tree(archive, ROOT / "data" / name, f"data/{name}", manifest)
            for name in CONTROLLED_FILES:
                path = ROOT / "data" / name
                if path.exists():
                    add_file(archive, path, f"data/{name}", manifest)
            for relative in SENSITIVE_FILES:
                path = ROOT / relative
                if path.exists():
                    add_file(archive, path, f"secure/{relative}", manifest)
            for relative in ("cloudflared-config.yml", "start-northstar.ps1", "requirements.txt", "BUILD-VERSION.txt", "dashboard-layout-default.js"):
                path = ROOT / relative
                if path.exists():
                    add_file(archive, path, f"source-overlay/{relative}", manifest)
            internal = {"createdUtc": datetime.now(timezone.utc).isoformat(), "files": manifest,
                        "source": source_manifest(), "restoreNotes": [
                            "Decrypt with the new PC private key using the NSMIG001 envelope.",
                            "Restore the SQLite snapshot before starting the new backend.",
                            "Restore the PostgreSQL dump with pg_restore into a freshly provisioned target cluster.",
                            "Do not transfer the old cloudflared token; create a target connector at cutover.",
                        ]}
            archive.writestr("migration-manifest.json", json.dumps(internal, indent=2, sort_keys=True))
        crypto = encrypt(plain, encrypted, args.recipient_public_key)
        nonsecret = {
            "createdUtc": datetime.now(timezone.utc).isoformat(), "envelope": "NSMIG001",
            "artifact": encrypted.name, "ciphertext": crypto, "sqlite": sqlite,
            "postgres": postgres, "dailyBackupUpdated": str(daily) if daily else "already-current",
            "source": source_manifest(), "includedGroups": list(CONTROLLED_DIRS),
            "sensitiveConfigurationCount": sum((ROOT / item).exists() for item in SENSITIVE_FILES),
            "transfer": "Upload only the .nsmig ciphertext to the owner-only migration folder; retain no plaintext archive.",
        }
        report.write_text(json.dumps(nonsecret, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps({"encrypted": str(encrypted), "sha256": crypto["sha256"], "bytes": crypto["bytes"], "report": str(report)}))
    finally:
        plain.unlink(missing_ok=True)
        shutil.rmtree(private, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
