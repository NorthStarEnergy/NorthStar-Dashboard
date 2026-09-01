"""Operator AI assistant: scoped retrieval, citations, and optional model adapters.

Packet 18 contract draft (`proposed/packet18_ai_assistant_contract/`). This module
never invents operational facts. With the default ``summary`` engine it answers
from retrieved, operator-visible records only. External models are optional and
must be wired through ``NORTHSTAR_AI_ENGINE=command``.

Three load-bearing rules, aligned with voice triage and ADR-020:

1. **Nothing is invented.** No placeholder text and no uncited assertions.
2. **Scopes are explicit.** Worker roster/GPS, voice transcripts, and switching
   drafts are denied unless an operator enables them in runtime configuration.
3. **Output is labelled.** Every response states whether it is a retrieved
   summary or model-assisted synthesis.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shlex
import subprocess
import uuid
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import northstar_events as events
import northstar_store as store

ROOT = __import__("pathlib").Path(__file__).resolve().parent
TZ = ZoneInfo("America/Toronto")

ALLOWED_SCOPES = frozenset({
    "general",
    "events",
    "market",
    "outages",
    "logbook",
    "site",
})
RESTRICTED_SCOPES = frozenset({
    "worker-status",
    "switching",
    "voice",
})
ALL_SCOPES = ALLOWED_SCOPES | RESTRICTED_SCOPES

DISCLAIMER = (
    "AI-assisted summary only. Verify citations before any operational decision. "
    "This output is not an equipment command or safety release."
)


class AssistantUnavailable(Exception):
    """The configured engine cannot answer."""


class ScopeDenied(ValueError):
    """The requested scope is not enabled for this deployment."""


def engine_name() -> str:
    return os.environ.get("NORTHSTAR_AI_ENGINE", "summary").strip().lower() or "summary"


def enabled_restricted_scopes() -> set[str]:
    raw = os.environ.get("NORTHSTAR_AI_RESTRICTED_SCOPES", "").strip()
    if not raw:
        return set()
    return {part.strip().lower() for part in raw.split(",") if part.strip()}


def _now_iso() -> str:
    return datetime.now(TZ).isoformat()


def _snapshot_id(context: dict[str, Any]) -> str:
    digest = hashlib.sha256(
        json.dumps(context, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()[:16]
    return f"snap_{digest}"


def _citation(
    *,
    source: str,
    source_kind: str,
    record_id: str,
    retrieved_at: str | None = None,
) -> dict[str, str]:
    return {
        "source": source,
        "source_kind": source_kind,
        "retrieved_at": retrieved_at or _now_iso(),
        "id": record_id,
    }


def _tokens(text: str) -> list[str]:
    return [token for token in re.findall(r"[a-z0-9]+", text.lower()) if len(token) > 2]


def _matches_question(question: str, *fields: Any) -> bool:
    tokens = _tokens(question)
    if not tokens:
        return True
    haystack = " ".join(str(field or "") for field in fields).lower()
    return any(token in haystack for token in tokens)


def _uncertainty(citation_count: int, *, inferred: bool = False) -> str:
    if citation_count == 0:
        return "unknown"
    if citation_count >= 3 and not inferred:
        return "high"
    if citation_count == 1 or inferred:
        return "medium"
    return "low"


def _search_query(question: str) -> str:
    tokens = _tokens(question)
    if not tokens:
        return ""
    # Prefer distinctive tokens; drop common question words.
    stop = {
        "what", "when", "where", "which", "who", "how", "why", "the", "and", "for",
        "with", "from", "about", "were", "was", "are", "any", "all", "recent",
        "latest", "summarize", "summary", "list", "find", "show", "tell", "happened",
    }
    keywords = [token for token in tokens if token not in stop]
    return keywords[0] if len(keywords) == 1 else " ".join(keywords[:4])


def _retrieve_events(question: str, *, limit: int = 40) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    search = _search_query(question)
    rows = store.list_audit_events(limit=limit, query=search)
    if not rows and search != question.strip():
        rows = store.list_audit_events(limit=limit, query=question.strip())
    if not rows and not search:
        rows = store.list_audit_events(limit=limit)
    citations = [
        _citation(
            source=f"audit_events:{row['eventId']}",
            source_kind="database",
            record_id=row["eventId"],
            retrieved_at=row.get("recordedAt"),
        )
        for row in rows
    ]
    return rows, citations


def _retrieve_logbook(question: str, *, limit: int = 25) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    rows = [
        row for row in store.list_logbook(limit)
        if _matches_question(question, row.get("subject"), row.get("details"), row.get("type"))
    ]
    citations = [
        _citation(
            source=f"logbook:{row['id']}",
            source_kind="database",
            record_id=row["id"],
            retrieved_at=row.get("timestamp"),
        )
        for row in rows
    ]
    return rows, citations


def _retrieve_outages(question: str) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    rows = [
        row for row in store.list_outages()
        if _matches_question(
            question,
            row.get("title"),
            row.get("asset"),
            row.get("site"),
            row.get("details"),
            row.get("status"),
        )
    ]
    citations = [
        _citation(
            source=f"outages:{row['id']}",
            source_kind="database",
            record_id=row["id"],
            retrieved_at=row.get("openedAt"),
        )
        for row in rows
    ]
    return rows, citations


def _retrieve_general() -> tuple[dict[str, Any], list[dict[str, str]]]:
    summary = store.operational_summary()
    citation = _citation(
        source="operational_summary:current",
        source_kind="database",
        record_id="operational_summary",
    )
    return summary, [citation]


def _retrieve_market(market_snapshot: dict[str, Any] | None) -> tuple[dict[str, Any], list[dict[str, str]]]:
    snapshot = market_snapshot or {"stale": True, "nodes": {}}
    updated = snapshot.get("updated") or _now_iso()
    citation = _citation(
        source="market:snapshot",
        source_kind="live-feed",
        record_id=f"market@{updated}",
        retrieved_at=updated,
    )
    return snapshot, [citation]


def _format_event_line(row: dict[str, Any]) -> str:
    when = row.get("occurredAt", "—")
    return f"{when} · {row.get('eventType', 'event')} · {row.get('summary', '')}"


def _summarize_events(question: str, rows: list[dict[str, Any]]) -> str:
    if not rows:
        return "No matching events were found in the unified audit timeline for that question."
    alarms = [row for row in rows if str(row.get("severity", "")).lower() in {"warn", "warning", "critical"}]
    lines = [f"Found {len(rows)} matching event(s) in the audit timeline."]
    if alarms:
        lines.append(f"{len(alarms)} carry elevated severity.")
    lines.append("Most recent matches:")
    lines.extend(f"- {_format_event_line(row)}" for row in rows[:8])
    if len(rows) > 8:
        lines.append(f"- …and {len(rows) - 8} more.")
    return "\n".join(lines)


def _summarize_logbook(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return "No logbook entries matched that question."
    lines = [f"Found {len(rows)} logbook entr{'y' if len(rows) == 1 else 'ies'}."]
    for row in rows[:8]:
        lines.append(
            f"- {row.get('timestamp', '—')} · {row.get('type', 'entry')} · "
            f"{row.get('subject', 'Untitled')}"
        )
    return "\n".join(lines)


def _summarize_outages(rows: list[dict[str, Any]]) -> str:
    open_rows = [row for row in rows if row.get("status") == "Open"]
    if not rows:
        return "No outages matched that question."
    lines = [f"Matched {len(rows)} outage record(s); {len(open_rows)} remain open."]
    for row in open_rows[:8]:
        lines.append(
            f"- {row.get('site', 'Unknown site')} · {row.get('severity', 'Monitor')} · "
            f"{row.get('asset') or row.get('title', 'Unspecified asset')}"
        )
    return "\n".join(lines)


def _summarize_general(summary: dict[str, Any]) -> str:
    return (
        "Operational snapshot: "
        f"{summary.get('activeCheckins', 0)} active check-ins, "
        f"{summary.get('overdueCheckins', 0)} overdue, "
        f"{summary.get('openHelpRequests', 0)} open help request(s), "
        f"{summary.get('openOutages', 0)} open outage(s), "
        f"{summary.get('openPriceAlerts', 0)} open price alert(s). "
        f"Database integrity: {summary.get('integrity', 'unknown')}."
    )


def _summarize_market(snapshot: dict[str, Any], question: str) -> str:
    nodes = snapshot.get("nodes") or {}
    if snapshot.get("stale"):
        return "Market snapshot is stale or unavailable; no current prices were cited."
    matches = [
        (name, values)
        for name, values in nodes.items()
        if _matches_question(question, name, values.get("location"))
    ]
    if not matches:
        matches = list(nodes.items())[:4]
    lines = ["Current market snapshot:"]
    for name, values in matches[:6]:
        rt = values.get("rt")
        da = values.get("da")
        rt_text = f"${float(rt):.2f}" if rt is not None else "—"
        da_text = f"${float(da):.2f}" if da is not None else "—"
        lines.append(f"- {name}: RT {rt_text}, DA {da_text}")
    return "\n".join(lines)


def _build_context(
    scope: str,
    question: str,
    *,
    market_snapshot: dict[str, Any] | None = None,
    event_filter: str = "",
) -> dict[str, Any]:
    scope = scope.strip().lower()
    if scope in RESTRICTED_SCOPES and scope not in enabled_restricted_scopes():
        raise ScopeDenied(
            f"Scope '{scope}' is not enabled. Set NORTHSTAR_AI_RESTRICTED_SCOPES to opt in."
        )
    if scope not in ALL_SCOPES:
        raise ValueError(f"Unknown context scope: {scope}")

    if scope == "events":
        query = question.strip() or event_filter.strip()
        rows, citations = _retrieve_events(query)
        return {
            "scope": scope,
            "question": question,
            "records": rows,
            "citations": citations,
            "summary": _summarize_events(question, rows),
        }
    if scope == "logbook":
        rows, citations = _retrieve_logbook(question)
        return {
            "scope": scope,
            "question": question,
            "records": rows,
            "citations": citations,
            "summary": _summarize_logbook(rows),
        }
    if scope == "outages":
        rows, citations = _retrieve_outages(question)
        return {
            "scope": scope,
            "question": question,
            "records": rows,
            "citations": citations,
            "summary": _summarize_outages(rows),
        }
    if scope == "market":
        snapshot, citations = _retrieve_market(market_snapshot)
        return {
            "scope": scope,
            "question": question,
            "records": snapshot,
            "citations": citations,
            "summary": _summarize_market(snapshot, question),
        }
    if scope == "site":
        outages, outage_citations = _retrieve_outages(question)
        logs, log_citations = _retrieve_logbook(question)
        events_rows, event_citations = _retrieve_events(question, limit=20)
        return {
            "scope": scope,
            "question": question,
            "records": {
                "outages": outages,
                "logbook": logs,
                "events": events_rows,
            },
            "citations": outage_citations + log_citations + event_citations,
            "summary": "\n\n".join(
                part
                for part in (
                    _summarize_outages(outages),
                    _summarize_logbook(logs),
                    _summarize_events(question, events_rows),
                )
                if part
            ),
        }
    summary, citations = _retrieve_general()
    return {
        "scope": scope,
        "question": question,
        "records": summary,
        "citations": citations,
        "summary": _summarize_general(summary),
    }


def _split_command(template: str) -> list[str]:
    return shlex.split(template, posix=os.name != "nt")


def _run_command_engine(question: str, context: dict[str, Any]) -> str:
    template = os.environ.get("NORTHSTAR_AI_COMMAND", "").strip()
    if not template:
        raise AssistantUnavailable("NORTHSTAR_AI_COMMAND is not set")
    timeout = max(10, int(os.environ.get("NORTHSTAR_AI_TIMEOUT_SECONDS", "120")))
    payload = json.dumps(
        {
            "question": question,
            "scope": context.get("scope"),
            "summary": context.get("summary"),
            "records": context.get("records"),
            "citations": context.get("citations"),
        },
        ensure_ascii=False,
        default=str,
    )
    command = [
        part.replace("{question}", question).replace("{context}", payload)
        for part in _split_command(template)
    ]
    completed = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            f"AI command exited {completed.returncode}: "
            f"{(completed.stderr or '').strip()[:400]}"
        )
    stdout = (completed.stdout or "").strip()
    if not stdout:
        raise RuntimeError("AI command returned an empty response")
    try:
        parsed = json.loads(stdout)
    except json.JSONDecodeError:
        return stdout
    if isinstance(parsed, dict):
        answer = str(parsed.get("answer") or parsed.get("reply") or "").strip()
        if answer:
            return answer
    return stdout


def _persist_query(
    *,
    actor: str,
    scope: str,
    question: str,
    response: dict[str, Any],
) -> str:
    query_id = f"aiq_{uuid.uuid4().hex}"
    with store._LOCK, store._session() as connection:
        events.append_event(
            connection,
            event_id=query_id,
            event_type="ai.query",
            occurred_at=_now_iso(),
            actor_id=actor,
            aggregate_type="ai_query",
            aggregate_id=query_id,
            source="northstar-ai",
            summary=f"AI query ({scope})",
            payload={
                "scope": scope,
                "question": question[:500],
                "answerPreview": str(response.get("answer", ""))[:240],
                "citationCount": len(response.get("citations") or []),
                "engine": response.get("model_version"),
                "inputSnapshotId": response.get("input_snapshot_id"),
            },
            severity="info",
        )
    return query_id


def query(
    question: str,
    *,
    context_scope: str = "general",
    actor: str = "operator",
    market_snapshot: dict[str, Any] | None = None,
    event_filter: str = "",
    section: str = "",
    persist: bool = True,
) -> dict[str, Any]:
    """Answer an operator question for a single explicit scope."""
    cleaned = str(question or "").strip()
    if not cleaned:
        raise ValueError("question is required")
    if len(cleaned) > 2000:
        raise ValueError("question is too long")

    scope = str(context_scope or "general").strip().lower()
    context = _build_context(
        scope,
        cleaned,
        market_snapshot=market_snapshot,
        event_filter=event_filter,
    )
    citations = list(context.get("citations") or [])
    snapshot_id = _snapshot_id(context)
    engine = engine_name()

    if engine == "none":
        raise AssistantUnavailable("AI surface is not configured")
    if engine == "summary":
        answer = str(context.get("summary") or "").strip()
        label = "Retrieved summary"
        model_version = "northstar-summary/1"
        inferred = False
    elif engine == "command":
        answer = _run_command_engine(cleaned, context).strip()
        label = "Model-assisted synthesis"
        model_version = os.environ.get("NORTHSTAR_AI_MODEL_VERSION", "external-command")
        inferred = True
    else:
        raise AssistantUnavailable(f"Unsupported AI engine: {engine}")

    if not answer:
        answer = "No answer could be produced from the retrieved records."
    if not citations:
        answer += "\n\nNo independent citations were available for this response."

    response = {
        "answer": answer,
        "citations": citations,
        "uncertainty": _uncertainty(len(citations), inferred=inferred),
        "model_version": model_version,
        "input_snapshot_id": snapshot_id,
        "persisted": False,
        "label": label,
        "disclaimer": DISCLAIMER,
        "scope": scope,
        "section": section.strip() or None,
        "query_id": None,
    }
    if persist:
        response["query_id"] = _persist_query(
            actor=actor,
            scope=scope,
            question=cleaned,
            response=response,
        )
        response["persisted"] = True
    return response


def status() -> dict[str, Any]:
  return {
      "engine": engine_name(),
      "allowedScopes": sorted(ALLOWED_SCOPES),
      "restrictedScopes": sorted(RESTRICTED_SCOPES),
      "enabledRestrictedScopes": sorted(enabled_restricted_scopes()),
      "disclaimer": DISCLAIMER,
  }
