"""Operator-only outage register and UWPC reference library."""
import io
import json
import re
from datetime import datetime, timezone
import uuid
from functools import lru_cache

import northstar_operator_knowledge as knowledge
import northstar_outage_review as review
import northstar_store as store
import northstar_uwpc_desk as desk
import northstar_sites as station_directory
import northstar_maximo as maximo


BASE = "/api/uwpc/requests/manager"
BOOK_HASH = "35b0538aba82523068f183053c63df2f94f0d889296122eb3d531a12f8fbc463"
SECTIONS = [
    (1, "Front matter"), (8, "Glossary"), (14, "1 · Fundamentals of work protection"),
    (34, "2 · Work group members and holders"), (46, "3 · PC10A work permits"),
    (54, "4 · PC17B work permits"), (70, "5 · PC2 issued work permits"),
    (102, "6 · Supporting guarantees"), (118, "7 · De-energizing isolated equipment"),
    (126, "8 · Equipment protection"), (140, "Index"),
]
FORMS = {
    "pc1": ("PC1", "Application and holder’s record", [95, 96]),
    "pc2": ("PC2", "Issued work permit", [97, 98]),
    "pc3-pc15-series": ("PC3 / PC15", "Series tags", [93]),
    "pc3-pc15": ("PC3 / PC15", "Non-series tags", [94]),
    "pc4": ("PC4", "De-energizing device tag", [125]),
    "pc10a": ("PC10A", "Self-administered work permit tag", [52]),
    "pc10c": ("PC10C", "Supporting guarantee tag", [108]),
    "pc14": ("PC14", "Test zone form", [99, 100]),
    "pc15": ("PC15", "Test tag", [53]),
    "pc17a": ("PC17A", "Order to operate", [101]),
    "pc17b": ("PC17B", "Work protection form", [68, 69]),
    "hold-off": ("Hold-off", "Hold-off tag", [131]),
    "caution": ("Caution", "Caution tag", [134]),
    "caution-record": ("Caution", "Tag record", [135]),
    "series-caution": ("Caution", "Series tag", [136]),
    "terminal-point": ("Terminal point", "Terminal point tag", [138]),
}
# Page references use PDF page numbers, including the cover.
QUESTIONS = [
    ("What information identifies the job on a work permit?",
     "Its purpose, the equipment involved, the location, and the work or tests covered.", "1.013", 17),
    ("What must happen before using an electronically transmitted form?",
     "Confirm receipt of the information with the sender.", "1.101", 26),
    ("How do the parties verify information dictated by radio or telephone?",
     "Both parties verify the information by read-back.", "1.101", 26),
    ("How should a form copied for planning or historical records be identified?",
     "Mark it as a copy.", "1.101", 26),
    ("Who maintains the log for issued work permits and supporting guarantees?",
     "The controlling or issuing authority records those it issues.", "1.131", 30),
    ("What must a work group member understand for the particular day?",
     "Their responsibilities and accountabilities for their role and the scope of work.", "2.001", 36),
    ("How many devices can a PC10A work permit guarantee?", "One device. Section 3 also excludes supporting guarantees for this permit.", "3.002", 48),
    ("Which authority gives permission to work on a device outside your control under Section 4?", "The controlling authority.", "4.001", 56),
    ("Which permit does Section 5 specify when several work groups work independently under the same permit?", "A PC2 issued work permit.", "5.002", 72),
    ("Which form illustration shows the order to operate?", "PC17A.", "Section 5", 101),
    ("Where is the holder’s record illustrated on the PC1?", "On the back of the form.", "Section 5", 96),
    ("Which section covers supporting guarantees?", "Section 6.", "Section 6", 102),
    ("Which tag identifies a de-energizing device under Section 7?", "The PC4 tag.", "7.030", 123),
    ("What is the purpose of a caution tag?",
     "It identifies defective equipment or controls operation that could cause equipment damage or impaired service.", "EP1.02", 132),
    ("Which two caution tag types does the Code distinguish?", "Unnumbered and series numbered.", "EP1.03", 132),
]

REGISTER = """
WITH docs AS (
 SELECT id,body,coalesce(nullif(json_extract(body,'$.registerOutage'),''),
   nullif(json_extract(body,'$.outageId'),''),id) AS oid FROM uwpc_requests
 WHERE coalesce(json_extract(body,'$.practice'),0)=0
), ranked AS (
 SELECT *,row_number() OVER(PARTITION BY oid ORDER BY
   (json_extract(body,'$.registerOutage')=oid) IS TRUE DESC,
   (json_extract(body,'$.kind')='SWITCHING_PLAN') DESC,json_extract(body,'$.updatedAt') DESC,id) AS rn,
   count(*) OVER(PARTITION BY oid) AS documentCount FROM docs
), ids AS (SELECT id FROM outages UNION SELECT oid FROM docs WHERE json_extract(body,'$.kind')='SWITCHING_PLAN'
           OR nullif(json_extract(body,'$.outageId'),'') IS NOT NULL),
rows AS (
 SELECT ids.id,coalesce(o.title,json_extract(p.body,'$.title')) title,
   coalesce(o.site,json_extract(p.body,'$.site')) site,coalesce(o.asset,'') asset,
   coalesce(o.outage_type,'Planned') type,coalesce(o.severity,'Monitor') severity,
   coalesce(o.details,json_extract(p.body,'$.scope'),'') scope,
   coalesce(o.opened_by,json_extract(p.body,'$.createdBy')) owner,
   coalesce(json_extract(p.body,'$.start'),'') start,coalesce(json_extract(p.body,'$.end'),'') end,
   coalesce(json_extract(p.body,'$.affectedSites'),'[]') sites,
   CASE WHEN o.status='Closed' THEN 'COMPLETED' ELSE coalesce(json_extract(p.body,'$.phase'),
     CASE WHEN o.outage_type='Unplanned' THEN 'ACTIVE' ELSE 'FUTURE' END) END phase,
   coalesce(json_extract(p.body,'$.status'),'DRAFT') status, p.id packageId,
   json_array_length(p.body,'$.packageReview.tasks') requiredSignatures,
   (SELECT count(*) FROM json_each(p.body,'$.packageReview.tasks') WHERE json_extract(value,'$.signedAt') IS NOT NULL) signed,
   coalesce(p.documentCount,0) documentCount, o.id registerId,
   coalesce(o.closed_at,json_extract(p.body,'$.switchLog.closure.at')) closed,
   coalesce(o.opened_at,json_extract(p.body,'$.createdAt')) created
 FROM ids LEFT JOIN outages o ON o.id=ids.id LEFT JOIN ranked p ON p.oid=ids.id AND p.rn=1
), register AS (
 SELECT *, CASE WHEN phase IN ('COMPLETED','CANCELLED') THEN 'past' WHEN phase='ACTIVE' THEN 'active'
   WHEN julianday(end)<julianday('now') THEN 'past' ELSE 'upcoming' END AS period FROM rows
)
"""


OUTAGE_AREAS = ("West", "KAP / OKI", "IR / TW / IS", "Quebec", "Unassigned")


@lru_cache(maxsize=1)
def outage_area_lookup():
    regional = {
        "Old Woman Falls": 1, "White Otter Rapids": 1, "Camp Three Rapids": 1,
        "Big Beaver Falls": 1, "Okikendawt GS": 1,
        "Iroquois Falls": 2, "Iroquois Falls 230 kV": 2, "Twin Falls": 2, "Island Falls": 2,
    }
    lookup = {}
    for site in station_directory.stations():
        area = {"West": 0, "Quebec": 3}.get(site["area"], regional.get(site["name"]))
        if area is not None:
            for name in [site["id"], *station_directory.match_names(site["id"])]:
                lookup[name.casefold()] = area
    for area, aliases in enumerate((
            ("CL", "FF", "SF"), ("KAP", "Kap GS", "Kapuskasing", "Kapuskasing GS", "OKI", "Okikendawt"),
            ("IR", "TW", "IS"), ("QC", "Québec", "Quebec"))):
        lookup.update((alias.casefold(), area) for alias in aliases)
    return lookup


def register_area_ids(primary, sites_json):
    lookup = outage_area_lookup()
    areas = dict.fromkeys(lookup.get(site.strip().casefold(), 4)
                          for site in [primary, *json.loads(sites_json)] if site and site.strip())
    return json.dumps(list(areas) or [4])


def query_register(params):
    visitor = review.VISITOR_DB.get() is not None
    areas = ("Training area",) if visitor else OUTAGE_AREAS
    tab = params.get("tab", "upcoming")
    if tab not in {"upcoming","active","past"}:
        raise ValueError("Unknown register tab")
    where, values = ["period=?"], [tab]
    for token in params.get("q", "").strip()[:250].lower().split():
        where.append("instr(lower(title||' '||id||' '||site||' '||sites||' '||asset||' '||scope||' '||owner),?)>0")
        values.append(token)
    for key in ("type", "severity", "status"):
        if params.get(key):
            where.append(key + "=?")
            values.append(params[key])
    if params.get("site"):
        where.append("(site=? OR EXISTS(SELECT 1 FROM json_each(sites) WHERE value=?))")
        values.extend([params["site"]] * 2)
    if params.get("area"):
        if params["area"] not in areas:
            raise ValueError("Unknown outage area")
        where.append("EXISTS(SELECT 1 FROM json_each(area_ids) WHERE value=?)")
        values.append(areas.index(params["area"]))
    for key, op in [("from", ">="), ("until", "<")]:
        if params.get(key):
            stamp = datetime.fromisoformat(params[key].replace("Z", "+00:00"))
            if stamp.tzinfo is None:
                raise ValueError("Date filters require a time zone")
            where.append(f"julianday(start){op}julianday(?)")
            values.append(stamp.isoformat())
    offset = max(0, int(params.get("offset", 0)))
    sorts = {"start": "julianday(nullif(start,''))", "title": "title COLLATE NOCASE", "site": "site COLLATE NOCASE",
             "status": "status", "closed": "julianday(closed)", "severity": "CASE severity WHEN 'Critical' THEN 3 WHEN 'Degraded' THEN 2 ELSE 1 END"}
    sorts["area"] = "nullif(json_extract(area_ids,'$[0]'),4)"
    order = sorts.get(params.get("sort"), sorts["closed" if tab == "past" else "start"])
    direction = "DESC" if params.get("direction", "desc" if tab == "past" else "asc") == "desc" else "ASC"
    filtered = " FROM (SELECT register.*,outage_areas(site,sites) AS area_ids FROM register) WHERE " + " AND ".join(where)
    with desk.session() as c:
        c.create_function("outage_areas", 2, (lambda primary, extra: "[0]") if visitor else register_area_ids, deterministic=True)
        c.execute("BEGIN")
        total = c.execute(REGISTER + "SELECT count(*)" + filtered, values).fetchone()[0]
        offset = min(offset, max(0, (total - 1) // 30 * 30))
        items = [dict(row) for row in c.execute(REGISTER + "SELECT *" + filtered +
            f" ORDER BY ({order}) IS NULL,{order} {direction},id LIMIT 30 OFFSET ?", [*values, offset])]
        counts = dict(c.execute(REGISTER + "SELECT period,count(*) FROM register GROUP BY period"))
        site_names = [r[0] for r in c.execute(REGISTER + "SELECT site FROM rows UNION SELECT value FROM rows,json_each(sites) ORDER BY 1")]
    for item in items:
        item["sites"] = json.loads(item["sites"])
        item["areas"] = [areas[i] for i in json.loads(item.pop("area_ids"))]
    return {"rows": items, "total": total, "offset": offset, "counts": {k:counts.get(k,0) for k in ("upcoming","active","past")}, "sites":site_names, "areas":areas}


def create_request(payload, actor, accounts=()):
    token = payload.get("requestKey", "")
    if not isinstance(token, str) or not re.fullmatch(r"[a-zA-Z0-9-]{16,80}", token):
        raise ValueError("A submission ID is required")
    data = {}
    for name, limit in (("title",160),("site",80),("asset",160),("scope",4000),("start",40),("end",40)):
        val = payload.get(name, "")
        if not isinstance(val,str) or len(val.strip()) > limit or (not val.strip() and name != "asset"):
            raise ValueError(f"Enter a valid {name}")
        data[name] = val.strip()
    if payload.get("severity") not in {"Monitor","Degraded","Critical"}:
        raise ValueError("Select a priority")
    for key in ("start","end"):
        parsed = datetime.fromisoformat(data[key].replace("Z","+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("The outage window requires a time zone")
        data[key] = parsed.isoformat()
    if datetime.fromisoformat(data["end"]) <= datetime.fromisoformat(data["start"]):
        raise ValueError("End must be later than start")
    classification = review.classification({**payload,"site":data["site"]})
    if not classification["reviewTrigger"] or (classification["reviewTrigger"] == "multi-site" and len(classification["affectedSites"]) < 2):
        raise ValueError("Select a review trigger and include every affected site")
    leads = {key: payload[key] for key in ("sscLead", "localLead") if payload.get(key)}
    if leads:
        roster = review.directory(accounts)
        if ("sscLead" in leads and leads["sscLead"] not in roster["operator"]) or (
                "localLead" in leads and leads["localLead"] not in roster["area"] + roster["field"]):
            raise ValueError("Choose eligible outage managers from the directory")
        if leads.get("sscLead") == leads.get("localLead"):
            raise ValueError("Assign separate control room and local outage managers")
    signature = desk.digest({**data, **classification,"severity":payload["severity"], **leads})
    with desk.session() as c:
        c.execute("BEGIN IMMEDIATE")
        c.execute("CREATE TABLE IF NOT EXISTS outage_manager_submissions(actor TEXT,token TEXT,signature TEXT,oid TEXT,pid TEXT,PRIMARY KEY(actor,token))")
        prior = c.execute("SELECT * FROM outage_manager_submissions WHERE actor=? AND token=?",(actor,token)).fetchone()
        if prior:
            if prior["signature"] != signature:
                raise desk.Conflict("This submission ID belongs to an earlier request")
            return {"id":prior["oid"],"packageId":prior["pid"]}
        outage = store.insert_outage(c,{**data,"details":data["scope"],"type":"Planned","severity":payload["severity"]},actor)
        plan = desk.create({"fromOutage":outage["id"]},actor,connection=c)
        plan.update(start=data["start"],end=data["end"],coordinated=True,proposedLeads=leads,**classification)
        desk.write(c,plan)
        desk.event(c,plan,actor,"scheduled",{"start":data["start"],"end":data["end"],**classification})
        c.execute("INSERT INTO outage_manager_submissions VALUES (?,?,?,?,?)",(actor,token,signature,outage["id"],plan["id"]))
        return {"id":outage["id"],"packageId":plan["id"]}


def details(oid):
    with desk.session() as c:
        c.execute("BEGIN")
        row = c.execute(REGISTER+"SELECT * FROM rows WHERE id=?",(oid,)).fetchone()
        if not row:
            raise LookupError("Outage not found")
        documents = [dict(r) for r in c.execute(REGISTER+"SELECT id,json_extract(body,'$.title') title,json_extract(body,'$.status') status FROM docs WHERE oid=? ORDER BY title,id",(oid,))]
        result = dict(row)
        result["sites"] = json.loads(result["sites"])
        if row["packageId"]:
            plan = desk.read(c, row["packageId"])
            result["workflow"] = {k: plan.get(k) for k in (
                "id", "version", "phase", "status", "preparationMode", "reviewTrigger", "diagramRevision",
                "packageReview", "reviewIssues", "review", "proposedLeads")}
            result["workflow"].update(
                sources=[{"kind": s["kind"]} for s in plan["sources"]],
                lastReview=bool(plan.get("lastReview")), switchLog=bool(plan.get("switchLog")),
                generation=bool(plan.get("generation")),
                distribution={"flags": plan["distribution"].get("flags", [])} if plan.get("distribution") else None)
        return {**result,"documents":documents}


def report_options():
    with desk.session() as c:
        return [dict(r) for r in c.execute(REGISTER + """
          SELECT id,title,site,period FROM register ORDER BY
            CASE period WHEN 'active' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END,
            CASE WHEN period='past' THEN julianday(coalesce(closed,end)) END DESC,
            julianday(start),title,id""")]


def switching_sources(target):
    """One entry per saved switching order, including orders with older usable revisions."""
    def locations(site, additional):
        return {station_directory.bind(s)["site"].casefold() for s in [site,*additional] if s}
    with desk.session() as c:
        current=desk.read(c,target)
        selected=locations(current["site"],current.get("affectedSites",[]))
        records=c.execute("""SELECT id,body->>'$.title' title,body->>'$.site' site,
            body->>'$.affectedSites' sites,body->>'$.updatedAt' updated
            FROM uwpc_requests WHERE body->>'$.template'='pc17a' AND coalesce(body->>'$.practice',0)=0
            AND (json_array_length(body,'$.switchingPlan.steps')>0 OR EXISTS
                (SELECT 1 FROM uwpc_request_events e WHERE e.request_id=uwpc_requests.id AND
                json_array_length(e.detail,'$.switchingPlan.steps')>0)) ORDER BY updated DESC,id""")
        return [{"id":r["id"],"title":r["title"],"site":r["site"],"updated":r["updated"],
                 "similar":bool(selected & locations(r["site"],json.loads(r["sites"] or "[]")))} for r in records]


def switching_versions(ident):
    with desk.session() as c:
        row=desk.read(c,ident)
        if row.get("practice") or row.get("template")!="pc17a":
            raise LookupError("Switching plan not found")
        versions=[]
        seen=set()
        def collect(snapshot,at):
            steps=snapshot.get("switchingPlan",{}).get("steps",[])
            if not steps:return
            content={"steps":steps,"site":snapshot.get("site",row["site"]),
                     "sites":snapshot.get("affectedSites",[])}
            signature=desk.digest(content)
            if signature not in seen:
                versions.append({**content,"at":at})
                seen.add(signature)
        collect(row,row["updatedAt"])
        for event in c.execute("""SELECT at,detail FROM uwpc_request_events WHERE request_id=? AND event IN ('created','save')
                                  ORDER BY seq DESC""",(ident,)):
            record=json.loads(event["detail"])
            collect(record.get("fields",record),event["at"])
        return versions


# Match a full location segment, never a whole operating region. Station overrides
# in the local Maximo configuration take precedence over the standard import.
STATION_LOCATIONS = {
    "Calm Lake":("FFO","FFO-CLG"), "Fort Frances":("FFO","FFO-FFG"),
    "Kenora":("FFO","FFO-KEG"), "Norman":("FFO","FFO-NOG"), "Sturgeon Falls":("FFO","FFO-SFG"),
    "Island Falls":("ISG","ISG"), "Iroquois Falls":("IRG","IRG"), "Twin Falls":("TWG","TWG"),
    "Iroquois Falls 230 kV":("EHV","EHV-230KV"), "Big Beaver Falls":("HSI","HSI-BBF"),
    "Camp Three Rapids":("HSI","HSI-CTR"), "Okikendawt GS":("HSI","HSI-OKI"),
    "Old Woman Falls":("HSI","HSI-OWF"), "McDougal":("HSI","HSI-MCD"), "Cogent":("HSI","HSI-COG"),
    "Aiyers 1":("HSI","HSI-AY1"), "Aiyers 2":("HSI","HSI-AY2"), "Bird GS":("HSI","HSI-BIRD"),
}


def site_devices(selected):
    if not isinstance(selected,list) or len(selected)>41 or any(not isinstance(s,str) or len(s)>120 for s in selected):
        raise ValueError("Choose valid outage sites")
    def canonical(name):
        return (station_directory.resolve(name) or {}).get("name",name.strip())
    names={canonical(name).casefold():canonical(name) for name in selected if name.strip()}
    if not names:
        return {"devices":[]}
    overrides=maximo.config()["sites"]
    roots={}
    for name in names.values():
        site_id=(station_directory.resolve(name) or {}).get("id")
        override=overrides.get(site_id) or {}
        pair=(override.get("siteid"),override.get("location")) if isinstance(override,dict) and override.get("siteid") and override.get("location") else STATION_LOCATIONS.get(name)
        if pair:
            roots.setdefault(str(pair[0]).casefold(),[]).append((str(pair[1]).casefold(),name))
    devices={}
    def add(site,ref,description):
        if ref:devices[(site.casefold(),ref.casefold())]={"site":site,"ref":ref,"label":description}
    for asset in (maximo._load_equipment_snapshot() or {}).get("assets",[]):
        code=asset["site"].casefold()
        site=names.get(code)
        if not site:
            loc=asset["location"].casefold()
            site=next((n for root,n in roots.get(code,[]) if loc==root or loc.startswith(root+"-")),None)
        if site:add(site,asset["assetNum"],asset["description"])
    with desk.session() as c:
        for row in c.execute("""SELECT DISTINCT s.value->>'$.siteCode', s.value->>'$.assetTag', s.value->>'$.label'
                FROM one_line_documents d,json_each(d.current_payload,'$.symbols') s
                WHERE coalesce(s.value->>'$.assetTag','')<>'' AND coalesce(s.value->>'$.siteCode','')<>''"""):
            site=names.get(canonical(row[0]).casefold())
            if site:add(site,row[1],row[2] or "")
    return {"devices":sorted(devices.values(),key=lambda d:(d["site"].casefold(),d["ref"].casefold()))}


def outage_report(oid):
    with desk.session() as c:
        inbox_schema(c)
        c.execute("BEGIN")
        row = c.execute(REGISTER + "SELECT id,title,site,phase,start,end,closed FROM rows WHERE id=?", (oid,)).fetchone()
        if not row:
            raise LookupError("Outage not found")
        docs = []
        for record in c.execute(REGISTER + "SELECT body FROM docs WHERE oid=? ORDER BY json_extract(body,'$.title'),id", (oid,)):
            doc = json.loads(record["body"])
            docs.append({**{k: doc.get(k) for k in ("id", "title", "status", "phase", "packageReview", "review", "switchLog")},
                         "reissue": bool(doc.get("lastReview") and not doc.get("packageReview")),
                         "issues": [i for i in doc.get("reviewIssues", []) if not i.get("closedAt")],
                         "flags": [f for f in (doc.get("distribution") or {}).get("flags", []) if not f.get("resolvedAt")]})
        events = [dict(e) for e in c.execute(REGISTER + """
            SELECT * FROM (SELECT at,actor,event,details AS summary,'' AS document,seq,0 AS source
              FROM outage_events WHERE outage_id=?
            UNION ALL
            SELECT at,sender,'person-tagged','Tagged '||recipient||': '||note,'',rowid,2
              FROM outage_person_tags WHERE oid=?
            UNION ALL
            SELECT e.at,e.actor,e.event,coalesce(json_extract(e.detail,'$.changes'),json_extract(e.detail,'$.text'),json_extract(e.detail,'$.comment'),
                   json_extract(e.detail,'$.summary'),json_extract(e.detail,'$.name'),json_extract(e.detail,'$.message'),
                   json_extract(e.detail,'$.signature.comment'),
                   CASE WHEN e.event='review-sign' THEN 'Revision '||json_extract(e.detail,'$.revision')||' · '||json_extract(e.detail,'$.role')
                        WHEN e.event='phase' THEN json_extract(e.detail,'$.from')||' → '||json_extract(e.detail,'$.to') END,''),
                   json_extract(d.body,'$.title'),e.seq,1
              FROM uwpc_request_events e JOIN docs d ON d.id=e.request_id WHERE d.oid=?)
            ORDER BY julianday(at) DESC,source DESC,seq DESC""", (oid, oid, oid))]
        return {**dict(row), "documents": docs, "events": events, "asOf": store.now_iso(),
                "editOwner": desk.checkout_info(c, oid, "", "")["owner"]}


def inbox_schema(c):
    c.execute("""CREATE TABLE IF NOT EXISTS outage_person_tags (
        id TEXT PRIMARY KEY, oid TEXT NOT NULL, sender TEXT NOT NULL, recipient TEXT NOT NULL,
        at TEXT NOT NULL, note TEXT NOT NULL)""")
    c.execute("CREATE INDEX IF NOT EXISTS outage_tags_by_recipient ON outage_person_tags(recipient,at)")
    c.execute("""CREATE TABLE IF NOT EXISTS outage_inbox_reads (
        actor TEXT NOT NULL, item TEXT NOT NULL, PRIMARY KEY(actor,item))""")


def tag_person(payload, actor, accounts):
    recipient, note, oid = (payload.get(k) for k in ("recipient", "note", "outage"))
    if actor not in accounts:
        raise PermissionError("Sign in with a named operator account to tag someone")
    if recipient not in accounts or not isinstance(note, str) or not 0 < len(note.strip()) <= 500:
        raise ValueError("Choose an operator and enter a note of up to 500 characters")
    with desk.session() as c:
        inbox_schema(c)
        c.execute("BEGIN IMMEDIATE")
        if not isinstance(oid, str) or not c.execute(REGISTER+"SELECT 1 FROM rows WHERE id=?", (oid,)).fetchone():
            raise LookupError("Outage not found")
        c.execute("INSERT INTO outage_person_tags VALUES (?,?,?,?,?,?)",
                  (uuid.uuid4().hex, oid, actor, recipient, store.now_iso(), note.strip()))
    return {"tagged": True}


def inbox_items(c, actor):
    seen = {r[0] for r in c.execute("SELECT item FROM outage_inbox_reads WHERE actor=?", (actor,))}
    items = []
    def add(key, title, message, at, section, oid="", doc=""):
        item = desk.digest([actor, doc, *key])
        items.append(dict(key=item, title=title, message=message, at=at, section=section,
                          outage=oid, document=doc, unread=item not in seen))
    for r in c.execute(REGISTER + """SELECT t.*,r.title FROM outage_person_tags t
            JOIN rows r ON r.id=t.oid WHERE recipient=?""", (actor,)):
        add(["tag",r["id"]],r["title"],f'{r["sender"]} tagged you: {r["note"]}',r["at"],"events",r["oid"])
    for r in c.execute("""
          SELECT json_object('id',id,'title',body->'$.title','phase',body->'$.phase',
            'status',body->'$.status','createdAt',body->'$.createdAt','updatedAt',body->'$.updatedAt',
            'packageReview',body->'$.packageReview','lastReview',body->'$.lastReview',
            'distribution',body->'$.distribution','reviewIssues',coalesce(body->'$.reviewIssues',json('[]')),
            'review',body->'$.review') AS body
          FROM uwpc_requests WHERE coalesce(json_extract(body,'$.practice'),0)=0 AND (
            EXISTS (SELECT 1 FROM json_each(body,'$.packageReview.tasks') WHERE json_extract(value,'$.account')=?)
            OR EXISTS (SELECT 1 FROM json_each(body,'$.distribution.recipients') WHERE value=?)
            OR EXISTS (SELECT 1 FROM json_each(body,'$.review.operators') WHERE value=?)
            OR EXISTS (SELECT 1 FROM json_each(body,'$.reviewIssues') WHERE json_extract(value,'$.actor')=?)
            OR json_extract(body,'$.lastReview.owner')=?)""", [actor]*5):
        row = json.loads(r["body"])
        review = row.get("packageReview") or {}
        def alert(key, text, at, section="approvals"):
            add(key, row["title"], text, at or row.get("createdAt",""), section, doc=row["id"])
        dist = row.get("distribution") or {}
        if actor in (dist.get("recipients") or []) and actor not in (dist.get("receipts") or {}):
            alert(["copy",dist["id"]], f'Final copy distributed · revision {dist["revision"]}', dist["at"], "distribution")
        if actor in (review.get("sscLead") or review.get("owner"), review.get("localLead") or review.get("area")):
            for f in dist.get("flags",[]):
                if not f.get("resolvedAt"):
                    alert(["flag",dist["id"],f["id"]], "Final copy flagged · "+f["text"], f["at"], "distribution")
        if row.get("phase")!="FUTURE":
            continue
        ordinary = row.get("review") or {}
        if row.get("status")=="PENDING_SIGNOFF" and actor in ordinary.get("operators",[]) and not any(
                d["actor"]==actor for d in ordinary.get("decisions",[])):
            alert(["ordinary",ordinary["requestedAt"]], "Operator review requested", ordinary["requestedAt"])
        last = row.get("lastReview") or {}
        if not review and actor==last.get("owner"):
            alert(["reissue",last["number"]], "Reissue the revised package", row.get("updatedAt"))
        if not review or row.get("status")=="SIGNED_OFF":
            continue
        rev = review["number"]
        issues = [i for i in row.get("reviewIssues",[]) if not i.get("closedAt")]
        for i in issues:
            answer = bool(i.get("answer"))
            if actor==(i["actor"] if answer else review["owner"]):
                alert(["issue",rev,i["id"],i.get("answer")], ("Confirm" if answer else "Respond to")+" correction "+i["id"],i["at"])
        pending = [t for t in review["tasks"] if not t.get("signedAt")]
        hours = (datetime.fromisoformat(review["due"].replace("Z","+00:00")) - datetime.now(timezone.utc)).total_seconds()/3600
        for t in pending:
            escalated = hours<=0 and (actor==review["owner"] or (actor==review["area"] and t["role"]=="field"))
            if not (actor==t["account"] or escalated):
                continue
            held = bool(issues) or (t["role"]=="checker" and review.get("sscLead") and any(p["role"]!="checker" for p in pending))
            timing = "On hold" if held else "Overdue" if hours<=0 else "Due within 24 hours" if hours<=24 else "Assigned"
            role = {"operator":"Scheduled SSC","checker":"Independent competent checker","area":"Area manager","field":"Field reviewer"}.get(t["role"],t["role"])
            alert(["assignment",rev,t["id"],bool(held)], " · ".join(filter(None,[timing,role,t.get("site"),t["account"]])),review["openedAt"])
    return sorted(items,key=lambda i:(i["unread"],i["at"],i["key"]),reverse=True)


def inbox(actor, open_item=None):
    with desk.session() as c:
        inbox_schema(c)
        c.execute("BEGIN IMMEDIATE" if open_item is not None else "BEGIN")
        items = inbox_items(c, actor)
        if open_item is not None:
            if not any(i["key"]==open_item for i in items):
                raise LookupError("Inbox item no longer available")
            c.execute("INSERT OR IGNORE INTO outage_inbox_reads VALUES (?,?)",(actor,open_item))
            return {"opened":True}
        return {"items":items}


def source(actor):
    knowledge._ensure()
    selected, allowed = knowledge.access(actor, "")
    clause, args = knowledge._scope_sql(selected, allowed)
    with store._session() as c:
        item = c.execute("SELECT id FROM operator_knowledge_sources WHERE source_key='uwpc-2024' "
            "AND status IN ('CURRENT_CONTROLLED','REFERENCE_ONLY','LEGACY_REFERENCE') AND lower(filename) LIKE '%.pdf' "
            + clause + " ORDER BY (status='CURRENT_CONTROLLED') DESC, created_at DESC, id LIMIT 1", args).fetchone()
    if not item:
        raise LookupError("The UWPC source document is unavailable")
    return item


@lru_cache(maxsize=3)
def contents(raw):
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(raw))
    topics = []
    def visit(entries):
        for entry in entries:
            if isinstance(entry,list):
                visit(entry)
            else:
                page = reader.get_destination_page_number(entry)
                if page is not None and page >= 0:
                    topics.append({"title":" ".join(entry.title.split()),"page":page+1})
    visit(reader.outline)
    return len(reader.pages), topics


def library(actor, query):
    item = source(actor)
    document, raw, _ = knowledge.read_file(item["id"],actor)
    pages, topics = contents(raw)
    known = document["sha256"] == BOOK_HASH
    hits = []
    terms = query.lower().split()[:12]
    if terms:
        for part in knowledge.get_source(item["id"],actor)["passages"]:
            plain = " ".join(part["text"].split())
            if all(t in plain.lower() for t in terms):
                pos = max(0,plain.lower().find(terms[0])-55)
                hits.append({"page":part["page"],"text":plain[pos:pos+230]})
    return {"title":document["title"],"status":document["status"],"edition":document["revision"],"pages":pages,
            "topics":topics,"sections":SECTIONS if known else [(1,"Manual")],"hits":hits,
            "forms":[{"id":key,"code":v[0],"title":v[1],"pages":v[2]} for key,v in FORMS.items()] if known else [],
            "questions":QUESTIONS if known else []}


@lru_cache(maxsize=64)
def _page_text(raw, page):
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(raw))
    if page < 1 or page > len(reader.pages):
        raise ValueError("Page is outside the manual")
    return reader.pages[page - 1].extract_text() or ""


def read_page(actor, page):
    _, raw, _ = knowledge.read_file(source(actor)["id"],actor)
    return {"page":page,"text":_page_text(raw,page)}


def library_file(actor, kind):
    item = source(actor)
    document, raw, _ = knowledge.read_file(item["id"],actor)
    if kind == "book":
        return raw, document["filename"]
    if kind not in FORMS or document["sha256"] != BOOK_HASH:
        raise LookupError("Form not found for this edition")
    from pypdf import PdfReader, PdfWriter
    reader, writer = PdfReader(io.BytesIO(raw)), PdfWriter()
    for n in FORMS[kind][2]:
        writer.add_page(reader.pages[n-1])
    writer.add_metadata({"/Title":f"UWPC 2024 · {FORMS[kind][0]} · Form illustration","/Author":"Hydro One Networks Inc."})
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue(), f"UWPC-2024-{kind}.pdf"
