from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_dashboard_loads_the_recovered_editor_assets_after_existing_behavior() -> None:
    html = (ROOT / "northstar-clean.html").read_text(encoding="utf-8")

    assert 'href="logbook-editor.css?v=20260826-1"' in html
    assert 'src="logbook-editor.js?v=20260826-1"' in html
    assert html.index('id="logbook-email-behavior"') < html.index('src="logbook-editor.js')
    assert 'id="logDetails"' in html


def test_editor_uses_modern_sanitised_rich_text_not_exec_command() -> None:
    script = (ROOT / "logbook-editor.js").read_text(encoding="utf-8")

    assert "editor.contentEditable = 'true'" in script
    assert "[[NORTHSTAR_RICH_TEXT_V1]]" in script
    assert "const MAX_DETAILS = 4000" in script
    assert "'SCRIPT' || node.tagName === 'STYLE'" in script
    assert "event.clipboardData?.getData('text/plain')" in script
    assert "sanitiseHtml(editor.innerHTML)" in script
    assert "execCommand" not in script


def test_editor_preserves_current_logbook_api_and_tamper_evident_store_path() -> None:
    script = (ROOT / "logbook-editor.js").read_text(encoding="utf-8")
    store = (ROOT / "northstar_store.py").read_text(encoding="utf-8")

    assert "fetch('/api/logbook'" in script
    assert "detailsMarkup(details)" in script
    assert "add_logbook_entry" in store
    assert "entry_hash" in store


def test_rich_editor_assets_exist_and_are_not_embedded_data_url_uploaders() -> None:
    script = (ROOT / "logbook-editor.js").read_text(encoding="utf-8")
    styles = (ROOT / "logbook-editor.css").read_text(encoding="utf-8")

    assert ".logbook-rich-editor" in styles
    assert ".event-rich-details" in styles
    assert "FileReader" not in script
    assert "data:image" not in script
