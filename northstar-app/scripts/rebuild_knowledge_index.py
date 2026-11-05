"""Rebuild the approved NorthStar reference-file index."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import northstar_knowledge as knowledge


if __name__ == "__main__":
    print(knowledge.rebuild())
    print(knowledge.status())
