from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import northstar_client_release as client_release
import northstar_store as store


@pytest.fixture
def database(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "client-release.db")
    with store._session() as connection:
        connection.executescript(store.SCHEMA)
    return tmp_path


def test_client_release_event_is_deduplicated_and_system_classified(database, monkeypatch):
    release_file = database / "BUILD-VERSION.txt"
    release_file.write_text("v0.59\n2026-09-22\nAutomatic desktop client updates\n", encoding="utf-8")
    monkeypatch.setattr(client_release, "BUILD_VERSION_PATH", release_file)
    monkeypatch.setenv("NORTHSTAR_CLIENT_KIND", "desktop")
    monkeypatch.setenv("NORTHSTAR_CLIENT_PACKAGE_VERSION", "1.0.1")
    monkeypatch.setenv("NORTHSTAR_CLIENT_SOURCE_STAMP", "release-stamp")

    first = client_release.observe_current_release()
    second = client_release.observe_current_release()

    assert first["recorded"] is True
    assert second["recorded"] is False
    assert first["releaseId"] == second["releaseId"]
    row = store.list_audit_events(limit=1)[0]
    assert row["eventType"] == "system.client_update.applied"
    assert row["payload"]["client"]["packageVersion"] == "1.0.1"
    assert row["display"]["filterGroup"] == "system"


def test_client_release_rejects_invalid_metadata(database, monkeypatch):
    release_file = database / "BUILD-VERSION.txt"
    release_file.write_text("not-a-version\n2026-09-22\nRelease\n", encoding="utf-8")
    monkeypatch.setattr(client_release, "BUILD_VERSION_PATH", release_file)

    with pytest.raises(ValueError, match="invalid"):
        client_release.dashboard_release()
