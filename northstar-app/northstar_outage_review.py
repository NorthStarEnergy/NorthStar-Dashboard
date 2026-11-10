"""Planning review for significant outages. Account eligibility is workstation configuration."""
import json
import os
from contextvars import ContextVar
from datetime import datetime
from pathlib import Path

import northstar_store as store


TRIGGERS = {"routine", "multi-site", "crew dependency", "non-routine switching or lockout", "manager designation"}
ROLES = ("manager", "checker", "operator", "area", "field")
PRACTICE_DB = ContextVar("outage_practice_db", default=None)
PRACTICE_TEAM = {
    "manager": ["Avery Brooks"], "operator": ["Morgan Ellis", "Jordan Vale"],
    "checker": ["Morgan Ellis"], "area": ["Casey Rowan"], "field": ["Riley West", "Taylor Reed"],
}


def directory(accounts):
    if PRACTICE_DB.get() is not None:
        return PRACTICE_TEAM
    path = Path(os.environ.get("NORTHSTAR_OUTAGE_REVIEW_DIRECTORY") or
                store.DB_PATH.parent / "outage-review-directory.json")
    try:
        config = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        config = {}
    if not isinstance(config, dict):
        config = {}
    return {role: sorted(account for account in accounts if account in config[role])
            if isinstance(config.get(role), list) else [] for role in ROLES}


def classification(payload, previous=None):
    previous = previous or {}
    reason = payload.get("reviewTrigger", previous.get("reviewTrigger", ""))
    if not isinstance(reason, str) or (reason and reason not in TRIGGERS):
        raise ValueError("Select a supported outage review trigger")
    sites = payload.get("affectedSites", previous.get("affectedSites", []))
    if not isinstance(sites, list) or len(sites) > 40:
        raise ValueError("List up to 40 affected sites")
    unique = {}
    for site in [payload.get("site", ""), *sites]:
        if not isinstance(site, str) or len(site.strip()) > 120:
            raise ValueError("Enter a valid site name")
        if site.strip():
            unique.setdefault(site.strip().casefold(), site.strip())
    if len(unique) > 1:
        reason = "multi-site"
    if previous.get("reviewTrigger") in TRIGGERS - {"routine"} and reason in {"", "routine"}:
        raise ValueError("This outage requires full package review")
    return {"reviewTrigger": reason, "affectedSites": list(unique.values())}


def required(row):
    return row.get("reviewTrigger") in TRIGGERS - {"routine"}


def open_review(row, payload, actor, roster, snapshot, digest, accounts):
    if actor not in roster["manager"]:
        raise PermissionError("A named control room manager must open this review")
    if not required(row) or row["phase"] != "FUTURE" or row.get("preparationMode") in {"INTAKE", "REQUEST"}:
        raise ValueError("Save a complete significant-outage form before opening review")
    if not all(row.get(key) for key in ("outageId", "start", "end", "diagramRevision")):
        raise ValueError("Enter an outage ID, work window and diagram revision")
    if not any(s["kind"] == "diagram" for s in row["sources"]):
        raise ValueError("Attach the drawing used for review")
    try:
        due = datetime.fromisoformat(payload["due"].replace("Z", "+00:00"))
        if due.tzinfo is None or due > datetime.fromisoformat(row["start"].replace("Z", "+00:00")):
            raise ValueError()
    except (KeyError, TypeError, AttributeError, ValueError):
        raise ValueError("Set a review deadline at or before the outage start") from None
    if payload.get("confirmed") is not True:
        raise ValueError("Confirm the package contents and scheduled assignments")

    preparer = payload.get("preparer")
    scheduled = payload.get("operators")
    checker = payload.get("checker")
    area = payload.get("area")
    fields = payload.get("field")
    if preparer not in roster["operator"] + roster["manager"]:
        raise ValueError("Identify the person who prepared the package")
    if not isinstance(scheduled, list) or not scheduled or len(scheduled) > 40 or any(
            name not in roster["operator"] for name in scheduled):
        raise ValueError("Assign the scheduled control room operators")
    if checker not in roster["checker"] or checker in {preparer, row["createdBy"], actor, *row.get("contentEditors", [])}:
        raise ValueError("Assign a competent checker independent of package preparation and manager approval")
    if area not in roster["area"]:
        raise ValueError("Assign an eligible area manager")
    if not isinstance(fields, dict) or set(fields) != set(row["affectedSites"]):
        raise ValueError("Assign an on-site reviewer for every affected site")
    if any(name not in roster["field"] for name in fields.values()):
        raise ValueError("Select an eligible field reviewer for every site")
    if len(set(fields.values())) != len(fields):
        raise ValueError("Assign a different on-site field representative for each site")
    summary = str(payload.get("summary") or "").strip()[:1000]
    number = row.get("reviewNumber", 0) + 1
    if number > 1 and not summary:
        raise ValueError("Summarize the changes before reissuing review")
    now = store.now_iso()
    copy_to = payload.get("copyTo", [])
    if not isinstance(copy_to, list) or len(copy_to) > 100 or any(name not in accounts for name in copy_to):
        raise ValueError("Choose active accounts for additional final copies")
    tasks = []

    def task(role, account, site=""):
        tasks.append({"id": str(len(tasks) + 1), "role": role, "account": account, "site": site,
                      "signedAt": now if role == "manager" else None})

    task("manager", actor)
    for name in dict.fromkeys(scheduled):
        task("operator", name)
    task("checker", checker)
    task("area", area)
    for site, name in fields.items():
        task("field", name, site)
    snapshot = {**snapshot, "sources": row["sources"], "proposalDigest": (row.get("generation") or {}).get("digest"),
                "trigger": row["reviewTrigger"], "sites": row["affectedSites"]}
    review = {"number": number, "due": due.isoformat(), "preparer": preparer, "summary": summary,
              "owner": actor, "area": area, "openedAt": now, "tasks": tasks, "copyTo": sorted(set(copy_to))}
    review["digest"] = digest({"package": snapshot, "cover": review})
    status = "CHANGES_REQUESTED" if any(not i.get("closedAt") for i in row.get("reviewIssues", [])) else "PENDING_SIGNOFF"
    row.update(packageReview=review, reviewNumber=number, review=None, status=status)
    return {"cover": review, "package": snapshot}


def transition(row, action, payload, actor, roster):
    review = row.get("packageReview")
    if not review or payload.get("digest") != review["digest"] or row["phase"] != "FUTURE":
        raise ValueError("Reopen the current package review")
    now = store.now_iso()
    issues = row.setdefault("reviewIssues", [])
    if action in {"review-answer", "review-close"}:
        issue = next((item for item in issues if item["id"] == payload.get("issue")), None)
        if not issue or issue.get("closedAt"):
            raise ValueError("Select an outstanding correction")
        if action == "review-answer":
            if actor != review["owner"] or actor not in roster["manager"]:
                raise PermissionError("Only the assigned control room manager can respond")
            if not isinstance(payload.get("comment"), str) or not payload["comment"].strip():
                raise ValueError("Describe the resolution for the person who raised it")
            issue.update(answer=payload["comment"].strip()[:4000], answeredAt=now)
        else:
            if actor != issue["actor"] or not issue.get("answer"):
                raise PermissionError("The person who raised the correction must confirm the response")
            issue["closedAt"] = now
        detail = dict(issue)
    else:
        task = next((task for task in review["tasks"] if task["id"] == payload.get("task")), None)
        if not task or actor != task["account"] or actor not in roster[task["role"]]:
            raise PermissionError("Only the eligible assigned reviewer can take this action")
        if action == "review-return":
            if not isinstance(payload.get("comment"), str) or not payload["comment"].strip():
                raise ValueError("Identify the affected document, step or site and the correction needed")
            issue = {"id": str(len(issues) + 1), "actor": actor, "revision": review["number"], "at": now,
                     "task": task["id"], "comment": payload["comment"].strip()[:4000]}
            issues.append(issue)
            task["signedAt"] = None
            detail = issue
        else:
            if task["signedAt"] or payload.get("confirmed") is not True:
                raise ValueError("Confirm your assigned review on the current revision")
            if any(t["account"] not in roster[t["role"]] for t in review["tasks"]):
                raise ValueError("An assigned reviewer is no longer eligible. The manager must reissue the review.")
            if any(not issue.get("closedAt") for issue in issues):
                raise ValueError("Resolve the outstanding corrections before signing")
            task["signedAt"] = now
            detail = dict(task)
    if any(not issue.get("closedAt") for issue in issues):
        row["status"] = "CHANGES_REQUESTED"
    elif all(task["signedAt"] for task in review["tasks"]):
        row["status"] = "SIGNED_OFF"
    else:
        row["status"] = "PENDING_SIGNOFF"
    return {"digest": review["digest"], "revision": review["number"], **detail}
