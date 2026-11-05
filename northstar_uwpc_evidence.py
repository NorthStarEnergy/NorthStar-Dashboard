"""UWPC evidence selection and mechanical citation checks, never compliance approval."""
from __future__ import annotations

import json
import hashlib
import re

import northstar_operator_knowledge as knowledge
import northstar_sites as sites
import northstar_uwpc as uwpc

REQUIRED = ("code", "amendments", "procedure", "example")
LABELS = {"code": "Current reviewed UWPC Code", "amendments": "Reviewed amendment register",
          "procedure": "Applicable reviewed local procedure", "example": "Reviewer-approved evaluation example"}
CLAUSES = re.compile(r"\b(?:[1-8]\.\d{3}|(?:HO|EP|TP)\d+\.\d{2})\b")
SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["draft", "findings"],
    "properties": {
        "draft": {"type": "string"},
        "findings": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["claim", "citationId", "clause", "quote", "status"],
            "properties": {"claim": {"type": "string"}, "citationId": {"type": "string"},
                           "clause": {"type": "string"},
                           "quote": {"type": "string"},
                           "status": {"type": "string", "enum": ["NEEDS_REVIEW", "UNVERIFIED"]}}
        }}
    }
}


def role(source):
    key = source.get("source_key", "")
    if key == uwpc.PROCEDURE_ID:
        return "code"
    if key == "uwpc-amendments":
        return "amendments"
    if key.startswith("uwpc-procedure:"):
        return "procedure"
    if key.startswith("uwpc-example:"):
        return "example"
    return ""


def prepare(row, actor):
    """Select only eligible, intact, access-scoped registered evidence; cap model context."""
    site = sites.resolve(row.get("site", ""))
    selected = site["id"] if site else ""
    catalog = knowledge.catalog(actor, selected)
    query = " ".join(str(row.get(k, "")) for k in ("scope", "description", "title"))
    terms = set(re.findall(r"[a-z0-9]{3,}", query.lower())) - {"the", "and", "for", "with", "this", "that"}
    template = uwpc.template(row.get("template", "")) or {}
    terms.update(CLAUSES.findall(json.dumps(template)))
    candidates, inventory, snapshots = [], [], []
    for summary in catalog["sources"]:
        kind = role(summary)
        if not kind or (summary["site_id"] and summary["site_id"] != selected):
            continue
        # An unresolved station must not borrow another station's procedures/examples.
        if not selected and kind in {"procedure", "example"}:
            continue
        item = knowledge.get_source(summary["id"], actor)
        usable = item["aiEligible"] and item["integrity"] == "VERIFIED" and bool(item["passages"])
        inventory.append({"id": item["id"], "title": item["title"], "role": kind,
                          "revision": item["revision"], "status": item["status"], "eligible": usable,
                          "href": "knowledge-library.html?source=" + item["id"]})
        if not usable:
            continue
        scored = []
        for passage in item["passages"]:
            text = passage["text"]
            score = sum(1 for term in terms if re.search(r"\b" + re.escape(term) + r"\b", text, re.I))
            if score:
                scored.append((score, passage))
        for score, passage in sorted(scored, key=lambda pair: (-pair[0], pair[1]["ordinal"]))[:4]:
            ordinal, page = passage["ordinal"], passage["page"]
            candidates.append((kind, score, {"id": item["id"] + ":" + str(ordinal),
                "sourceId": item["id"], "role": kind, "title": item["title"],
                "revision": item["revision"], "sha256": item["sha256"], "page": page,
                "section": passage["section"], "clauseMentions": sorted(set(CLAUSES.findall(passage["text"]))),
                "excerpt": passage["text"], "approvedBy": item["approved_by"],
                "approvedAt": item["approved_at"], "reviewDue": item["review_due"],
                "href": "knowledge-library.html?source=" + item["id"] + "#passage-" + str(ordinal)}))
        if scored:
            snapshots.append({k: item[k] for k in ("id", "revision", "sha256", "approved_at", "source_key")})
    passages = []
    for kind in REQUIRED:
        passages.extend([entry for _, _, entry in sorted((x for x in candidates if x[0] == kind), key=lambda x: (-x[1], x[2]["id"]))[:4]])
    missing = [LABELS[k] for k in REQUIRED if not any(p["role"] == k for p in passages)]
    if not selected:
        missing.append("Recognized station/site for procedure applicability")
    used = {p["sourceId"] for p in passages}
    return {"status": "EVIDENCE_AVAILABLE_REVIEW_REQUIRED" if not missing else "NOT_ASSESSED",
            "missing": missing, "passages": passages, "inventory": inventory,
            "sources": [s for s in snapshots if s["id"] in used],
            "notice": "Retrieval is a selected subset, not proof of complete rule coverage or compliance."}


def normalize(value):
    return " ".join(str(value).split())


def validate(raw, bundle):
    """Validate structure, citation identity and exact quote presence, not semantic truth."""
    lookup = {p["id"]: p for p in bundle["passages"]}
    errors, findings = [], []
    try:
        result = json.loads(raw)
        if not isinstance(result, dict) or set(result) != {"draft", "findings"}:
            raise ValueError()
        if not isinstance(result["draft"], str) or not isinstance(result["findings"], list) or len(result["findings"]) > 40:
            raise ValueError()
        for finding in result["findings"]:
            if not isinstance(finding, dict) or set(finding) != {"claim", "citationId", "clause", "quote", "status"}:
                raise ValueError()
            if not all(isinstance(v, str) for v in finding.values()):
                raise ValueError()
            evidence = lookup.get(finding["citationId"])
            quote = normalize(finding["quote"])
            if (finding["status"] not in {"NEEDS_REVIEW", "UNVERIFIED"} or not finding["claim"].strip()
                    or not evidence or len(quote) < 20 or len(quote) > 600
                    or (evidence["role"] == "code" and finding["clause"] not in evidence["clauseMentions"])
                    or (finding["clause"] and finding["clause"] not in evidence["clauseMentions"])
                    or quote not in normalize(evidence["excerpt"])):
                errors.append("A finding has an unknown citation/clause or a quotation absent from its source.")
            else:
                findings.append(finding)
        cited = set(re.findall(r"\[(oks_[a-zA-Z0-9]+:\d+)\]", result["draft"]))
        if cited - lookup.keys():
            errors.append("The draft cites a passage outside the retrieved evidence.")
        if not bundle["missing"] and not any(lookup[f["citationId"]]["role"] == "code" for f in findings):
            errors.append("No checkable Code-clause finding was returned.")
    except (ValueError, TypeError):
        errors.append("AI output did not match the required review format.")
        result = {"draft": "", "findings": []}
    # Incomplete evidence and invalid citations cannot acquire a compliance endorsement.
    status = "NOT_ASSESSED" if bundle["missing"] else "UNVERIFIED" if errors else "CITATIONS_CHECKED_REVIEW_REQUIRED"
    text = "DRAFT — QUALIFIED REVIEW REQUIRED\nCompliance: " + status + "\n"
    if bundle["missing"]:
        text += "Missing controlled evidence:\n" + "\n".join("- " + x for x in bundle["missing"]) + "\n"
    if errors or bundle["missing"]:
        text += "AI draft withheld because its evidence checks failed.\n" + "\n".join(sorted(set(errors)))
        findings = []
    else:
        text += "\nUNVERIFIED AI DRAFT\n" + result["draft"]
        if findings:
            text += "\n\nEvidence findings — interpretation requires qualified review:\n"
            text += "\n".join(f"- {f['status']}: {f['claim']} [{f['citationId']}] Clause: {f['clause'] or 'Not applicable'}\n  Source excerpt: {f['quote']}" for f in findings)
    return text, {"status": status, "errors": sorted(set(errors)), "findings": findings,
                  "missing": bundle["missing"], "canRoute": not bundle["missing"] and not errors,
                  "semanticVerification": "NOT_PERFORMED"}


def recheck(bundle, actor):
    for snapshot in bundle["sources"]:
        # Called inside the request transaction's non-reentrant store lock.
        # The registry was initialized by prepare; do not call its _ensure here.
        with knowledge.store._session() as con:
            source = con.execute("SELECT *, (" + knowledge._current_sql("") + ") AS eligible "
                                 "FROM operator_knowledge_sources WHERE id=?", (snapshot["id"],)).fetchone()
        if source:
            knowledge.access(actor, source["site_id"])
        try:
            intact = bool(source and hashlib.sha256(knowledge._path(source["file_path"]).read_bytes()).hexdigest() == source["sha256"])
        except (ValueError, OSError):
            intact = False
        if (not source or not source["eligible"] or not intact
                or any(source[k] != snapshot[k] for k in ("revision", "sha256", "approved_at", "source_key"))):
            raise ValueError("Controlled evidence changed or expired. Regenerate before review.")


def require_reviewable(document, actor):
    if not document or not document.get("evidenceCheck", {}).get("canRoute"):
        raise ValueError("UWPC evidence is incomplete or unverified. Review controlled sources and regenerate first.")
    recheck(document["controlledEvidence"], actor)
