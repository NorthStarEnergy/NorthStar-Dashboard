from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_dashboard_loads_symbol_library_before_editor() -> None:
    html = (ROOT / "northstar-clean.html").read_text(encoding="utf-8")

    library = 'src="one-line-symbol-library.js?v=20260826-2"'
    editor = 'src="one-line-editor-ui.js?v=20260826-3"'
    assert library in html
    assert editor in html
    assert html.index(library) < html.index(editor)
    assert 'id="oneLineSymbolLibrary"' in html
    assert 'id="oneLineSymbolSearch"' in html


def test_profile_distinguishes_graphics_convention_from_active_designations() -> None:
    script = (ROOT / "one-line-symbol-library.js").read_text(encoding="utf-8")

    assert "IEEE/ANSI 315-1975 (inactive-reserved)" in script
    assert "IEEE C37.2-2022 (active)" in script
    assert "northstar-ieee-compat-2026.1" in script


def test_library_covers_core_one_line_equipment_and_protection() -> None:
    script = (ROOT / "one-line-symbol-library.js").read_text(encoding="utf-8")

    expected = {
        "source", "bus", "line", "junction", "terminal", "ground",
        "disconnect", "breaker", "fuse", "transformer", "generator", "motor",
        "capacitor", "reactor", "battery", "surge-arrester", "load", "ct", "vt",
        "relay", "lockout",
    }
    for symbol_type in expected:
        assert f"id:'{symbol_type}'" in script

    assert "functionNumber:'52'" in script
    assert "functionNumber:'86'" in script
    assert "functionNumber:'89'" in script
    assert "['87','Differential protection']" in script


def test_version_two_exports_retain_legacy_drafts_and_standard_metadata() -> None:
    editor = (ROOT / "one-line-editor-ui.js").read_text(encoding="utf-8")

    assert "northstar.oneLineEditor.draft.v1" in editor
    assert "version:2" in editor
    assert "symbolLibraryProfile:library.profile" in editor
    assert "graphicalStandard:library.graphicalStandard" in editor
    assert "designationStandard:library.designationStandard" in editor
    assert "payload.symbols.map(normaliseSymbol)" in editor


def test_imported_labels_and_designations_are_bounded_and_escaped() -> None:
    editor = (ROOT / "one-line-editor-ui.js").read_text(encoding="utf-8")

    assert "cleanText(item?.label)" in editor
    assert "cleanText(item?.deviceFunction" in editor
    assert ("${esc(symbol.label || symbol.id)}" in editor or
            ("const label = esc(symbol.label || symbol.id);" in editor and "${label}</text>" in editor))
    assert "${esc(symbol.deviceFunction)}" in editor


def test_status_updates_preserve_the_symbol_count_target() -> None:
    editor = (ROOT / "one-line-editor-ui.js").read_text(encoding="utf-8")

    assert 'strong id="oneLineCount"' in editor
    assert "if (count) count.textContent" in editor


def test_server_revisions_and_operator_exports_are_wired() -> None:
    html = (ROOT / "northstar-clean.html").read_text(encoding="utf-8")
    editor = (ROOT / "one-line-editor-ui.js").read_text(encoding="utf-8")

    for control in ("oneLineSaveServer", "oneLineServerSelect", "oneLineAttachPackage", "oneLineExportSvg", "oneLineExportPng", "oneLinePrint"):
        assert f'id="{control}"' in html
    assert "'/api/schematics'" in editor
    assert "saveServer" in editor
    assert "standaloneSvg" in editor
    assert "NorthStarSwitching.attachSchematic" in editor
