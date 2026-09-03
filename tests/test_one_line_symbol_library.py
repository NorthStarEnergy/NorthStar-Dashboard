import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _catalogue() -> dict:
    return json.loads((ROOT / "one-line-symbol-catalogue.json").read_text(encoding="utf-8"))


def _eval_library() -> dict:
    result = subprocess.run(
        ["node", str(ROOT / "tests" / "eval_one_line_library.cjs")],
        check=True,
        capture_output=True,
        text=True,
        cwd=str(ROOT),
    )
    return json.loads(result.stdout)


def test_dashboard_loads_symbol_library_before_editor() -> None:
    html = (ROOT / "northstar-clean.html").read_text(encoding="utf-8")

    library = 'src="one-line-symbol-library.js?v=20260903-1"'
    editor = 'src="one-line-editor-ui.js?v=20260903-2"'
    assert library in html
    assert editor in html
    assert html.index(library) < html.index(editor)
    assert 'id="oneLineSymbolLibrary"' in html
    assert 'id="oneLineSymbolSearch"' in html
    assert "Catalogue 2026.2" in html
    assert 'href="one-line-editor.css?v=20260903-2"' in html
    assert ".one-line-empty[hidden]{display:none!important}" in (ROOT / "one-line-editor.css").read_text(encoding="utf-8")


def test_profile_distinguishes_graphics_convention_from_active_designations() -> None:
    script = (ROOT / "one-line-symbol-library.js").read_text(encoding="utf-8")
    catalogue = _catalogue()

    assert catalogue["profile"] == "northstar-ieee-compat-2026.2"
    assert catalogue["catalogueVersion"] == "2026.2"
    assert "IEEE/ANSI 315-1975 (inactive-reserved)" in script
    assert "IEEE C37.2-2022 (active)" in script
    assert catalogue["profile"] in script
    assert f"catalogueVersion: '{catalogue['catalogueVersion']}'" in script


def test_library_covers_core_one_line_equipment_and_protection() -> None:
    expected = {
        "source", "bus", "line", "junction", "terminal", "ground",
        "disconnect", "breaker", "fuse", "load-break", "recloser",
        "sectionalizer", "grounding-switch", "ats", "transformer",
        "transformer-3winding", "autotransformer", "generator", "motor",
        "capacitor", "reactor", "battery", "surge-arrester", "load",
        "ct", "vt", "pt", "relay", "lockout",
    }
    catalogue_ids = {item["id"] for item in _catalogue()["symbols"] if not item.get("hidden")}
    assert expected == catalogue_ids

    script = (ROOT / "one-line-symbol-library.js").read_text(encoding="utf-8")
    for symbol_type in expected:
        assert f"id:'{symbol_type}'" in script

    assert "functionNumber:'52'" in script
    assert "functionNumber:'86'" in script
    assert "functionNumber:'89'" in script
    assert "['87','Differential protection']" in script
    assert "['79','Reclosing']" in script


def test_catalogue_matches_javascript_and_server_constants() -> None:
    import northstar_store as store

    catalogue = _catalogue()
    runtime = _eval_library()
    catalogue_ids = {item["id"] for item in catalogue["symbols"]}
    switching = {item["id"] for item in catalogue["symbols"] if item.get("switching")}
    winding = {item["id"] for item in catalogue["symbols"] if item.get("winding")}

    assert runtime["profile"] == catalogue["profile"] == store.ONE_LINE_SYMBOL_PROFILE
    assert runtime["catalogueVersion"] == catalogue["catalogueVersion"] == store.ONE_LINE_CATALOGUE_VERSION
    assert runtime["graphicalStandard"] == catalogue["graphicalStandard"] == store.ONE_LINE_GRAPHICAL_STANDARD
    assert runtime["designationStandard"] == catalogue["designationStandard"] == store.ONE_LINE_DESIGNATION_STANDARD
    assert set(runtime["ids"]) == catalogue_ids == store.ONE_LINE_SYMBOL_TYPES
    assert set(runtime["switching"]) == switching == store.ONE_LINE_SWITCHING_TYPES
    assert set(runtime["winding"]) == winding == store.ONE_LINE_WINDING_TYPES
    assert "edge" in catalogue_ids
    assert runtime["getUnknown"] is None
    assert runtime["getBreaker"] == "breaker"


def test_library_runtime_snaps_terminals_and_refuses_unknown_types() -> None:
    runtime = _eval_library()

    assert runtime["closedHasSlash"] is True
    assert runtime["openedHasSlash"] is False
    assert runtime["openedDashed"] is True
    assert runtime["unknownIsNotSource"] is True
    assert runtime["sourceHasSine"] is True
    assert runtime["busSnap"]["id"] == "span"
    assert runtime["busSnap"]["x"] == 220
    assert runtime["busSnap"]["y"] == 200
    assert runtime["breakerLeft"]["id"] == "L"
    assert runtime["breakerLeft"]["x"] == 262
    assert runtime["breakerLeft"]["y"] == 200
    assert runtime["rotated"]["id"] == "L"
    assert runtime["rotated"]["x"] == 300
    assert runtime["rotated"]["y"] == 162


def test_version_three_exports_retain_legacy_drafts_and_standard_metadata() -> None:
    editor = (ROOT / "one-line-editor-ui.js").read_text(encoding="utf-8")

    assert "northstar.oneLineEditor.draft.v1" in editor
    assert "version:3" in editor
    assert "catalogueVersion:library.catalogueVersion" in editor
    assert "symbolLibraryProfile:library.profile" in editor
    assert "graphicalStandard:library.graphicalStandard" in editor
    assert "designationStandard:library.designationStandard" in editor
    assert "payload.symbols.map(normaliseSymbol).filter(Boolean)" in editor
    assert "library.snapPoint" in editor
    assert "operatingState" in editor
    assert "windingConfig" in editor
    assert "fromTerminal" in editor


def test_imported_labels_and_designations_are_bounded_and_escaped() -> None:
    editor = (ROOT / "one-line-editor-ui.js").read_text(encoding="utf-8")

    assert "cleanText(item?.label)" in editor
    assert "cleanText(item?.deviceFunction" in editor
    assert "${esc(symbol.label || symbol.id)}" in editor
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


def test_store_stamps_catalogue_identity_and_drops_unknown_types() -> None:
    import northstar_store as store

    record = store._normalise_one_line_record({
        "symbols": [
            {"id": "BUS-01", "type": "bus", "x": 200, "y": 200},
            {"id": "CBR-01", "type": "breaker", "x": 400, "y": 200, "operatingState": "open"},
            {"id": "XF3-01", "type": "transformer-3winding", "x": 600, "y": 200, "windingConfig": "dy"},
            {"id": "EDG-01", "type": "edge", "x": 100, "y": 100},
            {"id": "BAD-01", "type": "source", "x": 10, "y": 10},
            {"id": "DROP-01", "type": "not-a-real-type", "x": 50, "y": 50},
        ],
        "edges": [
            {"from": "BUS-01", "to": "CBR-01", "fromTerminal": "span", "toTerminal": "L"},
            {"from": "BUS-01", "to": "DROP-01"},
        ],
    })
    types = {item["id"]: item for item in record["symbols"]}
    assert record["symbolLibraryProfile"] == "northstar-ieee-compat-2026.2"
    assert record["catalogueVersion"] == "2026.2"
    assert record["version"] == 3
    assert "DROP-01" not in types
    assert types["CBR-01"]["operatingState"] == "open"
    assert types["XF3-01"]["windingConfig"] == "dy"
    assert types["BUS-01"]["operatingState"] == ""
    assert types["EDG-01"]["type"] == "edge"
    assert record["edges"] == [
        {"id": "E-001", "from": "BUS-01", "to": "CBR-01", "fromTerminal": "span", "toTerminal": "L"}
    ]
