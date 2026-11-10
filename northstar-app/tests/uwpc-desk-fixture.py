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
    import uwpc_evidence_fixture as evidence_fixture

    store.init_db()
    if os.environ.get("OUTAGE_MANAGER_FIXTURE"):
        import base64
        import uuid
        import northstar_outage_manager as manager
        import northstar_operator_knowledge as knowledge
        snapshot=Path(temp)/"devices.json"
        snapshot.write_text(json.dumps({"assets":[{"site":"FFO","location":loc,"assetNum":tag,"description":"Fixture breaker"}
            for loc,tag in [("FFO-NOG-200","FIX-N"),("FFO-KEG-200","FIX-K")]]}))
        os.environ["NORTHSTAR_MAXIMO_SNAPSHOT"]=str(snapshot)
        for title, site, asset, day in [
            ("Unit 2 stator inspection", "Twin Falls", "Unit 2", 8),
            ("Feeder protection review", "Iroquois Falls", "115 kV feeder", 11),
            ("Intake gate maintenance", "Norman", "Gate 3", 14),
        ]:
            planned=manager.create_request({"requestKey":str(uuid.uuid4()),"title":title,"site":site,"asset":asset,
                "scope":"Scheduled inspection","severity":"Monitor","reviewTrigger":"routine",
                "start":f"2030-09-{day:02d}T13:00:00Z","end":f"2030-09-{day:02d}T21:00:00Z"},"fixture_author")
            if site=="Twin Falls":
                with desk.session() as c:
                    saved=desk.read(c,planned["packageId"])
                    saved["switchingPlan"]["steps"]=[{"device":"FIX-TW","operation":"Record FIX-TW at Twin Falls","lockNo":"L1","completedBy":"fixture_relief"}]
                    desk.write(c,saved)
        past = store.create_outage({"title":"Completed valve inspection","site":"Norman","type":"Planned"},"fixture_author")
        store.close_outage(past["id"],"fixture_author")
        book = os.environ.get("OUTAGE_MANAGER_FIXTURE_BOOK")
        if book:
            row = knowledge.upload({"sourceKey":"uwpc-2024","filename":"uwpc-2024.pdf","revision":"2024",
                "title":"Utility Work Protection Code 2024","contentBase64":base64.b64encode(Path(book).read_bytes()).decode()},"fixture_author")
            knowledge.review(row["id"],{"status":"REFERENCE_ONLY","reason":"Isolated library verification"},"fixture_author")
    backend.OPERATOR_HOST = "127.0.0.1"
    backend.CHECKIN_ORIGIN = "https://fixture-public.invalid"
    roster = {"manager": ["fixture_author"], "operator": ["fixture_operator", "fixture_relief"],
              "checker": ["fixture_operator"], "area": ["fixture_area"], "field": ["fixture_north", "fixture_south"]}
    accounts = sorted({name for names in roster.values() for name in names} | {"Ryan"})
    backend.DEMO_AUTH = {"accounts": [auth.build_config(name, "fixture-only-password") for name in accounts]}
    roster_path = Path(temp) / "outage-review-directory.json"
    roster_path.write_text(json.dumps(roster))
    os.environ["NORTHSTAR_OUTAGE_REVIEW_DIRECTORY"] = str(roster_path)
    if not os.environ.get("UWPC_TEST_MISSING_EVIDENCE"):
        desk.evidence.prepare = evidence_fixture.bundle
        desk.generate_text = evidence_fixture.generate
    else:
        def forbid_model(*args):
            raise AssertionError("Missing evidence must not call AI")
        desk.generate_text = forbid_model
    server = backend.NorthstarHTTPServer(("127.0.0.1", 0), backend.Handler)
    print(json.dumps({"port": server.server_port}), flush=True)
    server.serve_forever()
