"""Isolated HTTP fixture used by uwpc-desk.browser.cjs. Never touches live data."""
import json
import os
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
with tempfile.TemporaryDirectory(prefix="northstar-uwpc-test-") as temp:
    os.environ["NORTHSTAR_DB"] = str(Path(temp) / "fixture.db")
    os.environ["NORTHSTAR_OPERATOR_GATE"] = "demo"
    os.environ["NORTHSTAR_DEMO_AUTH_FILE"] = str(Path(temp) / "absent.json")
    import ieso_backend as backend
    import northstar_store as store
    import northstar_auth as auth
    import northstar_uwpc_desk as desk

    store.init_db()
    backend.OPERATOR_HOST = "127.0.0.1"
    backend.CHECKIN_ORIGIN = "https://fixture-public.invalid"
    backend.DEMO_AUTH = {"accounts": [auth.build_config(name, "fixture-only-password") for name in ("fixture_author", "fixture_operator")]}
    desk.generate_text = lambda row, sources: ("DRAFT — SYNTHETIC TEST ONLY\nDiagram findings: Fixture feeder F1 [" + sources[0]["id"] + "]\nProposed guarantee: pending operator review. No operating steps or release.", "fixture")
    server = backend.NorthstarHTTPServer(("127.0.0.1", 0), backend.Handler)
    print(json.dumps({"port": server.server_port}), flush=True)
    server.serve_forever()
