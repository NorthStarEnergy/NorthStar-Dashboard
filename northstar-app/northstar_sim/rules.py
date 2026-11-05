"""Bounded, typed expression engine for synthetic simulator rules.

Rule input is JSON data only; this module never evaluates Python/JavaScript text,
opens files, or performs network/subprocess operations.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any, Callable

RULE_SCHEMA = "northstar.switching-rules.v1"
MAX_DEPTH = 16
MAX_NODES = 256

UNITS: dict[str, str] = {
    "": "dimensionless", "%": "dimensionless", "s": "time", "ms": "time",
    "V": "voltage", "kV": "voltage", "A": "current", "MW": "power",
    "Mvar": "reactive_power", "MVA": "apparent_power", "Hz": "frequency",
    "deg": "angle", "rpm": "speed", "m": "length", "m3": "volume", "m3/s": "flow",
}
BOOL_FIELDS = {"enabled", "available", "remote", "lockout", "latched", "mechanismHealthy"}
STRING_FIELDS = {"position", "mode", "sequenceState", "controlMode"}
FIELD_UNITS = {
    "activeMW": "MW", "requestedMW": "MW", "reactiveMvar": "Mvar", "voltageKVLL": "kV",
    "currentA": "A", "frequencyHz": "Hz", "phaseDegrees": "deg", "speedRpm": "rpm",
    "gateFraction": "%", "flowM3S": "m3/s", "headwaterM": "m", "tailwaterM": "m",
    "hydraulicPowerMW": "MW", "storageM3": "m3", "voltageV": "V",
}
UNIT_FIELDS = {
    "sequenceState": ("string", None), "syncCheckPassed": ("bool", None), "brakesApplied": ("bool", None),
    "hpuPressureKPa": ("number", "kPa"), "speedRpm": ("number", "rpm"),
    "voltageKVLL": ("number", "kV"), "frequencyHz": ("number", "Hz"),
    "phaseDegrees": ("number", "deg"), "requestedMW": ("number", "MW"),
    "activeMW": ("number", "MW"), "requestedMvar": ("number", "Mvar"),
    "bearingTemperatureC": ("number", "degC"), "fieldCurrentA": ("number", "A"),
    "currentA": ("number", "A"), "powerFactor": ("number", ""), "energyMWh": ("number", "MWh"),
    "tailwaterM": ("number", "m"), "netHeadM": ("number", "m"), "gateFraction": ("number", "%"),
    "mechanicalPowerMW": ("number", "MW"), "flowM3S": ("number", "m3/s"),
}
UNITS.update({"kPa": "pressure", "degC": "temperature", "MWh": "energy"})
OPS = {"all", "any", "not", "eq", "ne", "lt", "lte", "gt", "gte", "add", "sub", "mul", "div", "abs", "qualityGood"}
COMPARISONS = {"eq", "ne", "lt", "lte", "gt", "gte"}


class RuleValidationError(ValueError):
    def __init__(self, issues: list[dict[str, str]]):
        self.issues = issues
        super().__init__("; ".join(f"{i['path']}: {i['message']}" for i in issues))


@dataclass(frozen=True)
class TypedValue:
    value: Any
    unit: str | None = None
    quality: str = "good"
    reason: str | None = None


def _reference(ref: str, domain: str, model: dict[str, Any]) -> tuple[str, str | None]:
    if domain not in {"truth", "control_input", "observation"}:
        raise ValueError("unknown input domain")
    parts = ref.split(".")
    equipment = {d["equipmentId"]: d for d in model.get("equipment", [])}
    tags = {t["tagId"]: t for t in model.get("tags", [])}
    if parts[0] == "equipment" and len(parts) == 3 and parts[1] in equipment:
        field = parts[2]
        if field in BOOL_FIELDS:
            return "bool", None
        if field in STRING_FIELDS:
            return "string", None
        if field in FIELD_UNITS:
            return "number", FIELD_UNITS[field]
        # Equipment capability/model fields are finite scalar constants; they
        # may be referenced as numbers only when a declared unit is known.
        if field in {"ratedMW", "ratedCurrentA", "pickupA", "dropoutA", "openDelayMs", "closeDelayMs", "commandTimeoutMs", "pickupMs"}:
            units = {"ratedMW": "MW", "ratedCurrentA": "A", "pickupA": "A", "dropoutA": "A",
                     "openDelayMs": "ms", "closeDelayMs": "ms", "commandTimeoutMs": "ms", "pickupMs": "ms"}
            return "number", units[field]
        raise ValueError(f"unknown or untyped equipment field {field}")
    if parts[0] == "unit" and len(parts) == 3 and parts[1] in equipment and equipment[parts[1]]["type"] == "generator":
        result = UNIT_FIELDS.get(parts[2])
        if result is None:
            raise ValueError(f"unknown or untyped unit field {parts[2]}")
        return result
    if parts[0] == "tags" and domain == "observation":
        tag_id = ".".join(parts[1:])
        tag = tags.get(tag_id)
        if tag is None:
            raise ValueError(f"unknown tag {tag_id}")
        if tag["kind"] == "analog" or tag["kind"] == "counter":
            return "number", tag["unit"]
        if tag["kind"] == "discrete":
            return "string", tag["unit"] or None
        return "string", tag["unit"] or None
    raise ValueError("reference path is outside its declared domain")


def _type_expr(expr: Any, model: dict[str, Any], path: str, depth: int, budget: list[int]) -> tuple[str, str | None]:
    budget[0] += 1
    if depth > MAX_DEPTH or budget[0] > MAX_NODES:
        raise ValueError("expression depth or node limit exceeded")
    valid_node = (isinstance(expr, dict) and (
        set(expr) in ({"const"}, {"const", "unit"}, {"ref", "domain"})
        or ("op" in expr and set(expr) <= {"op", "args"})
    ))
    if not valid_node:
        raise ValueError("expression node must be a single typed object")
    if "const" in expr:
        value, unit = expr["const"], expr.get("unit")
        if unit is not None and unit not in UNITS:
            raise ValueError(f"unknown unit {unit}")
        if isinstance(value, bool):
            if unit is not None:
                raise ValueError("boolean constant cannot have a unit")
            return "bool", None
        if isinstance(value, (int, float)):
            if not math.isfinite(value):
                raise ValueError("constant must be finite")
            return "number", unit or ""
        if isinstance(value, str):
            if unit is not None:
                raise ValueError("string constant cannot have a unit")
            return "string", None
        raise ValueError("unsupported constant type")
    if "ref" in expr:
        if set(expr) != {"ref", "domain"} or not isinstance(expr["ref"], str):
            raise ValueError("reference requires ref and domain")
        return _reference(expr["ref"], expr["domain"], model)
    if "op" not in expr or expr["op"] not in OPS:
        raise ValueError("unsupported operator")
    op, args = expr["op"], expr.get("args")
    if not isinstance(args, list):
        raise ValueError("operator args must be an array")
    typed = [_type_expr(arg, model, f"{path}.args[{i}]", depth + 1, budget) for i, arg in enumerate(args)]
    if op in {"all", "any"}:
        if len(typed) < 1 or any(t != ("bool", None) for t in typed):
            raise ValueError(f"{op} requires one or more boolean arguments")
        return "bool", None
    if op == "not":
        if len(typed) != 1 or typed[0] != ("bool", None):
            raise ValueError("not requires one boolean argument")
        return "bool", None
    if op == "qualityGood":
        if len(typed) != 1 or "ref" not in args[0]:
            raise ValueError("qualityGood requires one observation reference")
        if args[0].get("domain") != "observation":
            raise ValueError("qualityGood is restricted to observations")
        return "bool", None
    if op == "abs":
        if len(typed) != 1 or typed[0][0] != "number":
            raise ValueError("abs requires one numeric argument")
        return typed[0]
    if op in {"add", "sub", "mul", "div"}:
        if len(typed) != 2 or any(t[0] != "number" for t in typed):
            raise ValueError(f"{op} requires two numeric arguments")
        left, right = typed
        if op in {"add", "sub"} and left[1] != right[1]:
            raise ValueError(f"{op} requires matching units")
        if op == "mul":
            unit = left[1] if right[1] == "" else right[1] if left[1] == "" else f"{left[1]}*{right[1]}"
        elif op == "div":
            unit = "" if left[1] == right[1] else left[1] if right[1] == "" else f"{left[1]}/{right[1]}"
        else:
            unit = left[1]
        return "number", unit
    if op in COMPARISONS:
        if len(typed) != 2 or typed[0][0] != typed[1][0]:
            raise ValueError(f"{op} requires two values of the same type")
        if typed[0][0] == "number" and typed[0][1] != typed[1][1]:
            raise ValueError(f"{op} requires matching units")
        if op not in {"eq", "ne"} and typed[0][0] != "number":
            raise ValueError(f"{op} only compares numeric values")
        return "bool", None
    raise ValueError(f"operator {op} is not implemented")


class RuleSet:
    def __init__(self, model: dict[str, Any], data: dict[str, Any]):
        issues: list[dict[str, str]] = []
        if not isinstance(data, dict) or data.get("schemaVersion") != RULE_SCHEMA:
            raise RuleValidationError([{"path": "schemaVersion", "message": f"expected {RULE_SCHEMA}"}])
        rules = data.get("rules")
        if not isinstance(rules, list) or len(rules) > 256:
            raise RuleValidationError([{"path": "rules", "message": "must contain at most 256 rules"}])
        ids: set[str] = set()
        self.rules: list[dict[str, Any]] = []
        for index, rule in enumerate(rules):
            path = f"rules[{index}]"
            if not isinstance(rule, dict):
                issues.append({"path": path, "message": "must be an object"})
                continue
            rule_id = rule.get("ruleId")
            if not isinstance(rule_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", rule_id):
                issues.append({"path": path + ".ruleId", "message": "invalid stable rule ID"})
                continue
            if rule_id in ids:
                issues.append({"path": path + ".ruleId", "message": "duplicate rule ID"})
            ids.add(rule_id)
            if rule.get("category") not in {"permissive", "derived", "protection", "alarm", "scenario"}:
                issues.append({"path": path + ".category", "message": "unsupported rule category"})
            if not isinstance(rule.get("priority", 0), int) or isinstance(rule.get("priority", 0), bool):
                issues.append({"path": path + ".priority", "message": "must be an integer"})
            for timer in ("pickupMs", "dropoutMs"):
                value = rule.get(timer, 0)
                if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                    issues.append({"path": path + "." + timer, "message": "must be a nonnegative integer"})
            for field in ("when", "clearWhen"):
                if field not in rule:
                    if field == "when":
                        issues.append({"path": path + ".when", "message": "required expression is missing"})
                    continue
                try:
                    if _type_expr(rule[field], model, path + "." + field, 1, [0]) != ("bool", None):
                        raise ValueError("rule condition must be boolean")
                except (TypeError, ValueError) as exc:
                    issues.append({"path": path + "." + field, "message": str(exc)})
            actions = rule.get("actions", [])
            if not isinstance(actions, list) or len(actions) > 16:
                issues.append({"path": path + ".actions", "message": "must be a bounded action array"})
            else:
                for action_index, action in enumerate(actions):
                    if not isinstance(action, dict) or action.get("type") not in {"trip", "lockout", "alarm", "derive"}:
                        issues.append({"path": f"{path}.actions[{action_index}]", "message": "unsupported action"})
                        continue
                    if action["type"] in {"trip", "lockout"} and action.get("equipmentId") not in {d["equipmentId"] for d in model.get("equipment", [])}:
                        issues.append({"path": f"{path}.actions[{action_index}].equipmentId", "message": "unknown equipment"})
            self.rules.append(copy_rule(rule))
        if issues:
            raise RuleValidationError(issues)
        self.data = data
        self.by_id = {rule["ruleId"]: rule for rule in self.rules}
        owners: dict[str, str] = {}
        dependencies: dict[str, set[str]] = {rule["ruleId"]: set() for rule in self.rules}
        for rule in self.rules:
            for action in rule.get("actions", []):
                if action.get("type") != "derive":
                    continue
                target = action.get("target")
                if not isinstance(target, str):
                    issues.append({"path": f"rules.{rule['ruleId']}.actions", "message": "derived action requires a target path"})
                elif target in owners:
                    issues.append({"path": f"rules.{rule['ruleId']}.actions", "message": f"derived output {target} already has an owner"})
                else:
                    owners[target] = rule["ruleId"]
        if issues:
            raise RuleValidationError(issues)

        def references(expr: Any) -> set[str]:
            if not isinstance(expr, dict):
                return set()
            found = {expr["ref"]} if isinstance(expr.get("ref"), str) else set()
            for arg in expr.get("args", []):
                found |= references(arg)
            return found

        for rule in self.rules:
            expressions = [rule.get("when"), rule.get("clearWhen")]
            for expression in expressions:
                if expression is None:
                    continue
                for ref in references(expression):
                    if ref in owners and owners[ref] != rule["ruleId"]:
                        dependencies[rule["ruleId"]].add(owners[ref])
        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(rule_id: str) -> None:
            if rule_id in visiting:
                raise RuleValidationError([{"path": "rules", "message": "derived rule dependency cycle"}])
            if rule_id in visited:
                return
            visiting.add(rule_id)
            for dependency in dependencies[rule_id]:
                visit(dependency)
            visiting.remove(rule_id)
            visited.add(rule_id)

        for rule_id in dependencies:
            visit(rule_id)
        self.rules.sort(key=lambda r: (r.get("priority", 100), r["ruleId"]))

    def applicable(self, category: str, equipment_id: str | None = None, action: str | None = None) -> list[dict[str, Any]]:
        found = []
        for rule in self.rules:
            if rule["category"] != category:
                continue
            applies = rule.get("appliesTo", {})
            if equipment_id is not None and applies.get("equipmentId") != equipment_id:
                continue
            if action is not None and applies.get("action") != action:
                continue
            found.append(rule)
        return found

    def evaluate(self, expr: dict[str, Any], resolver: Callable[[str, str], TypedValue]) -> TypedValue:
        if "const" in expr:
            return TypedValue(expr["const"], expr.get("unit"))
        if "ref" in expr:
            return resolver(expr["ref"], expr["domain"])
        op, args = expr["op"], expr.get("args", [])
        values = [self.evaluate(arg, resolver) for arg in args]
        if op == "qualityGood":
            item = values[0]
            return TypedValue(item.quality == "good", None)
        if op == "not":
            return TypedValue(None if values[0].value is None else not values[0].value)
        if op == "all":
            return TypedValue(False if any(v.value is False for v in values) else None if any(v.value is None for v in values) else True)
        if op == "any":
            return TypedValue(True if any(v.value is True for v in values) else None if any(v.value is None for v in values) else False)
        if op == "abs":
            return TypedValue(None if values[0].value is None else abs(values[0].value), values[0].unit)
        a, b = values
        if a.value is None or (len(values) > 1 and b.value is None):
            return TypedValue(None, reason=a.reason or (b.reason if len(values) > 1 else None))
        try:
            if op == "eq": value = a.value == b.value
            elif op == "ne": value = a.value != b.value
            elif op == "lt": value = a.value < b.value
            elif op == "lte": value = a.value <= b.value
            elif op == "gt": value = a.value > b.value
            elif op == "gte": value = a.value >= b.value
            elif op == "add": value = a.value + b.value
            elif op == "sub": value = a.value - b.value
            elif op == "mul": value = a.value * b.value
            elif op == "div": value = None if b.value == 0 else a.value / b.value
            else: raise ValueError("unsupported operator")
        except (TypeError, ZeroDivisionError, OverflowError):
            value = None
        if isinstance(value, float) and not math.isfinite(value):
            value = None
        if op in COMPARISONS:
            return TypedValue(value)
        unit = a.unit if op in {"add", "sub"} else "" if op == "div" and a.unit == b.unit else a.unit if op == "mul" and b.unit == "" else None
        return TypedValue(value, unit)


def copy_rule(rule: dict[str, Any]) -> dict[str, Any]:
    import copy
    return copy.deepcopy(rule)


class RuleRuntime:
    """Pickup/dropout memory evaluated only on simulation ticks."""
    def __init__(self, ruleset: RuleSet):
        self.ruleset = ruleset
        self.since: dict[str, int] = {}
        self.clear_since: dict[str, int] = {}
        self.latched: set[str] = set()

    def sustained(self, rule: dict[str, Any], value: bool | None, sim_time_ms: int) -> bool:
        rule_id = rule["ruleId"]
        if value is not True:
            self.since.pop(rule_id, None)
            return False
        start = self.since.setdefault(rule_id, sim_time_ms)
        return sim_time_ms - start >= int(rule.get("pickupMs", 0))

    def sustained_clear(self, rule: dict[str, Any], value: bool | None, sim_time_ms: int) -> bool:
        rule_id = rule["ruleId"]
        if value is not True:
            self.clear_since.pop(rule_id, None)
            return False
        start = self.clear_since.setdefault(rule_id, sim_time_ms)
        return sim_time_ms - start >= int(rule.get("dropoutMs", 0))
