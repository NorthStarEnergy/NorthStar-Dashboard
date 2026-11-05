"""Synthetic evidence for workflow-only tests; never imports or approves live sources."""
import json

QUOTE = "1.001 Synthetic fixture evidence for document review only."


def bundle(*args):
    return {"missing": [], "sources": [], "inventory": [], "passages": [{
        "id": "oks_fixture:1", "sourceId": "oks_fixture", "title": "Synthetic fixture",
        "revision": "TEST", "role": "code", "page": 1, "section": "Fixture",
        "clauseMentions": ["1.001"], "excerpt": QUOTE, "href": "knowledge-library.html?source=oks_fixture"}]}


def generate(*args):
    return json.dumps({"draft": "DRAFT — SYNTHETIC TEST ONLY [oks_fixture:1]",
                       "findings": [{"claim": "Synthetic evidence requires review.", "status": "NEEDS_REVIEW",
                                     "citationId": "oks_fixture:1", "clause": "1.001", "quote": QUOTE}]}), "fixture"
