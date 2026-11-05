import northstar_ieso_advisories as advisories


def test_advisory_feeds_deduplicate_and_mark_site_and_system_notices():
    item = lambda guid, title, description: (
        f"<item><guid>{guid}</guid><title>{title}</title><description>{description}</description>"
        "<link>https://www.ieso.ca/notice</link><pubDate>Sun, 04 Oct 2026 12:00:00 GMT</pubDate></item>"
    )
    def rss(*items):
        return ("<rss version='2.0'><channel>" + "".join(items) + "</channel></rss>").encode()
    payloads = {
        "Critical": rss(item("a", "Warning for Iroquois Falls", "Review APIROQ conditions")),
        "Day0": rss(item("a", "Warning for Iroquois Falls", "Review APIROQ conditions"), item("b", "Ontario reserve notice", "Operating reserve change")),
        "Day1To34": rss(),
        "Archive": rss(item("c", "Routine update", "No site named")),
    }
    for url in advisories.FEEDS.values():
        payloads.setdefault(url.rsplit("/", 1)[-1], rss())
    store = advisories.AdvisoryStore()
    store.refresh(lambda url: payloads[url.rsplit("/", 1)[-1]])
    snapshot = store.get()
    assert len(snapshot["notices"]) == 3
    assert {row["id"]: row["relevance"] for row in snapshot["notices"]} == {"a": "site", "b": "system", "c": "general"}
    assert snapshot["stale"] is False


def test_advisory_failure_retains_last_successful_snapshot():
    store = advisories.AdvisoryStore()
    store.refresh(lambda url: b"<rss><channel><item><guid>a</guid><title>Notice</title></item></channel></rss>")
    store.refresh(lambda url: (_ for _ in ()).throw(OSError("offline")))
    snapshot = store.get()
    assert snapshot["stale"] is True
    assert len(snapshot["notices"]) == 1
    assert len(snapshot["errors"]) == len(advisories.FEEDS)
