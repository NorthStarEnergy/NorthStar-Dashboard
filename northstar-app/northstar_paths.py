"""Stable application-root lookup for source and frozen desktop runtimes."""

from __future__ import annotations

import os
from pathlib import Path


def app_root(module_file: str) -> Path:
    """Return the immutable application source root, never the per-user data root."""
    configured = os.environ.get("NORTHSTAR_APP_ROOT", "").strip()
    return Path(configured).expanduser().resolve() if configured else Path(module_file).resolve().parent
