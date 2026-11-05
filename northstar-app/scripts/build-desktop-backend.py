"""Build the self-contained NorthStar backend used by the Windows desktop installer."""

from __future__ import annotations

import hashlib
import importlib.util
import os
import shutil
import stat
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "desktop-build"
STAGED_SOURCE = BUILD / "app-source"
RELEASE_PARITY_FILES = (
    "BUILD-VERSION.txt",
    "dashboard-build-data.js",
    "northstar-clean.html",
    "client-release-update.js",
    "ieso_backend.py",
    "northstar_client_release.py",
)


def file_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_staged_source() -> None:
    """Reject a desktop build whose visible dashboard release is stale."""
    mismatched = [
        name
        for name in RELEASE_PARITY_FILES
        if not (STAGED_SOURCE / name).is_file()
        or file_digest(ROOT / name) != file_digest(STAGED_SOURCE / name)
    ]
    if mismatched:
        raise RuntimeError("desktop source staging is stale: " + ", ".join(mismatched))


def stage_source() -> None:
    """Copy only runtime source; never let installer packaging traverse node_modules or data."""
    ignored_top_level = {
        ".git", ".github", ".pytest_cache", ".wrangler", "data", "desktop-build",
        "desktop-dist", "dist", "node_modules", "output", "outputs", "tmp", "tools",
    }

    def ignore(directory: str, names: list[str]) -> set[str]:
        ignored = {name for name in names if name in ignored_top_level}
        if "mobile-android" in Path(directory).parts:
            ignored.add("build")
        ignored.update(name for name in names if name.startswith(".env") or name.endswith(".log"))
        ignored.update(name for name in names if name == "__pycache__" or name.endswith(".pyc"))
        return ignored

    def remove_readonly(function: object, path: str, _error: object) -> None:
        os.chmod(path, stat.S_IWRITE)
        function(path)

    if STAGED_SOURCE.exists():
        shutil.rmtree(STAGED_SOURCE, onerror=remove_readonly, ignore_errors=False)
    shutil.copytree(ROOT, STAGED_SOURCE, ignore=ignore)
    verify_staged_source()


def remove_tree(path: Path) -> None:
    """Remove generated output, including read-only files left by signing tools."""
    if not path.exists():
        return

    def remove_readonly(function: object, target: str, _error: object) -> None:
        os.chmod(target, stat.S_IWRITE)
        function(target)

    shutil.rmtree(path, onerror=remove_readonly)


def promote_backend(dist_path: Path) -> None:
    """Promote a unique PyInstaller result to the path electron-builder consumes."""
    built_backend = dist_path / "northstar-backend"
    target = BUILD / "northstar-backend"
    if not built_backend.is_dir():
        raise RuntimeError(f"PyInstaller completed without {built_backend}")
    remove_tree(target)
    shutil.copytree(built_backend, target)


def main() -> int:
    if importlib.util.find_spec("PyInstaller") is None:
        print("PyInstaller is required. Install it with: python -m pip install pyinstaller")
        return 2
    stage_source()
    build_stamp = f"{time.strftime('%Y%m%d-%H%M%S')}-{time.time_ns() % 1000000:06d}"
    dist_path = BUILD / f"backend-dist-{build_stamp}"
    command = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm", "--clean", "--onedir",
        "--name", "northstar-backend",
        "--distpath", str(dist_path),
        "--workpath", str(BUILD / f"work-{build_stamp}"),
        "--specpath", str(BUILD / "spec"),
        "--paths", str(ROOT),
        "--collect-all", "msal",
        "--collect-all", "msal_extensions",
        str(ROOT / "ieso_backend.py"),
    ]
    result = subprocess.call(command, cwd=ROOT)
    if result == 0:
        promote_backend(dist_path)
    return result


if __name__ == "__main__":
    raise SystemExit(main())
