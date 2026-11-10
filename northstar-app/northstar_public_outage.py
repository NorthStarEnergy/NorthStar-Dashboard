"""Passcode sessions and the explicitly shared Outage Manager HTTP surface."""
import hashlib
import hmac
import re
import secrets
import sqlite3
import time
from contextlib import closing
from functools import lru_cache
from urllib.parse import parse_qs, urlsplit

import northstar_auth as auth
import northstar_outage_manager as manager
import northstar_outage_review as review
from datetime import datetime, timedelta, timezone
import northstar_store as store
import northstar_uwpc_desk as desk

PREFIX = "/public-outage-api"
TTL = 7 * 24 * 3600
throttle = auth.LoginThrottle(max_failures=12, window_seconds=60)
READ = {"manager/session","manager/register","manager/detail","manager/reports","manager/inbox",
        "manager/checkout","manager/plans","manager/plan-versions"}
WRITE = {"manager/create","manager/checkout","manager/tag","manager/inbox/open"}
DOC = r"uwpc_[0-9a-f]{32}"
DOC_ACTIONS = {"save","sources","remove-source","review-view","review-open","review-sign","review-return",
               "review-answer","review-close","distribute","final-receipt","final-flag","final-resolve",
               "log-open","log-entry","log-close","closeout-note","phase","correspondence","route","signoff"}


DEMO_SITES = ("Training Station A", "Training Station B")


def seed_examples(c):
    c.row_factory = sqlite3.Row
    c.execute("BEGIN IMMEDIATE")
    c.execute("CREATE TABLE IF NOT EXISTS demo_editions (edition INTEGER PRIMARY KEY)")
    if not c.execute("INSERT OR IGNORE INTO demo_editions VALUES (1)").rowcount:
        return
    for index, site in enumerate(DEMO_SITES):
        providing = index == 0
        asset = "Training Line A" if providing else "Training Line Switch B"
        title = "Provide SG for connected-line work" if providing else "Request SG for station line-switch work"
        station = f"Station Coordinator {index + 1}"
        utility = f"Hydro One Training Contact {index + 1}"
        issuer, recipient = (station, utility) if providing else (utility, station)
        scope = ("Hydro One training crew inspects its connected line. The requested guarantee covers the station-side boundary only."
                 if providing else "Station training crew inspects its line switch. The station requests a guarantee covering the Hydro One side of the connection.")
        reference = f"DEMO-SG-0{index + 1}"
        steps = [
            f"{recipient} records the proposed work, boundary and requested window under {reference}.",
            f"{issuer} and {recipient} compare the fictional boundary drawing and record the limits and exclusions.",
            f"{issuer} records the simulated guarantee terms. {recipient} reads back the terms and records receipt.",
            "The work coordinator links the guarantee to the separate work authorization in the exercise log.",
            f"After the simulated work authorization is closed, {recipient} returns the guarantee to {issuer}. Both log its release.",
        ]
        start = datetime.now(timezone.utc) + timedelta(days=7 + index)
        schedule = dict(start=start.isoformat(), end=(start + timedelta(hours=3)).isoformat())
        outage = store.insert_outage(c, dict(title=title, site=site, asset=asset, type="Planned", details=scope), station)
        shared = dict(site=site, outageId=outage["id"], scope=scope, authority=issuer, reference=reference,
                      equipment=asset, diagramRevision=f"Exercise boundary {index + 1}, revision A", **schedule)
        plan = desk.create(dict(shared, title=title, kind="SWITCHING_PLAN", template="pc17a",
                                switchingPlan=dict(purpose="Tabletop coordination exercise. " + scope, preparedBy=station,
                                steps=[dict(device=asset, operation=step) for step in steps])), station, connection=c)
        plan["registerOutage"] = outage["id"]
        desk.write(c, plan)
        desk.create(dict(shared, title=f"{reference} · {title}", kind="PROVIDE_GUARANTEE" if providing else "REQUEST_GUARANTEE",
                         template="pc17b-sg" if providing else "pc10c-sg", description=scope,
                         notes=f"Exercise copy. Issuer: {issuer}. Recipient: {recipient}.\n" + "\n".join(steps)),
                    station, connection=c)


@lru_cache(maxsize=4)
def initialize(path):
    path.parent.mkdir(parents=True,exist_ok=True)
    with closing(sqlite3.connect(path,timeout=10)) as c, c:
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript(store.SCHEMA)
        desk.init_schema(c)
        c.execute("""CREATE TABLE IF NOT EXISTS visitor_sessions(
            id INTEGER PRIMARY KEY AUTOINCREMENT, digest TEXT UNIQUE NOT NULL, expires INTEGER NOT NULL)""")


        seed_examples(c)


def issue_session(path):
    token=secrets.token_hex(32)
    digest=hashlib.sha256(token.encode()).hexdigest()
    with closing(sqlite3.connect(path,timeout=5)) as c,c:
        c.execute("DELETE FROM visitor_sessions WHERE expires<=?",(time.time(),))
        number=c.execute("INSERT INTO visitor_sessions(digest,expires) VALUES(?,?)",(digest,time.time()+TTL)).lastrowid
    return {"token":token,"actor":f"Tester{number:02d}","maxAge":TTL}


def identity(path,token):
    if not re.fullmatch("[0-9a-f]{64}",token):
        return None
    digest=hashlib.sha256(token.encode()).hexdigest()
    with closing(sqlite3.connect(path,timeout=5)) as c:
        who=c.execute("SELECT id FROM visitor_sessions WHERE digest=? AND expires>?",(digest,time.time())).fetchone()
        if who:
            accounts=[f"Tester{r[0]:02d}" for r in c.execute("SELECT id FROM visitor_sessions WHERE expires>? ORDER BY id",(time.time(),))]
            return f"Tester{who[0]:02d}",accounts


def allowed(method,path):
    if method=="GET":
        return path in READ or re.fullmatch(DOC+r"(?:/exports/(?:pdf|xlsx|package|final)|/sources/src_[a-f0-9]{32})?",path)
    if method=="POST":
        doc,_,action=path.partition("/")
        return path in WRITE or path=="" or (re.fullmatch(DOC,doc) and action in DOC_ACTIONS)
    return False


def handle(h):
    def fail(status,message):
        h._send_json({"error":message},status)
    if not h._is_operator_host() or h._is_public_checkin_host():
        return fail(404,"Page not found")
    req=urlsplit(h.path)
    route=req.path[len(PREFIX)+1:]
    if h.command not in {"GET","POST"}:
        return fail(405,"Method unavailable")
    # Visitor requests use a bearer token. Operator cookies and identity headers
    # cannot authorize this API, and a visitor token never enters operator auth.
    if h.command=="POST" and (h.headers.get("Origin") or h.headers.get("Transfer-Encoding")):
        return fail(403,"Use the Outage Manager entry page")
    path=store.DB_PATH.parent/"outage-visitors"/"fictional-outages-v1.sqlite3"
    if route=="entry" and h.command=="POST":
        ip=h.headers.get("CF-Connecting-IP") or h.client_address[0]
        if not throttle.check(ip)[0]:
            return fail(429,"Try again in a minute")
        try:
            payload=h._json_body(512)
        except Exception:
            return fail(400,"Enter a passcode")
        code=payload.get("passcode")
        if not isinstance(code,str) or not hmac.compare_digest(code.encode(),b"demo"):
            throttle.record_failure(ip)
            return fail(401,"Incorrect passcode")
        throttle.reset(ip)
        initialize(path)
        return h._send_json(issue_session(path),201)
    token=h.headers.get("Authorization","").removeprefix("Bearer ")
    who=identity(path,token) if path.is_file() else None
    if not who:
        return fail(401,"Enter the Outage Manager passcode")
    if route=="identity" and h.command=="GET":
        return h._send_json({"actor":who[0]})
    context=review.VISITOR_DB.set(path)
    try:
        if route=="logout" and h.command=="POST":
            with desk.session() as c:
                c.execute("DELETE FROM visitor_sessions WHERE digest=?",(hashlib.sha256(token.encode()).hexdigest(),))
            return h._send_json({"signedOut":True})
        if route=="sites" and h.command=="GET":
            return h._send_json({"options":[{"name": name, "id": name, "kind": "site"} for name in DEMO_SITES]})
        if route=="manager/library" and h.command=="GET":
            return h._send_json({"referenceOnly":True,"forms":[{"code":v[0],"title":v[1]} for v in manager.FORMS.values()],
                                 "questions":manager.QUESTIONS})
        if route=="manager/devices" and h.command=="GET":
            selected=set(parse_qs(req.query).get("site",[]))
            with desk.session() as c:
                devices=[{"site":r[0],"ref":r[1],"label":""} for r in c.execute(
                    "SELECT DISTINCT site,asset FROM outages WHERE asset<>'' ORDER BY site,asset") if r[0] in selected]
            return h._send_json({"devices":devices})
        if not allowed(h.command,route):
            return fail(404,"This feature is unavailable in the visitor workspace")
        return h._uwpc_request_route("/api/uwpc/requests"+("/"+route if route else ""),visitor_identity=who)
    except sqlite3.Error:
        return fail(503,"Visitor storage is unavailable. Please try again later.")
    except Exception as exc:
        if hasattr(exc,"status") and isinstance(exc.status,int):
            return fail(exc.status,"Invalid visitor request")
        raise
    finally:
        review.VISITOR_DB.reset(context)
