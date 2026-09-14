"""UWPC / outage connectivity rules, ported from outage-stitch/lib/connectivity.ts.

This module is records-only. It does not issue switching commands, write to
SCADA, or release equipment. Hold-off is not a work permit. A supporting
guarantee may only support a PC2 or PC17B work permit.
"""

from __future__ import annotations

from typing import Any, Iterable, Mapping, Sequence

KIND_LABELS = {
    "outage": "Outage",
    "uwpc": "UWPC",
    "switching": "Switching plan",
    "schematic": "One-line",
    "logbook": "Logbook",
    "field": "Field report",
    "crew": "Crew",
}

RELATION_LABELS = {
    "covers": "Work protection for",
    "supports": "Supports",
    "isolates": "Isolation sequence for",
    "depicts": "Depicts",
    "documents": "Documents",
    "reports": "Reports on",
    "assigned": "Assigned to",
}

UWPC_KIND_LABELS = {
    "pc2_work_permit": "PC2 issued work permit",
    "pc17b_self_administered": "PC17B self-administered work permit",
    "supporting_guarantee": "Supporting guarantee",
    "hold_off": "Hold-off",
}

Board = Mapping[str, Any]
Outage = Mapping[str, Any]
RecordLink = Mapping[str, Any]


def is_work_permit(kind: str) -> bool:
    return kind in ("pc2_work_permit", "pc17b_self_administered")


def node_key(kind: str, record_id: str) -> str:
    return f"{kind}:{record_id}"


def linked_ids(links: Sequence[RecordLink], kind: str, record_id: str, other_kind: str) -> list[str]:
    ids: set[str] = set()
    for link in links:
        if link["fromKind"] == kind and link["fromId"] == record_id and link["toKind"] == other_kind:
            ids.add(link["toId"])
        if link["toKind"] == kind and link["toId"] == record_id and link["fromKind"] == other_kind:
            ids.add(link["fromId"])
    return list(ids)


def _collection(board: Board, kind: str) -> Sequence[Mapping[str, Any]]:
    return {
        "outage": board.get("outages", ()),
        "uwpc": board.get("uwpc", ()),
        "switching": board.get("switching", ()),
        "schematic": board.get("schematics", ()),
        "logbook": board.get("logbook", ()),
        "field": board.get("field", ()),
        "crew": board.get("crews", ()),
    }.get(kind, ())


def record_exists(board: Board, kind: str, record_id: str) -> bool:
    return any(row["id"] == record_id for row in _collection(board, kind))


def record_href(kind: str, record_id: str) -> str:
    if kind == "outage":
        return f"/outages/{record_id}"
    if kind == "uwpc":
        return f"/uwpc/{record_id}"
    if kind == "switching":
        return f"/switching/{record_id}"
    if kind == "schematic":
        return f"/graph?focus={node_key(kind, record_id)}"
    if kind in ("logbook", "field", "crew"):
        return f"/field#{record_id}"
    return "/"


def _find(rows: Iterable[Mapping[str, Any]], record_id: str) -> Mapping[str, Any] | None:
    return next((row for row in rows if row["id"] == record_id), None)


def record_label(board: Board, kind: str, record_id: str) -> str:
    if kind == "outage":
        item = _find(board.get("outages", ()), record_id)
        return f"{item['id']} · {item['asset']}" if item else record_id
    if kind == "uwpc":
        item = _find(board.get("uwpc", ()), record_id)
        return f"{item['number']} · {UWPC_KIND_LABELS[item['kind']]}" if item else record_id
    if kind == "switching":
        item = _find(board.get("switching", ()), record_id)
        return item["packageName"] if item else record_id
    if kind == "schematic":
        item = _find(board.get("schematics", ()), record_id)
        return f"{item['name']} r{item['revision']}" if item else record_id
    if kind == "logbook":
        item = _find(board.get("logbook", ()), record_id)
        return item["subject"] if item else record_id
    if kind == "field":
        item = _find(board.get("field", ()), record_id)
        return item["summary"] if item else record_id
    if kind == "crew":
        item = _find(board.get("crews", ()), record_id)
        return item["name"] if item else record_id
    return record_id


def record_status(board: Board, kind: str, record_id: str) -> str:
    if kind == "logbook":
        return "Logged"
    rows = _collection(board, kind)
    item = _find(rows, record_id)
    return str(item.get("status", "") if item else "")


def record_site(board: Board, kind: str, record_id: str) -> str:
    item = _find(_collection(board, kind), record_id)
    return str(item.get("site", "") if item else "")


def same_link(a: RecordLink, b: Mapping[str, str]) -> bool:
    forward = (
        a["fromKind"] == b["fromKind"]
        and a["fromId"] == b["fromId"]
        and a["toKind"] == b["toKind"]
        and a["toId"] == b["toId"]
        and a["relation"] == b["relation"]
    )
    reverse = (
        a["fromKind"] == b["toKind"]
        and a["fromId"] == b["toId"]
        and a["toKind"] == b["fromKind"]
        and a["toId"] == b["fromId"]
        and a["relation"] == b["relation"]
    )
    return forward or reverse


def allowed_relations(from_kind: str, to_kind: str) -> list[str]:
    pair = ":".join(sorted((from_kind, to_kind)))
    if pair == "outage:uwpc":
        return ["covers"]
    if pair == "uwpc:uwpc":
        return ["supports"]
    if pair == "outage:switching":
        return ["isolates"]
    if pair in ("outage:schematic", "schematic:switching", "schematic:uwpc"):
        return ["depicts"]
    if pair in ("logbook:outage", "logbook:switching", "logbook:uwpc"):
        return ["documents"]
    if pair == "field:outage":
        return ["reports"]
    if pair == "crew:outage":
        return ["assigned"]
    return []


def _board_uwpc(board: Board, record_id: str) -> Mapping[str, Any] | None:
    return _find(board.get("uwpc", ()), record_id)


def validate_link(input_data: Mapping[str, Any]) -> str | None:
    from_kind = input_data["fromKind"]
    from_id = input_data["fromId"]
    to_kind = input_data["toKind"]
    to_id = input_data["toId"]
    relation = input_data["relation"]
    board = input_data["board"]
    if from_kind == to_kind and from_id == to_id:
        return "A record cannot be linked to itself."
    if not record_exists(board, from_kind, from_id) or not record_exists(board, to_kind, to_id):
        return "Both records must exist before they can be linked."
    allowed = allowed_relations(from_kind, to_kind)
    if relation not in allowed:
        return (
            f"{RELATION_LABELS[relation]} is not a valid connection between "
            f"{KIND_LABELS[from_kind]} and {KIND_LABELS[to_kind]}."
        )
    if relation == "supports":
        from_row = _board_uwpc(board, from_id)
        to_row = _board_uwpc(board, to_id)
        if not from_row or not to_row:
            return "Both ends of a supporting-guarantee link must be UWPC instruments."
        guarantee = (
            from_row
            if from_row["kind"] == "supporting_guarantee"
            else to_row
            if to_row["kind"] == "supporting_guarantee"
            else None
        )
        permit = from_row if is_work_permit(from_row["kind"]) else to_row if is_work_permit(to_row["kind"]) else None
        if not guarantee or not permit:
            return "A supporting guarantee can only support a PC2 or PC17B work permit."
    duplicate = any(
        same_link(
            link,
            {
                "fromKind": from_kind,
                "fromId": from_id,
                "toKind": to_kind,
                "toId": to_id,
                "relation": relation,
            },
        )
        for link in board.get("links", ())
    )
    if duplicate:
        return "That connection already exists."
    return None


def gaps_for_outage(board: Board, outage: Outage) -> list[dict[str, str]]:
    gaps: list[dict[str, str]] = []
    if outage.get("status") != "Open":
        return gaps

    uwpc_ids = linked_ids(board.get("links", ()), "outage", outage["id"], "uwpc")
    instruments = [row for row in board.get("uwpc", ()) if row["id"] in uwpc_ids]
    permits = [row for row in instruments if is_work_permit(row["kind"])]
    guarantees = [row for row in instruments if row["kind"] == "supporting_guarantee"]
    hold_offs = [row for row in instruments if row["kind"] == "hold_off"]
    switching_ids = linked_ids(board.get("links", ()), "outage", outage["id"], "switching")
    schematic_ids = linked_ids(board.get("links", ()), "outage", outage["id"], "schematic")
    log_ids = linked_ids(board.get("links", ()), "outage", outage["id"], "logbook")
    field_ids = linked_ids(board.get("links", ()), "outage", outage["id"], "field")
    crew_ids = linked_ids(board.get("links", ()), "outage", outage["id"], "crew")

    if outage.get("protectionMode") == "work_permit" and not permits:
        gaps.append(
            {
                "id": f"{outage['id']}:missing-permit",
                "outageId": outage["id"],
                "severity": "blocking",
                "code": "UWPC_PERMIT",
                "title": "No UWPC work permit",
                "detail": (
                    "Isolation work needs a PC2 issued work permit or a PC17B self-administered "
                    "work permit linked to this outage. A hold-off is not a substitute."
                ),
            }
        )

    if outage.get("protectionMode") == "hold_off" and not hold_offs:
        gaps.append(
            {
                "id": f"{outage['id']}:missing-holdoff",
                "outageId": outage["id"],
                "severity": "blocking",
                "code": "UWPC_HOLDOFF",
                "title": "No UWPC hold-off",
                "detail": (
                    "This outage is live-line / reclose-blocked work. Link a hold-off. "
                    "Do not treat a hold-off as work protection for isolated apparatus."
                ),
            }
        )

    if outage.get("protectionMode") == "work_permit" and hold_offs and not permits:
        gaps.append(
            {
                "id": f"{outage['id']}:holdoff-not-permit",
                "outageId": outage["id"],
                "severity": "warning",
                "code": "HOLDOFF_NOT_PERMIT",
                "title": "Hold-off is not work protection",
                "detail": (
                    "A hold-off only blocks reclosing or manual re-energization. "
                    "It cannot stand in for a work permit on isolated equipment."
                ),
            }
        )

    if permits:
        for permit in permits:
            supported = any(
                link["relation"] == "supports"
                and (
                    (link["fromKind"] == "uwpc" and link["fromId"] == permit["id"])
                    or (link["toKind"] == "uwpc" and link["toId"] == permit["id"])
                )
                for link in board.get("links", ())
            )
            if guarantees and not supported:
                gaps.append(
                    {
                        "id": f"{outage['id']}:orphan-guarantee-{permit['id']}",
                        "outageId": outage["id"],
                        "severity": "warning",
                        "code": "GUARANTEE_UNBOUND",
                        "title": "Supporting guarantee not bound to the work permit",
                        "detail": (
                            f"{permit['number']} is linked to the outage, but its supporting "
                            "guarantee is not linked to the permit with a supports relation."
                        ),
                    }
                )

    if outage.get("isolationRequired") and not switching_ids:
        gaps.append(
            {
                "id": f"{outage['id']}:missing-switching",
                "outageId": outage["id"],
                "severity": "blocking",
                "code": "SWITCHING",
                "title": "No switching plan",
                "detail": (
                    "Isolation work needs a switching plan pinned to this outage. "
                    "Plans remain drafting / review evidence only — they do not release equipment."
                ),
            }
        )

    if not schematic_ids:
        gaps.append(
            {
                "id": f"{outage['id']}:missing-schematic",
                "outageId": outage["id"],
                "severity": "info",
                "code": "SCHEMATIC",
                "title": "No one-line drawing",
                "detail": "Link the current one-line so isolation points and tags share the same diagram revision.",
            }
        )

    if not log_ids and not field_ids:
        gaps.append(
            {
                "id": f"{outage['id']}:missing-narrative",
                "outageId": outage["id"],
                "severity": "warning",
                "code": "NARRATIVE",
                "title": "No logbook or field report",
                "detail": "The outage has no operator log or field report, so shift handoff cannot see why it is open.",
            }
        )

    if not crew_ids and outage.get("severity") != "Monitor":
        gaps.append(
            {
                "id": f"{outage['id']}:missing-crew",
                "outageId": outage["id"],
                "severity": "info",
                "code": "CREW",
                "title": "No crew assigned",
                "detail": "Assign the crew working this outage so the field tracker and outage board stay in lockstep.",
            }
        )

    live_permits = [row for row in permits if row.get("status") in ("Issued", "In force")]
    if live_permits and not switching_ids and outage.get("isolationRequired"):
        gaps.append(
            {
                "id": f"{outage['id']}:permit-without-plan",
                "outageId": outage["id"],
                "severity": "warning",
                "code": "PERMIT_NO_PLAN",
                "title": "Work permit has no switching plan",
                "detail": (
                    "An in-force UWPC permit is linked, but no isolation sequence is attached. "
                    "The permit and the plan should share this outage."
                ),
            }
        )

    return gaps


def all_gaps(board: Board) -> list[dict[str, str]]:
    return [gap for outage in board.get("outages", ()) for gap in gaps_for_outage(board, outage)]


def completeness(board: Board, outage: Outage) -> int:
    links = board.get("links", ())
    uwpc_ids = linked_ids(links, "outage", outage["id"], "uwpc")
    protection_ok = outage.get("protectionMode") == "none" or (
        outage.get("protectionMode") == "work_permit"
        and any(
            (instrument := _find(board.get("uwpc", ()), record_id)) is not None
            and is_work_permit(instrument["kind"])
            for record_id in uwpc_ids
        )
    ) or (
        outage.get("protectionMode") == "hold_off"
        and any(
            (instrument := _find(board.get("uwpc", ()), record_id)) is not None
            and instrument.get("kind") == "hold_off"
            for record_id in uwpc_ids
        )
    )
    checks = [
        protection_ok,
        (not outage.get("isolationRequired")) or bool(linked_ids(links, "outage", outage["id"], "switching")),
        bool(linked_ids(links, "outage", outage["id"], "schematic")),
        bool(linked_ids(links, "outage", outage["id"], "logbook"))
        or bool(linked_ids(links, "outage", outage["id"], "field")),
        bool(linked_ids(links, "outage", outage["id"], "crew")),
    ]
    passed = sum(1 for check in checks if check)
    return round((passed / len(checks)) * 100)


def can_close_outage(board: Board, outage: Outage) -> dict[str, Any]:
    uwpc_ids = linked_ids(board.get("links", ()), "outage", outage["id"], "uwpc")
    live = [
        row
        for row in board.get("uwpc", ())
        if row["id"] in uwpc_ids and row.get("status") in ("Issued", "In force", "Requested")
    ]
    if live:
        numbers = ", ".join(row["number"] for row in live)
        return {
            "ok": False,
            "reason": (
                f"Surrender or cancel {numbers} before closing the outage. "
                "Live UWPC instruments must stay attached to an open outage."
            ),
        }
    return {"ok": True}


def close_outage_blocked_reason(board: Board, outage_id: str) -> str | None:
    """Adapter for the Python dashboard close handler.

    Call before store.close_outage. Returns None when close is allowed.
    """
    outage = _find(board.get("outages", ()), outage_id)
    if not outage:
        return None
    gate = can_close_outage(board, outage)
    if gate.get("ok"):
        return None
    return str(gate.get("reason") or "Outage cannot be closed while UWPC is live.")
