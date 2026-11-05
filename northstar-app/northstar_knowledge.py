"""Compatibility API for controlled operator retrieval; no filesystem/table crawling."""
import re
from typing import Any

SYNONYMS = {
    "alarm": {"event", "incident", "alert"},
    "incident": {"event", "alarm", "alert", "logbook"},
    "outage": {"derating", "curtailment", "availability", "forced"},
    "procedure": {"manual", "sop", "instruction", "process"},
    "protection": {"relay", "prc", "reliability"},
    "relay": {"protection", "prc", "reliability"},
    "reliability": {"nerc", "standard", "protection", "grid"},
    "shift": {"handoff", "logbook", "operator"},
    "standard": {"standards", "nerc", "ieee", "ieso", "requirement"},
    "standards": {"standard", "nerc", "ieee", "ieso", "requirement"},
}
STOP_WORDS = {
    "about", "after", "again", "also", "been", "could", "does", "find", "from", "have",
    "into", "need", "should", "that", "their", "there", "these", "they", "this", "what",
    "when", "which", "with", "would", "your",
}


def _tokens(value: str) -> set[str]:
    return {item.lower() for item in re.findall(r"[A-Za-z0-9]{3,}", value) if item.lower() not in STOP_WORDS}


def search(question: str, limit: int = 12, **options) -> list[dict[str, Any]]:
    import northstar_operator_knowledge as registry
    return registry.search(question, limit, **options)


def status(actor: str = "operator") -> dict[str, Any]:
    import northstar_operator_knowledge as registry
    return registry.status(actor)


def rebuild() -> int:
    import northstar_operator_knowledge as registry
    return registry.bootstrap()["totalRecords"]
