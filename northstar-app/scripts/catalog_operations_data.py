"""Run the read-only operation-source catalog from a trusted local shell."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import northstar_data_catalog as catalog
import northstar_store as store


if __name__ == "__main__":
    store.init_db()
    result = catalog.refresh_known_sources("local catalog intake")
    print(json.dumps(result["summary"], indent=2))
