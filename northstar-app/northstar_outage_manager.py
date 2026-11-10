"""Operator-only outage register and UWPC reference library."""
import io
import json
import re
from datetime import datetime
from functools import lru_cache

import northstar_operator_knowledge as knowledge
import northstar_outage_review as review
import northstar_store as store
import northstar_uwpc_desk as desk


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


def query_register(params):
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
    order = sorts.get(params.get("sort"), sorts["closed" if tab == "past" else "start"])
    direction = "DESC" if params.get("direction", "desc" if tab == "past" else "asc") == "desc" else "ASC"
    filtered = " FROM register WHERE " + " AND ".join(where)
    with desk.session() as c:
        c.execute("BEGIN")
        total = c.execute(REGISTER + "SELECT count(*)" + filtered, values).fetchone()[0]
        offset = min(offset, max(0, (total - 1) // 30 * 30))
        items = [dict(row) for row in c.execute(REGISTER + "SELECT *" + filtered +
            f" ORDER BY ({order}) IS NULL,{order} {direction},id LIMIT 30 OFFSET ?", [*values, offset])]
        counts = dict(c.execute(REGISTER + "SELECT period,count(*) FROM register GROUP BY period"))
        site_names = [r[0] for r in c.execute(REGISTER + "SELECT site FROM rows UNION SELECT value FROM rows,json_each(sites) ORDER BY 1")]
    for item in items:
        item["sites"] = json.loads(item["sites"])
    return {"rows": items, "total": total, "offset": offset, "counts": {k:counts.get(k,0) for k in ("upcoming","active","past")}, "sites":site_names}


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


def inbox(actor):
    with desk.session() as c:
        return [dict(r) for r in c.execute("""
          SELECT id,json_extract(body,'$.title') title,json_extract(body,'$.phase') phase,
            json_extract(body,'$.status') status,json_extract(body,'$.packageReview') packageReview,
            json_extract(body,'$.lastReview.owner') lastOwner,json_extract(body,'$.distribution') distribution,
            json_extract(body,'$.reviewIssues') issues,json_extract(body,'$.review') ordinary
          FROM uwpc_requests WHERE coalesce(json_extract(body,'$.practice'),0)=0 AND (
            EXISTS (SELECT 1 FROM json_each(body,'$.packageReview.tasks') WHERE json_extract(value,'$.account')=?)
            OR EXISTS (SELECT 1 FROM json_each(body,'$.distribution.recipients') WHERE value=?)
            OR EXISTS (SELECT 1 FROM json_each(body,'$.review.operators') WHERE value=?)
            OR EXISTS (SELECT 1 FROM json_each(body,'$.reviewIssues') WHERE json_extract(value,'$.actor')=?)
            OR json_extract(body,'$.lastReview.owner')=?) ORDER BY json_extract(body,'$.updatedAt') DESC""",[actor]*5)]


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
