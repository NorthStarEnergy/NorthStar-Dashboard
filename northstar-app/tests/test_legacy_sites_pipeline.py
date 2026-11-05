from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def test_retired_static_pipeline_cannot_reintroduce_client_side_login() -> None:
    auth = (ROOT / "auth.js").read_text(encoding="utf-8")
    build = (ROOT / "build.mjs").read_text(encoding="utf-8")
    server = (ROOT / "server" / "index.js").read_text(encoding="utf-8")

    assert "operator/operator" not in auth
    assert "loginForm" not in auth
    assert "northstarAuth" not in auth
    assert "ops.northstarenergy.ca" in auth
    assert "legacy static Sites pipeline is retired" in build
    assert "auth.js" not in server
    assert "oai-authenticated-user-email" not in server
    assert "ops.northstarenergy.ca" in server
