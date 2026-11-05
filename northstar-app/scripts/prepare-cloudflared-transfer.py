"""Create a separately encrypted Cloudflare connector-transfer package.

The live connector remains running.  This script never prints its token and
removes the transient plaintext ZIP once the NSMIG001 ciphertext is produced.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
from datetime import datetime, timezone
from zipfile import ZIP_STORED, ZipFile

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

ROOT = Path(__file__).resolve().parents[1]
HEADER = b"NSMIG001"
CHUNK = 1024 * 1024
TOKEN = Path(r"C:\ProgramData\cloudflared\token")


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(CHUNK), b""):
            hasher.update(block)
    return hasher.hexdigest()


def encrypt(plain: Path, encrypted: Path, recipient: Path) -> dict:
    public_key = serialization.load_pem_public_key(recipient.read_bytes())
    aes_key = os.urandom(32)
    nonce = os.urandom(12)
    wrapped = public_key.encrypt(
        aes_key,
        padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None),
    )
    if len(wrapped) != 384:
        raise RuntimeError("Recipient key does not produce the required RSA-3072 envelope.")
    cipher = Cipher(algorithms.AES(aes_key), modes.GCM(nonce)).encryptor()
    with plain.open("rb") as source, encrypted.open("wb") as target:
        target.write(HEADER)
        target.write(wrapped)
        target.write(nonce)
        for block in iter(lambda: source.read(CHUNK), b""):
            target.write(cipher.update(block))
        target.write(cipher.finalize())
        target.write(cipher.tag)
    return {"bytes": encrypted.stat().st_size, "sha256": digest(encrypted)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recipient-public-key", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "outputs/pc-migration-20261019")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    plain = output / "northstar-cloudflared-connector.zip"
    encrypted = output / "northstar-cloudflared-connector.nsmig"
    report = output / "cloudflared-connector-inventory.json"
    if encrypted.exists() or plain.exists():
        raise RuntimeError("Refusing to replace an existing connector-transfer artifact.")
    if not TOKEN.is_file():
        raise RuntimeError("Configured Cloudflare token file is unavailable.")
    try:
        with ZipFile(plain, "w", compression=ZIP_STORED) as archive:
            archive.write(TOKEN, "secure/cloudflared/token")
            config = ROOT / "cloudflared-config.yml"
            if config.is_file():
                archive.write(config, "configuration/cloudflared-config.yml")
            archive.writestr(
                "restore-notes.txt",
                "Install cloudflared on the new PC, place the token in its protected service location, "
                "and validate the connector only during an explicitly approved cutover. Do not rotate "
                "or disable the source connector during preparation.\n",
            )
            archive.writestr(
                "manifest.json",
                json.dumps({
                    "createdUtc": datetime.now(timezone.utc).isoformat(),
                    "purpose": "NorthStar Cloudflare connector transfer",
                    "tokenIncluded": True,
                    "tokenPath": "secure/cloudflared/token",
                    "sourceConnectorChanged": False,
                }, indent=2, sort_keys=True),
            )
        crypto = encrypt(plain, encrypted, args.recipient_public_key)
        report.write_text(json.dumps({
            "createdUtc": datetime.now(timezone.utc).isoformat(),
            "envelope": "NSMIG001",
            "artifact": encrypted.name,
            "ciphertext": crypto,
            "sourceConnectorChanged": False,
            "plaintextRetained": False,
        }, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps({"artifact": str(encrypted), "sha256": crypto["sha256"], "bytes": crypto["bytes"]}))
    finally:
        plain.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
