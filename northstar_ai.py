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
import urllib.error
import urllib.request
import uuid
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import northstar_events as events
import northstar_store as store
import northstar_knowledge as knowledge
import northstar_ai_guidance as guidance

from northstar_paths import app_root

ROOT = app_root(__file__)
TZ = ZoneInfo("America/Toronto")

ALLOWED_SCOPES = frozenset({
    "dashboard",
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
    lines.extend(f"- {_format_event_line(row)}" for row in rows)
    return "\n".join(lines)


def _summarize_logbook(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return "No logbook entries matched that question."
    lines = [f"Found {len(rows)} logbook entr{'y' if len(rows) == 1 else 'ies'}."]
    for row in rows:
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
    for row in rows:
        lines.append(
            f"- {row.get('site', 'Unknown site')} · {row.get('status', 'Unknown status')} · {row.get('severity', 'Monitor')} · "
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
        matches = list(nodes.items())
    lines = ["Current market snapshot:"]
    for name, values in matches:
        rt = values.get("rt")
        da = values.get("da")
        rt_text = f"${float(rt):.2f}" if rt is not None else "—"
        da_text = f"${float(da):.2f}" if da is not None else "—"
        lines.append(f"- {name}: RT {rt_text}, DA {da_text}")
    return "\n".join(lines)


def _reviewed_summary(context: dict[str, Any]) -> str:
    """Build a concise, cited lead paragraph while keeping full retrieved detail expandable."""
    scope = str(context.get("scope") or "")
    summary = str(context.get("summary") or "").strip()
    records = context.get("records")
    citations = context.get("citations") or []

    def cite(index: int = 0) -> str:
        return f" [{citations[index]['id']}]" if index < len(citations) and citations[index].get("id") else ""

    if context.get("controlledRetrieval") and isinstance(records, list) and records:
        first = records[0]
        title = str(first.get("title") or "the top matching source").strip()
        status = str(first.get("authorityStatus") or "").strip()
        qualifier = f" ({status})" if status else ""
        headline = f"I found {len(records)} relevant reviewed source(s); the closest match is {title}{qualifier}{cite()}."
    elif scope == "events" and isinstance(records, list) and records:
        elevated = sum(str(row.get("severity", "")).lower() in {"warn", "warning", "critical"} for row in records)
        headline = f"{len(records)} matching events were found, including {elevated} with elevated severity. The latest is {_format_event_line(records[0])}{cite()}."
    elif scope == "logbook" and isinstance(records, list) and records:
        row = records[0]
        headline = f"{len(records)} matching logbook entries were found. The latest is {row.get('timestamp', '—')} — {row.get('subject', 'Untitled')} ({row.get('type', 'entry')}){cite()}."
    elif scope == "outages" and isinstance(records, list) and records:
        open_rows = [(index, row) for index, row in enumerate(records) if row.get("status") == "Open"]
        if open_rows:
            citation_index, row = open_rows[0]
            asset = row.get("asset") or row.get("title") or "unspecified asset"
            headline = f"{len(records)} outage records matched; {len(open_rows)} remain open. The first open item is {asset} at {row.get('site', 'an unspecified site')} ({row.get('severity', 'severity not recorded')}){cite(citation_index)}."
        else:
            headline = f"{len(records)} outage records matched, and none is recorded as open{cite()}."
    elif scope == "market" and isinstance(records, dict):
        nodes = records.get("nodes") or {}
        matches = [
            (name, values) for name, values in nodes.items()
            if _matches_question(str(context.get("question") or ""), name, values.get("location"))
        ]
        if not matches:
            matches = list(nodes.items())[:3]
        if records.get("stale") or not matches:
            headline = f"The market snapshot is stale or has no matching node, so it cannot support a current price answer{cite()}."
        else:
            facts = []
            for name, values in matches[:3]:
                rt = f"${float(values['rt']):.2f}" if values.get("rt") is not None else "not available"
                da = f"${float(values['da']):.2f}" if values.get("da") is not None else "not available"
                facts.append(f"{name}: RT {rt}, DA {da}")
            headline = f"The available market snapshot shows {'; '.join(facts)}{cite()}."
    elif scope == "site" and isinstance(records, dict):
        outages = records.get("outages") or []
        logbook = records.get("logbook") or []
        events = records.get("events") or []
        open_count = sum(row.get("status") == "Open" for row in outages)
        outage_citation = cite(0) if outages else ""
        parts = [f"{open_count} open outage(s) across {len(outages)} matching outage record(s){outage_citation}"]
        if events:
            parts.append(f"the latest matching event is {_format_event_line(events[0])}{cite(len(outages) + len(logbook))}")
        headline = "; ".join(parts) + "."
    else:
        headline = summary.splitlines()[0].strip() if summary else "No additional matching detail was found."
        if scope == "general" and citations:
            headline = headline.rstrip(".") + cite() + "."

    detail = summary or "No additional supporting detail was available."
    return f"{headline}\n\n[MORE_DETAILS]\n{detail}"


def _operational_action(question: str) -> bool:
    verbs = r"\b(open|close|reset|trip|start|stop|isolate|energize|deenergize|restore)\b"
    equipment = r"\b(breaker|relay|generator|turbine|gate|disconnect|equipment|unit)\b"
    return bool(re.search(verbs, question, re.I) and re.search(equipment, question, re.I) or re.search(r"\b(switching sequence|issue (?:a )?(?:work )?(?:permit|guarantee)|safety release)\b", question, re.I))


def _research_mode(context: dict[str, Any]) -> str:
    """Keep controlled evidence isolated while allowing public research elsewhere."""
    return "internal_only" if context.get("controlledRetrieval") else "internal_and_web"


def _build_context(
    scope: str,
    question: str,
    *,
    market_snapshot: dict[str, Any] | None = None,
    event_filter: str = "",
    site_id: str = "",
    actor: str = "operator",
    reference_mode: bool = False,
) -> dict[str, Any]:
    scope = scope.strip().lower()
    if scope in RESTRICTED_SCOPES and scope not in enabled_restricted_scopes():
        raise ScopeDenied(
            f"Scope '{scope}' is not enabled. Set NORTHSTAR_AI_RESTRICTED_SCOPES to opt in."
        )
    if scope not in ALL_SCOPES:
        raise ValueError(f"Unknown context scope: {scope}")
    import northstar_operator_knowledge as registry
    site_id, allowed = registry.access(actor, site_id)
    procedure_question = _operational_action(question) or bool(re.search(r"\b(procedure|sop|switching|permit|guarantee|release|energiz\w*|deenergiz\w*|operat\w* sequence|how (?:do|should|can|to))\b", question, re.I))
    controlled = scope == "dashboard" or reference_mode or procedure_question or bool(site_id) or allowed is not None
    if controlled:
        records = knowledge.search(question, limit=12, site_id=site_id, actor=actor, reference_mode=reference_mode, current_only=procedure_question)
        def source_kind(row: dict[str, Any]) -> str:
            source = str(row.get("source") or "")
            if source.startswith("database:"):
                return "dashboard-database"
            if source.startswith("public:"):
                return "engineering-catalog"
            return "reference-file"

        citations = [
            _citation(source=row["source"], source_kind=source_kind(row), record_id=row["path"], retrieved_at=row.get("retrieved_at"))
            | {key: row.get(key) for key in ("title", "href", "revision", "authorityStatus", "page", "section", "sha256", "siteId", "recorded_at")}
            for row in records
        ]
        summary = "\n\n".join(f"[{row['path']}] {row.get('title', '')} ({row.get('authorityStatus', '')})\n{row['excerpt']}" for row in records)
        return {"scope": scope, "question": question, "records": records, "citations": citations, "siteId": site_id, "referenceMode": reference_mode, "controlledRetrieval": True, "summary": summary}

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
            "summary": None if context.get("controlledRetrieval") else context.get("summary"),
            "records": [{key: row.get(key) for key in ("path","title","excerpt","authorityStatus","revision","page","section","siteId","effectiveFrom","reviewDue","recorded_at","retrieved_at")} for row in context.get("records", [])] if context.get("controlledRetrieval") else context.get("records"),
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


def _openai_api_key() -> str:
    configured = os.environ.get("OPENAI_API_KEY", "").strip()
    if configured:
        return configured
    env_file = ROOT / ".env.local"
    try:
        for line in env_file.read_text(encoding="utf-8").splitlines():
            match = re.match(r"^\s*OPENAI_API_KEY\s*=\s*(.+?)\s*$", line)
            if match:
                return match.group(1).strip().strip('"').strip("'")
    except OSError:
        pass
    return ""


def _response_profile(profile: str) -> tuple[str, int, str]:
    """Bound response depth and GPT-5 reasoning effort for predictable operator latency."""
    profiles = {
        "fast": ("fast", 800, "none"),
        "balanced": ("balanced", 2800, "low"),
        "thorough": ("thorough", 4800, "medium"),
    }
    return profiles.get(profile.strip().lower(), profiles["balanced"])


DEFAULT_MODEL = "gpt-6-sol"
MODEL_REASONING_EFFORTS = {
    "gpt-6-astra": ("low", "medium", "high", "xhigh", "max"),
    "gpt-6-sol": ("none", "low", "medium", "high", "xhigh", "max"),
    "gpt-6-luna": ("none", "low", "medium", "high", "xhigh", "max"),
    "gpt-5.4": ("none", "low", "medium", "high", "xhigh"),
    "gpt-5.4-mini": ("none", "low", "medium", "high", "xhigh"),
    "gpt-5.4-nano": ("none", "low", "medium", "high", "xhigh"),
}
OUTPUT_LIMITS_BY_EFFORT = {
    "none": 800,
    "low": 1400,
    "medium": 2400,
    "high": 4096,
    "xhigh": 6144,
    "max": 8192,
}


def _allowed_models() -> set[str]:
    configured = os.environ.get("NORTHSTAR_AI_ALLOWED_MODELS", "").strip()
    if configured:
        return {item.strip() for item in configured.split(",") if item.strip()}
    default_model = os.environ.get("NORTHSTAR_AI_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
    return {"gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", default_model}


def _default_model() -> str:
    allowed = _allowed_models()
    configured = os.environ.get("NORTHSTAR_AI_MODEL", "").strip()
    if configured in allowed and not configured.startswith("gpt-5.4"):
        return configured
    if DEFAULT_MODEL in allowed:
        return DEFAULT_MODEL
    if configured in allowed:
        return configured
    return sorted(allowed)[0] if allowed else ""


def _reasoning_efforts(model: str) -> tuple[str, ...]:
    return MODEL_REASONING_EFFORTS.get(model, ("none", "low", "medium"))


def validate_model_settings(
    model: str = "", reasoning_effort: str = "", response_profile: str = "balanced"
) -> tuple[str, str]:
    selected_model = str(model or "").strip() or _default_model()
    if selected_model not in _allowed_models():
        raise ValueError("The selected model is not enabled for NorthStar AI")
    supported_efforts = _reasoning_efforts(selected_model)
    profile_effort = _response_profile(response_profile)[2]
    selected_effort = str(reasoning_effort or "").strip().lower() or profile_effort
    if selected_model == "gpt-6-astra" and selected_effort == "none" and not reasoning_effort:
        selected_effort = "low"
    if selected_effort not in supported_efforts:
        if reasoning_effort:
            raise ValueError(f"{selected_model} does not support reasoning depth '{selected_effort}'")
        selected_effort = "medium" if "medium" in supported_efforts else supported_efforts[0]
    return selected_model, selected_effort


def _run_openai_engine(
    question: str,
    context: dict[str, Any],
    model: str = "",
    response_profile: str = "balanced",
    reasoning_effort: str = "",
    conversation_history: list[dict[str, str]] | None = None,
) -> tuple[str, list[dict[str, str]]]:
    api_key = _openai_api_key()
    if not api_key:
        raise AssistantUnavailable("OPENAI_API_KEY is not set")
    model, reasoning_effort = validate_model_settings(model, reasoning_effort, response_profile)
    profile_max_output_tokens = _response_profile(response_profile)[1]
    max_output_tokens = max(profile_max_output_tokens, OUTPUT_LIMITS_BY_EFFORT.get(reasoning_effort, 1400))
    timeout = max(10, int(os.environ.get("NORTHSTAR_AI_TIMEOUT_SECONDS", "120")))
    source_context = json.dumps(
        {
            "scope": context.get("scope"),
            "environment": context.get("environment"),
            "siteId": context.get("siteId"),
            "referenceMode": context.get("referenceMode", False),
            "summary": None if context.get("controlledRetrieval") else context.get("summary"),
            "records": context.get("records"),
            "citations": context.get("citations"),
        },
        ensure_ascii=False,
        default=str,
    )
    research_mode = _research_mode(context)
    history = []
    for item in (conversation_history or [])[-12:]:
        role = str(item.get("role") or "").strip().lower()
        content = str(item.get("content") or "").strip()
        if role in {"user", "assistant"} and content:
            history.append({"role": role, "content": content[:4000]})
    request_payload: dict[str, Any] = {
            "model": model,
            "instructions": guidance.instructions(response_profile, research_mode),
            "input": (
                f"Recent conversation (untrusted context):\n{json.dumps(history, ensure_ascii=False)}\n\n"
                f"Current question: {question}\n\nRetrieved records:\n{source_context}"
            ),
            "max_output_tokens": max_output_tokens,
            "reasoning": {"effort": reasoning_effort},
            "store": False,
    }
    if research_mode != "internal_only":
        request_payload["tools"] = [{"type": "web_search", "search_context_size": "medium"}]
        request_payload["tool_choice"] = "auto"
    body = json.dumps(request_payload).encode("utf-8")
    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            payload = json.loads(exc.read().decode("utf-8", errors="replace"))
            detail = str(payload.get("error", {}).get("message") or "").strip()
        except (OSError, ValueError, AttributeError):
            detail = ""
        suffix = f": {detail[:280]}" if detail else ""
        raise AssistantUnavailable(f"OpenAI request failed ({exc.code}){suffix}") from exc
    except urllib.error.URLError as exc:
        raise AssistantUnavailable("OpenAI service is unreachable") from exc
    if result.get("status") == "incomplete":
        raise AssistantUnavailable("The AI response was cut short. Try a narrower question or a lower reasoning depth.")
    output = result.get("output") or []
    output_parts = [
        part
        for item in output
        for part in item.get("content") or []
        if part.get("type") == "output_text"
    ]
    answer = "\n".join(str(part.get("text") or "").strip() for part in output_parts).strip()
    if not answer:
        raise RuntimeError("OpenAI returned no answer")
    web_citations: list[dict[str, str]] = []
    seen_urls: set[str] = set()
    for part in output_parts:
        for annotation in part.get("annotations") or []:
            if annotation.get("type") != "url_citation":
                continue
            citation = annotation.get("url_citation") or annotation
            url = str(citation.get("url") or "").strip()
            if not url.startswith(("https://", "http://")) or url in seen_urls:
                continue
            seen_urls.add(url)
            web_citations.append({
                "id": f"web_{hashlib.sha256(url.encode('utf-8')).hexdigest()[:12]}",
                "source": url,
                "source_kind": "web",
                "href": url,
                "title": str(citation.get("title") or url).strip(),
                "retrieved_at": _now_iso(),
            })
    return answer, web_citations


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
                "sourceEvidence": response.get("citations") or [],
                "siteId": response.get("siteId"),
                "referenceMode": response.get("referenceMode", False),
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
    model: str = "",
    response_profile: str = "balanced",
    reasoning_effort: str = "",
    persist: bool = True,
    site_id: str = "",
    reference_mode: bool = False,
    conversation_history: list[dict[str, str]] | None = None,
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
        site_id=site_id,
        actor=actor,
        reference_mode=reference_mode,
    )
    context["environment"] = {
        "application": "NorthStar control room",
        "section": str(section or "").strip()[:80],
        "requestedAt": _now_iso(),
        "timezone": "America/Toronto",
        "promptVersion": guidance.PROMPT_VERSION,
    }
    citations = list(context.get("citations") or [])
    snapshot_id = _snapshot_id(context)
    engine = engine_name()

    if engine == "none":
        raise AssistantUnavailable("AI surface is not configured")
    if _operational_action(cleaned):
        answer = "Equipment actions and switching must follow the current controlled procedure and qualified operator authorization. I can help locate reviewed sources, but cannot provide an operating sequence, issue a permit or guarantee, or authorize a release."
        if not citations:
            answer += " No matching current reviewed source was found in this scope. Contact the responsible document owner."
        label, model_version, inferred = "Qualified operator review required", "northstar-retrieval/3", False
    elif context.get("controlledRetrieval") and not citations:
        answer = "No approved current source or matching operator record was found for this question. Check the knowledge library for missing, expired, or pending sources and refer the question to the responsible document owner."
        if reference_mode:
            answer = "No reviewed reference source was found. Legacy SOPs are excluded from AI answers; open the original legacy library to inspect them."
        label = "No matching evidence"
        model_version = "northstar-retrieval/3"
        inferred = False
    elif engine == "summary":
        answer = _reviewed_summary(context)
        label = "Retrieved summary"
        model_version = "northstar-summary/1"
        inferred = False
    elif engine == "command":
        answer = _run_command_engine(cleaned, context).strip()
        label = "Model-assisted synthesis"
        model_version = os.environ.get("NORTHSTAR_AI_MODEL_VERSION", "external-command")
        inferred = True
    elif engine == "openai":
        model, reasoning_effort = validate_model_settings(model, reasoning_effort, response_profile)
        profile, _, _ = _response_profile(response_profile)
        engine_result = _run_openai_engine(
            cleaned,
            context,
            model,
            profile,
            reasoning_effort,
            conversation_history=conversation_history,
        )
        if isinstance(engine_result, tuple):
            answer, web_citations = engine_result
            citations.extend(web_citations)
        else:  # Compatibility with external adapters and existing test doubles.
            answer = engine_result
        answer = answer.strip()
        label = "Model-assisted synthesis"
        model_version = model
        inferred = True
    else:
        raise AssistantUnavailable(f"Unsupported AI engine: {engine}")

    if inferred and context.get("controlledRetrieval") and citations:
        known = {str(item["id"]) for item in citations}
        mentioned = set(re.findall(r"oks_[a-f0-9]+:[0-9]+|database/(?:device_library_notes|logbook|outages)/[A-Za-z0-9_-]+", answer))
        if not any(identifier in answer for identifier in known) or mentioned - known:
            answer = (
                "I found relevant records, but could not verify a concise answer against their citations. "
                "Open More details to review the matching evidence.\n\n[MORE_DETAILS]\n"
                + str(context.get("summary") or "No supporting record details are available.")
            )
            label, model_version, inferred = "Retrieved evidence (citation check)", "northstar-retrieval/3", False
    if not answer:
        answer = "No answer could be produced from the retrieved records."
    if not citations:
        answer += "\n\nNo independent citations were available for this response."

    response = {
        "answer": answer,
        "citations": citations,
        "uncertainty": _uncertainty(len(citations), inferred=inferred),
        "model_version": model_version,
        "prompt_version": guidance.PROMPT_VERSION,
        "response_profile": _response_profile(response_profile)[0],
        "reasoning_effort": reasoning_effort,
        "input_snapshot_id": snapshot_id,
        "persisted": False,
        "label": label,
        "disclaimer": DISCLAIMER,
        "scope": scope,
        "section": section.strip() or None,
        "query_id": None,
        "siteId": context.get("siteId") or None,
        "referenceMode": reference_mode,
        "evidenceStatus": "matched" if citations else "no-match",
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
  models = sorted(_allowed_models())
  default_model = _default_model()
  return {
      "engine": engine_name(),
      "models": models,
      "defaultModel": default_model,
      "defaultReasoningEffort": "medium",
      "reasoningEfforts": {model: list(_reasoning_efforts(model)) for model in models},
      "responseProfiles": ["fast", "balanced", "thorough"],
      "knowledge": knowledge.status(),
      "allowedScopes": sorted(ALLOWED_SCOPES),
      "restrictedScopes": sorted(RESTRICTED_SCOPES),
      "enabledRestrictedScopes": sorted(enabled_restricted_scopes()),
      "disclaimer": DISCLAIMER,
  }
