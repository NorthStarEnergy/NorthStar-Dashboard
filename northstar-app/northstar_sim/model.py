from __future__ import annotations

import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any

SCHEMA = "northstar.switching-model.v1"
READINESS = {"catalog_only", "draft_synthetic", "draft_site_model", "accepted_for_training"}
TWO_TERMINAL = {"line", "breaker", "isolator", "earth_switch", "circuit_switcher", "transformer_2w"}
ONE_TERMINAL = {"grid_source", "bus", "generator", "load"}
MAX_MODEL_BYTES = 2 * 1024 * 1024


class ModelError(ValueError):
    def __init__(self, issues: list[dict[str, str]]):
        self.issues = issues
        super().__init__("; ".join(f"{item['path']}: {item['message']}" for item in issues))


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      allow_nan=False).encode("utf-8")


def content_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value)).hexdigest()


def load_model(source: dict[str, Any] | str | Path) -> tuple[dict[str, Any], str]:
    if isinstance(source, dict):
        model = source
        if len(canonical_json(model)) > MAX_MODEL_BYTES:
            raise ModelError([{"path": "$", "message": "model exceeds 2 MiB"}])
    else:
        raw = Path(source).read_bytes()
        if len(raw) > MAX_MODEL_BYTES:
            raise ModelError([{"path": "$", "message": "model exceeds 2 MiB"}])
        model = json.loads(raw.decode("utf-8"), parse_constant=lambda x: (_ for _ in ()).throw(ValueError(f"invalid number {x}")))
    issues: list[dict[str, str]] = []

    def issue(path: str, message: str) -> None:
        issues.append({"path": path, "message": message})

    if not isinstance(model, dict) or model.get("schemaVersion") != SCHEMA:
        raise ModelError([{"path": "schemaVersion", "message": f"expected {SCHEMA}"}])
    if model.get("readiness") not in READINESS:
        issue("readiness", "unknown model readiness")
    if not isinstance(model.get("modelId"), str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", model.get("modelId", "")):
        issue("modelId", "must be a stable identifier of at most 100 characters")
    revision = model.get("revision")
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        issue("revision", "must be a positive immutable revision number")
    if not isinstance(model.get("synthetic"), bool):
        issue("synthetic", "must be boolean")
    if model.get("synthetic") and model.get("siteId") is not None:
        issue("siteId", "synthetic model cannot claim a real station identity")
    nodes = model.get("nodes")
    equipment = model.get("equipment")
    if not isinstance(nodes, list) or len(nodes) > 500:
        issue("nodes", "must be an array of at most 500")
        nodes = []
    if not isinstance(equipment, list) or len(equipment) > 500:
        issue("equipment", "must be an array of at most 500")
        equipment = []
    node_ids: set[str] = set()
    for i, node in enumerate(nodes):
        path = f"nodes[{i}]"
        if not isinstance(node, dict) or not isinstance(node.get("nodeId"), str):
            issue(path, "nodeId is required")
            continue
        if node["nodeId"] in node_ids:
            issue(path + ".nodeId", "duplicate node ID")
        node_ids.add(node["nodeId"])
        voltage = node.get("nominalKVLL")
        if not isinstance(voltage, (int, float)) or not math.isfinite(voltage) or voltage < 0:
            issue(path + ".nominalKVLL", "must be a finite nonnegative kV value")
    eq_ids: set[str] = set()
    for i, item in enumerate(equipment):
        path = f"equipment[{i}]"
        if not isinstance(item, dict) or not isinstance(item.get("equipmentId"), str):
            issue(path, "equipmentId is required")
            continue
        eq_id = item["equipmentId"]
        if eq_id in eq_ids:
            issue(path + ".equipmentId", "duplicate equipment ID")
        eq_ids.add(eq_id)
        kind = item.get("type")
        terminals = item.get("terminals")
        if not isinstance(terminals, list):
            issue(path + ".terminals", "must be an array")
            terminals = []
        if kind in TWO_TERMINAL and len(terminals) != 2:
            issue(path + ".terminals", f"{kind} requires exactly two terminals")
        if kind in ONE_TERMINAL and len(terminals) != 1:
            issue(path + ".terminals", f"{kind} requires exactly one terminal")
        if kind not in TWO_TERMINAL | ONE_TERMINAL | {"turbine", "reservoir", "protection", "control_supply", "auxiliary", "spill_gate", "transfer_controller"}:
            issue(path + ".type", "unsupported equipment type")
        term_ids: set[str] = set()
        for j, terminal in enumerate(terminals):
            if not isinstance(terminal, dict):
                issue(f"{path}.terminals[{j}]", "must be an object")
                continue
            if not isinstance(terminal.get("id"), str) or not terminal.get("id"):
                issue(f"{path}.terminals[{j}].id", "terminal ID is required")
            if terminal.get("id") in term_ids:
                issue(f"{path}.terminals[{j}].id", "duplicate terminal ID")
            term_ids.add(terminal.get("id"))
            if terminal.get("nodeId") not in node_ids:
                issue(f"{path}.terminals[{j}].nodeId", "unknown node")
        params = item.get("parameters", {})
        if not isinstance(item.get("initialState", {}), dict):
            issue(path + ".initialState", "must be an object")
        initial_state = item.get("initialState", {})
        if isinstance(initial_state, dict) and initial_state.get("position") not in (None, "open", "closed", "opening", "closing", "failed"):
            issue(path + ".initialState.position", "unsupported mechanism state")
        if not isinstance(params, dict):
            issue(path + ".parameters", "must be an object")
            continue
        for key, value in params.items():
            if isinstance(value, float) and not math.isfinite(value):
                issue(f"{path}.parameters.{key}", "must be finite")
            if key.lower() in {"livetag", "livebinding", "feedpath", "sourceurl"}:
                issue(f"{path}.parameters.{key}", "live/feed bindings are forbidden in simulator models")
            if isinstance(value, str) and value.lower().startswith(("http:", "https:", "file:", "live:")):
                issue(f"{path}.parameters.{key}", "remote and filesystem references are forbidden")
        for key in ("resistanceOhmPerPhase", "reactanceOhmPerPhase"):
            if key in params and (not isinstance(params[key], (int, float)) or not math.isfinite(params[key]) or params[key] < 0):
                issue(f"{path}.parameters.{key}", "must be a finite nonnegative value")
    source_refs = model.get("sourceRefs", [])
    source_ids = {item.get("sourceId") for item in source_refs if isinstance(item, dict)} if isinstance(source_refs, list) else set()
    for i, item in enumerate(equipment):
        if not isinstance(item, dict):
            continue
        for ref_field in ("generatorRef", "reservoirRef", "turbineRef", "controlSupplyRef", "monitoredEquipmentId", "tripEquipmentId"):
            target = item.get("parameters", {}).get(ref_field)
            if target is not None and target not in eq_ids:
                issue(f"equipment[{i}].parameters.{ref_field}", f"unknown equipment reference: {target}")
        refs = item.get("sourceRefs", [])
        if not isinstance(refs, list) or not refs or any(ref not in source_ids for ref in refs):
            issue(f"equipment[{i}].sourceRefs", "must be nonempty and reference declared model source IDs")
    tags = model.get("tags", [])
    if not isinstance(tags, list) or len(tags) > 2000:
        issue("tags", "must be an array of at most 2000 tags")
        tags = []
    tag_ids: set[str] = set()
    units = {"", "A", "V", "kV", "MW", "Mvar", "MVA", "Hz", "rpm", "deg", "degC", "kPa", "m", "m3", "m3/s", "MWh", "%", "s"}
    for i, tag in enumerate(tags):
        path = f"tags[{i}]"
        if not isinstance(tag, dict):
            issue(path, "must be an object")
            continue
        tag_id = tag.get("tagId")
        if not isinstance(tag_id, str) or not re.fullmatch(r"sim\.[A-Za-z0-9_.-]{1,160}", tag_id):
            issue(path + ".tagId", "must be a simulator-scoped sim.* identifier")
        elif tag_id in tag_ids:
            issue(path + ".tagId", "duplicate tag ID")
        tag_ids.add(tag_id if isinstance(tag_id, str) else "")
        eq_id = tag.get("equipmentId")
        if eq_id not in eq_ids:
            issue(path + ".equipmentId", "unknown equipment ID")
        if tag.get("kind") not in {"analog", "discrete", "counter", "enum"}:
            issue(path + ".kind", "unsupported tag kind")
        if tag.get("unit") not in units:
            issue(path + ".unit", "unit is not in the simulator allowlist")
        source = tag.get("source")
        equipment_match = re.fullmatch(r"equipment\.([A-Za-z0-9_.-]+)\.([A-Za-z][A-Za-z0-9_]*)", str(source or ""))
        node_match = re.fullmatch(r"node\.([A-Za-z0-9_.-]+)\.voltageKVLL", str(source or ""))
        unit_match = re.fullmatch(r"unit\.([A-Za-z0-9_-]+)\.([A-Za-z][A-Za-z0-9_]*)", str(source or ""))
        if not ((equipment_match and equipment_match.group(1) == eq_id) or
                (node_match and node_match.group(1) in node_ids) or
                (unit_match and unit_match.group(1) == eq_id and unit_match.group(2) in {
                    "sequenceState", "speedRpm", "frequencyHz", "voltageKVLL", "fieldCurrentA",
                    "hpuPressureKPa", "bearingTemperatureC", "phaseDegrees", "activeMW", "requestedMW", "requestedMvar",
                    "currentA", "powerFactor", "energyMWh", "tailwaterM", "netHeadM", "gateFraction", "mechanicalPowerMW", "flowM3S"})):
            issue(path + ".source", "must be a typed path to its equipment; live bindings are not accepted")
        for field in ("scanMs", "staleAfterMs"):
            value = tag.get(field)
            if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
                issue(path + "." + field, "must be a positive integer in simulated milliseconds")
        if isinstance(tag.get("scanMs"), int) and isinstance(tag.get("staleAfterMs"), int) and tag["staleAfterMs"] < tag["scanMs"]:
            issue(path + ".staleAfterMs", "must be at least one scan period")
    if model.get("readiness") == "accepted_for_training" and not model.get("acceptance"):
        issue("acceptance", "accepted model requires reviewer, date and evidence hashes")
    if issues:
        raise ModelError(issues)
    return model, content_hash(model)


def catalog_only_models(catalog_path: str | Path) -> list[dict[str, Any]]:
    catalog = json.loads(Path(catalog_path).read_text(encoding="utf-8"))
    return [{"siteId": station["siteId"], "name": station["name"], "readiness": "catalog_only",
             "modelId": None, "canLaunch": False, "reason": "No reviewed station model or operating data is available."}
            for station in catalog["stations"]]
