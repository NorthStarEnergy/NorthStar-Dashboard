"""Disabled-by-default Microsoft message ingestion contract.

No credentials, Graph requests, subscription creation or message sending live here.
A future authenticated collector supplies one allowlisted source and provider record.
The caller owns the SQLite transaction, as with the other audit writers.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
from html.parser import HTMLParser
import json
from urllib.parse import urlparse

import northstar_events as events


@dataclass(frozen=True)
class MicrosoftSource:
    provider: str  # outlook or teams
    resource: str  # exact mailbox/folder or team/channel/chat Graph resource
    label: str
    enabled: bool = False

    def __post_init__(self):
        if self.provider not in {"outlook", "teams"}:
            raise ValueError("Unsupported Microsoft provider")
        if not self.resource.strip() or not self.label.strip():
            raise ValueError("A source resource and label are required")

    def status(self):
        # Configuration alone is never evidence of a working connection.
        return {"provider": self.provider, "label": self.label,
                "state": "awaiting_connection" if self.enabled else "not_configured",
                "connected": False, "lastSuccessfulSync": None}


class _Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.suppressed = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.suppressed += 1
        if tag in {"p", "div", "br", "li"}:
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in {"script", "style"} and self.suppressed:
            self.suppressed -= 1
        if tag in {"p", "div", "li"}:
            self.parts.append(" ")

    def handle_data(self, data):
        if not self.suppressed:
            self.parts.append(data)


def _plain(value, html=False, limit=500):
    text = str(value or "")
    if html:
        parser = _Text()
        parser.feed(text)
        text = "".join(parser.parts)
    return " ".join(text.split())[:limit]


def _timestamp(value):
    stamp = str(value or "")
    parsed = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Microsoft event timestamp must include its timezone")
    return parsed.isoformat()


def _link(value):
    value = str(value or "")
    parsed = urlparse(value)
    return value if (parsed.scheme == "https" and not parsed.username and
        parsed.hostname in {"outlook.office.com", "outlook.office365.com",
                            "teams.microsoft.com", "teams.cloud.microsoft"}) else ""


def normalize_message(source, message, *, change="created", occurred_at=None):
    """Map a Graph message/chatMessage to the existing event envelope, without I/O.

    Deletion notifications must supply their original occurrence timestamp.
    Attachments and full email bodies are deliberately not copied into the ledger.
    """
    if change not in {"created", "updated", "deleted"}:
        raise ValueError("Unsupported message change")
    message_id = str(message.get("id") or "").strip()
    if not message_id or len(message_id) > 2048:
        raise ValueError("A stable provider message ID is required")
    if change == "deleted" and occurred_at is None:
        raise ValueError("Deletion requires its source occurrence timestamp")
    stamp = occurred_at or (message.get("lastModifiedDateTime") if change == "updated" else
        message.get("receivedDateTime") or message.get("createdDateTime") or message.get("sentDateTime"))
    stamp = _timestamp(stamp)
    if source.provider == "outlook":
        sender = (message.get("from") or {}).get("emailAddress") or {}
        actor = sender.get("address") or sender.get("name") or "unknown"
        preview = _plain(message.get("bodyPreview"))
        subject = _plain(message.get("subject"), limit=200) or "Email"
        thread = message.get("conversationId") or message_id
    else:
        sender = (message.get("from") or {}).get("user") or (message.get("from") or {}).get("application") or {}
        actor = sender.get("displayName") or sender.get("id") or "unknown"
        body = message.get("body") or {}
        preview = _plain(body.get("content"), html=body.get("contentType") == "html")
        subject = _plain(message.get("subject"), limit=200) or "Teams message"
        thread = message.get("replyToId") or message_id
    if change == "deleted":
        preview = "Message deleted at source"
    # Source and revision participate in identity: retries collapse, edits remain distinct.
    identity = json.dumps([source.provider, source.resource, message_id, change, stamp], separators=(",", ":"))
    event_id = "ms_" + sha256(identity.encode()).hexdigest()
    aggregate_id = sha256(json.dumps([source.provider, source.resource, message_id]).encode()).hexdigest()
    correlation = "ms_thread_" + sha256(json.dumps([source.provider, source.resource, thread]).encode()).hexdigest()
    return dict(event_id=event_id, event_type=f"communications.{source.provider}.message.{change}",
                occurred_at=stamp, actor_id=_plain(actor, limit=200), aggregate_type="communication",
                aggregate_id=aggregate_id, source=source.provider, severity="info",
                correlation_id=correlation, summary=f"{source.provider.title()} · {subject} · {change}",
                payload={"details": preview, "sourceLabel": source.label, "sourceResource": source.resource,
                         "sourceMessageId": message_id, "threadId": thread, "change": change,
                         "originalUrl": _link(message.get("webLink") or message.get("webUrl")),
                         "hasAttachments": bool(message.get("hasAttachments") or message.get("attachments"))})


def ingest_message(connection, source, message, *, resource, change="created", occurred_at=None):
    """Append exactly once within the caller's transaction; refuse disabled/mismatched sources."""
    if not source.enabled:
        raise PermissionError("Microsoft source is not enabled")
    if resource != source.resource:
        raise PermissionError("Message is outside the configured source")
    envelope = normalize_message(source, message, change=change, occurred_at=occurred_at)
    if connection.execute("SELECT 1 FROM audit_events WHERE event_id=?", (envelope["event_id"],)).fetchone():
        return {"eventId": envelope["event_id"], "inserted": False}
    events.append_event(connection, **envelope)
    return {"eventId": envelope["event_id"], "inserted": True}
