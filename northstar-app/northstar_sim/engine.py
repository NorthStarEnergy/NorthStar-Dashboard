from __future__ import annotations

import copy
import json
import math
import secrets
import time
from pathlib import Path
from typing import Any

from . import ENGINE_VERSION
from .electrical import SolverError, solve_radial
from .hydro import hydro_step
from .model import content_hash
from .rules import RuleRuntime, RuleSet, TypedValue
from .unit import initial_unit_state, sync_check, validate_unit_sequence

TICK_MS = 100
POSITIONS = {"open", "closed", "opening", "closing", "failed"}
HERE_FIXTURES = Path(__file__).resolve().parent / "fixtures"
UNIT_FIELD_UNIT = {"hpuPressureKPa": "kPa", "speedRpm": "rpm", "frequencyHz": "Hz", "voltageKVLL": "kV",
                   "phaseDegrees": "deg", "fieldCurrentA": "A", "bearingTemperatureC": "degC",
                   "activeMW": "MW", "requestedMW": "MW", "requestedMvar": "Mvar"}
EQUIPMENT_FIELD_UNIT = {"activeMW": "MW", "requestedMW": "MW", "reactiveMvar": "Mvar",
                        "voltageKVLL": "kV", "currentA": "A", "frequencyHz": "Hz", "flowM3S": "m3/s",
                        "headwaterM": "m", "storageM3": "m3"}


def json_load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


class SimError(ValueError):
    def __init__(self, code: str, message: str, status: int = 422, details: Any = None):
        self.code, self.status, self.details = code, status, details
        super().__init__(message)


class Session:
    def __init__(self, model: dict[str, Any], scenario: dict[str, Any], owner: str, seed: int,
                 rules: dict[str, Any] | None = None, unit_sequence: dict[str, Any] | None = None,
                 local_instructor: bool = False):
        self.model = copy.deepcopy(model)
        self.model_hash = content_hash(model)
        self.scenario = copy.deepcopy(scenario)
        self.scenario_hash = content_hash(scenario)
        self.rule_data = copy.deepcopy(rules if rules is not None else json_load(HERE_FIXTURES / "synthetic-rules.json"))
        self.rule_set = RuleSet(self.model, self.rule_data)
        self.rule_hash = content_hash(self.rule_data)
        raw_unit = unit_sequence if unit_sequence is not None else json_load(HERE_FIXTURES / "synthetic-unit-sequence.json")
        self.unit_sequence, self.unit_hash = validate_unit_sequence(raw_unit, self.model)
        self.rule_runtime = RuleRuntime(self.rule_set)
        self.unit = initial_unit_state(self.unit_sequence)
        self.instructor_enabled = bool(local_instructor)
        self.faults: dict[str, dict[str, Any]] = {}
        self.owner = owner
        self.session_id = secrets.token_urlsafe(18)
        self.run_id = secrets.token_urlsafe(12)
        self.seed = int(seed)
        self.sim_time_ms = 0
        self.state_revision = 0
        self.control_revision = 1
        self.status = "paused"
        self.speed = 1
        self.sequence = 0
        self.events: list[dict[str, Any]] = []
        self.states = {item["equipmentId"]: copy.deepcopy(item.get("initialState", {})) for item in self.model["equipment"]}
        for override in scenario.get("initialOverrides", []):
            if override["equipmentId"] in self.states:
                self.states[override["equipmentId"]][override["field"]] = copy.deepcopy(override["value"])
        self.states.setdefault(self.unit_sequence["generatorId"], {}).setdefault("remote", True)
        self.states[self.unit_sequence["generatorId"]].setdefault("lockout", False)
        self.pending: list[dict[str, Any]] = []
        self.scenario_injections = []
        self.active_faults: dict[str, dict[str, Any]] = {}
        initial_fault_events = []
        for injection in copy.deepcopy(scenario.get("injections", [])):
            if int(injection.get("atSimTimeMs", 0)) <= 0:
                if injection.get("type") == "mechanism_stuck" and injection.get("equipmentId") in self.states:
                    self.states[injection["equipmentId"]]["mechanismHealthy"] = False
                    initial_fault_events.append({"type": "mechanism_stuck", "equipmentId": injection["equipmentId"]})
                elif injection.get("type") == "freeze_observation" and injection.get("tagId"):
                    self.active_faults[injection["tagId"]] = {"until": int(injection.get("durationMs") or 0)}
                    initial_fault_events.append({"type": "freeze_observation", "tagId": injection["tagId"]})
            else:
                self.scenario_injections.append(injection)
        self.commands: dict[str, dict[str, Any]] = {}
        self.selections: dict[str, dict[str, Any]] = {}
        self.idempotency: dict[str, tuple[str, dict[str, Any]]] = {}
        self.observations: dict[str, dict[str, Any]] = {}
        self.truth: dict[str, Any] = {}
        self.alarm_active = False
        self.alarm_occurrences: list[dict[str, Any]] = []
        self.low_voltage_since: int | None = None
        self.low_voltage_clear_since: int | None = None
        self.debriefs: list[dict[str, Any]] = []
        self._emit("session_created", {"readiness": self.model["readiness"], "synthetic": True})
        for fault in initial_fault_events:
            self._emit("scenario_fault_injected", fault)
        self._settle()

    @property
    def rule_runtime_since(self) -> dict[str, int]:
        return self.rule_runtime.since

    @rule_runtime_since.setter
    def rule_runtime_since(self, value: dict[str, int]) -> None:
        self.rule_runtime.since = value

    @property
    def rule_runtime_clear_since(self) -> dict[str, int]:
        return self.rule_runtime.clear_since

    @rule_runtime_clear_since.setter
    def rule_runtime_clear_since(self, value: dict[str, int]) -> None:
        self.rule_runtime.clear_since = value

    @property
    def rule_runtime_latched(self) -> list[str]:
        return sorted(self.rule_runtime.latched)

    @rule_runtime_latched.setter
    def rule_runtime_latched(self, value: set[str] | list[str]) -> None:
        self.rule_runtime.latched = set(value)

    def _emit(self, kind: str, detail: dict[str, Any]) -> dict[str, Any]:
        self.sequence += 1
        event = {"sequence": self.sequence, "simTimeMs": self.sim_time_ms, "kind": kind,
                 "runId": self.run_id, "detail": copy.deepcopy(detail), "source": "simulation"}
        self.events.append(event)
        if len(self.events) > 10000:
            self.events.pop(0)
        return event

    @staticmethod
    def public_event(event: dict[str, Any]) -> dict[str, Any] | None:
        """Learner-safe event projection; scenario causes and internal truth stay server-side."""
        kind = event["kind"]
        if kind in {"scenario_fault_injected", "telemetry_fault_cleared", "engine_failed",
                    "instructor_fault_injected", "instructor_fault_expired"}:
            return None
        output = copy.deepcopy(event)
        if kind == "mechanism_completed":
            output["kind"] = "mechanism_travel_completed"
            output["detail"].pop("position", None)
        elif kind == "mechanism_failed":
            output["kind"] = "command_timed_out"
        return output

    def _device(self, equipment_id: str) -> dict[str, Any]:
        for device in self.model["equipment"]:
            if device["equipmentId"] == equipment_id:
                return device
        raise SimError("UNKNOWN_EQUIPMENT", f"Unknown equipment: {equipment_id}", 404)

    def _resolve_rule_ref(self, ref: str, domain: str) -> TypedValue:
        parts = ref.split(".")
        if parts[0] == "tags" and domain == "observation":
            tag_id = ".".join(parts[1:])
            sample = self.observations.get(tag_id)
            if not sample:
                return TypedValue(None, reason="INPUT_MISSING")
            quality = sample.get("quality", "missing")
            return TypedValue(sample.get("value") if quality == "good" else None, sample.get("unit"), quality, sample.get("reason"))
        if parts[0] == "unit" and len(parts) == 3:
            return TypedValue(self.unit.get(parts[2]), UNIT_FIELD_UNIT.get(parts[2]))
        if parts[0] == "equipment" and len(parts) == 3:
            equipment_id, field = parts[1], parts[2]
            device = next((item for item in self.model["equipment"] if item["equipmentId"] == equipment_id), None)
            if device is None:
                return TypedValue(None, reason="MODEL_REFERENCE_MISSING")
            if field == "currentA":
                value = self.truth.get("electrical", {}).get("branches", {}).get(equipment_id, {}).get("currentA")
                return TypedValue(value, "A", "good" if value is not None else "unsupported")
            if field == "voltageKVLL":
                node_id = device.get("terminals", [{}])[0].get("nodeId")
                value = self.truth.get("electrical", {}).get("nodes", {}).get(node_id, {}).get("voltageKVLL")
                return TypedValue(value, "kV", "good" if value is not None else "unsupported")
            state = self.states.get(equipment_id, {})
            if field in state:
                unit = EQUIPMENT_FIELD_UNIT.get(field)
                return TypedValue(state[field], unit)
            if field in device.get("parameters", {}):
                return TypedValue(device["parameters"][field], EQUIPMENT_FIELD_UNIT.get(field))
            return TypedValue(None, reason="INPUT_UNKNOWN")
        return TypedValue(None, reason="INPUT_UNKNOWN")

    def _rule_value(self, expression: dict[str, Any]) -> TypedValue:
        return self.rule_set.evaluate(expression, self._resolve_rule_ref)

    def _sync_check(self) -> tuple[bool, dict[str, Any]]:
        grid = next((device for device in self.model["equipment"] if device["type"] == "grid_source"
                     and self.states[device["equipmentId"]].get("enabled", False)), None)
        bus_voltage = self.truth.get("electrical", {}).get("nodes", {}).get("BUS", {}).get("voltageKVLL")
        if grid is None:
            bus_frequency, bus_phase = 0.0, 0.0
        else:
            bus_frequency = float(grid["parameters"].get("frequencyHz", 60))
            bus_phase = float(grid["parameters"].get("phaseDegrees", 0))
        passed, detail = sync_check(self.unit, bus_voltage, bus_frequency, bus_phase, self.unit_sequence)
        self.unit["syncCheckPassed"] = passed
        self.unit["syncDetail"] = detail
        return passed, detail

    def _schedule_internal_open(self, breaker_id: str, purpose: str, rule_id: str = "") -> None:
        if any(item["equipmentId"] == breaker_id and item["action"] == "open" for item in self.pending):
            return
        breaker = self._device(breaker_id)
        state = self.states[breaker_id]
        if state.get("position") == "open":
            return
        command_id = secrets.token_urlsafe(14)
        delay = int(breaker.get("parameters", {}).get("openDelayMs", 0))
        self.commands[command_id] = {"commandId": command_id, "equipmentId": breaker_id, "action": "open",
                                     "lifecycle": "executing", "acceptedAtSimTimeMs": self.sim_time_ms,
                                     "expectedCompletionSimTimeMs": self.sim_time_ms + delay, "indicationConfirmed": False,
                                     "source": "simulation"}
        state["mechanismState"] = "opening"
        self.pending.append({"due": self.sim_time_ms + delay, "commandId": command_id, "equipmentId": breaker_id,
                             "action": "open", "delay": delay, "protection": purpose == "protection",
                             "purpose": purpose, "ruleId": rule_id})
        self.control_revision += 1

    def _start_unit(self) -> None:
        self.unit.update({"sequenceState": "START_CHECK", "sequenceElapsedMs": 0, "tripCause": None,
                          "stopPhase": "", "syncCheckPassed": False, "brakesApplied": True,
                          "phaseDegrees": float(self.unit_sequence["assumptions"]["syncPhaseInitialDegrees"])})
        self._emit("unit_sequence_started", {"unitId": self.unit_sequence["unitId"], "state": "START_CHECK"})

    def _apply_unit_action(self, action: str, requested_value: float | None = None, equipment_id: str | None = None) -> None:
        if action == "start":
            self._start_unit()
        elif action == "stop":
            self.unit.update({"sequenceState": "STOPPING", "sequenceElapsedMs": 0, "stopPhase": "unload"})
            self.unit["requestedMW"] = 0.0
            self.states[self.unit_sequence["generatorId"]]["requestedMW"] = 0.0
            self._emit("unit_stop_started", {"unitId": self.unit_sequence["unitId"]})
        elif action == "setpoint":
            self.unit["requestedMW"] = float(requested_value or 0)
            self.states[self.unit_sequence["generatorId"]]["requestedMW"] = self.unit["requestedMW"]
            self._emit("unit_setpoint_changed", {"unitId": self.unit_sequence["unitId"], "requestedMW": self.unit["requestedMW"]})
        elif action == "set_mvar":
            self.unit["requestedMvar"] = float(requested_value or 0)
            self.states[self.unit_sequence["generatorId"]]["reactiveMvar"] = self.unit["requestedMvar"]
            self._emit("unit_reactive_setpoint_changed", {"unitId": self.unit_sequence["unitId"], "requestedMvar": self.unit["requestedMvar"]})
        elif action == "reset_lockout":
            breaker_id = equipment_id or self.unit_sequence["generatorBreakerId"]
            self.states[breaker_id]["lockout"] = False
            for rule in self.rule_set.applicable("protection"):
                if any(item.get("equipmentId") == breaker_id for item in rule.get("actions", [])):
                    self.rule_runtime.latched.discard(rule["ruleId"])
                    self.rule_runtime.since.pop(rule["ruleId"], None)
            if breaker_id == self.unit_sequence["generatorBreakerId"]:
                self.unit["tripCause"] = None
                if self.unit["sequenceState"] in {"LOCKED_OUT", "TRIPPED"}:
                    self.unit["sequenceState"] = "STOPPING"
                    self.unit["stopPhase"] = "rundown"
            self._emit("lockout_reset", {"equipmentId": breaker_id})

    def _advance_unit(self) -> None:
        dt = TICK_MS / 1000
        assumptions = self.unit_sequence["assumptions"]
        generator_id = self.unit_sequence["generatorId"]
        turbine_id = self.unit_sequence["turbineId"]
        generator_state = self.states[generator_id]
        unit_state = self.unit["sequenceState"]
        self.unit["sequenceElapsedMs"] += TICK_MS
        if unit_state == "START_CHECK" and self.unit["sequenceElapsedMs"] >= assumptions["startCheckMs"]:
            self.unit.update({"sequenceState": "STARTING", "sequenceElapsedMs": 0, "brakesApplied": False})
            self._emit("unit_sequence_step", {"unitId": generator_id, "state": "STARTING"})
        elif unit_state == "STARTING":
            self.unit["speedRpm"] = min(assumptions["ratedSpeedRpm"], self.unit["speedRpm"] + assumptions["speedRampRpmPerSecond"] * dt)
            self.unit["voltageKVLL"] = min(assumptions["ratedVoltageKVLL"], self.unit["voltageKVLL"] + assumptions["voltageBuildKVPerSecond"] * dt)
            self.unit["fieldCurrentA"] = min(assumptions["ratedFieldCurrentA"], self.unit["fieldCurrentA"] + assumptions["fieldCurrentRateAperSecond"] * dt)
            self.unit["frequencyHz"] = self.unit["speedRpm"] / 60.0
            self.unit["phaseDegrees"] = max(0.0, self.unit["phaseDegrees"] - assumptions["syncPhaseApproachDegreesPerSecond"] * dt)
            self.states[turbine_id]["gateDemandFraction"] = assumptions["syncGateDemandFraction"]
            if self.unit["sequenceElapsedMs"] >= 6000 and self.unit["speedRpm"] >= assumptions["ratedSpeedRpm"]:
                self.unit.update({"sequenceState": "READY_TO_SYNCHRONIZE", "sequenceElapsedMs": 0,
                                  "frequencyHz": 60.0, "voltageKVLL": assumptions["ratedVoltageKVLL"]})
                self._emit("unit_sequence_step", {"unitId": generator_id, "state": "READY_TO_SYNCHRONIZE"})
        elif unit_state == "READY_TO_SYNCHRONIZE":
            self.unit["phaseDegrees"] = max(0.0, self.unit["phaseDegrees"] - assumptions["syncPhaseApproachDegreesPerSecond"] * dt)
            self._sync_check()
        elif unit_state == "ONLINE":
            self._sync_check()
            rated_mw = float(self._device(generator_id)["parameters"]["ratedMW"])
            head = max(0.0, float(self.unit.get("netHeadM", 0)))
            efficiency = float(self._device(turbine_id)["parameters"].get("efficiency", 0.9))
            maximum_flow = float(self._device(turbine_id)["parameters"]["maxFlowM3S"])
            hydro_max = 1000 * 9.80665 * maximum_flow * head * efficiency / 1e6
            target_flow = min(maximum_flow, maximum_flow * self.unit["requestedMW"] / max(min(rated_mw, hydro_max), 0.01))
            self.states[turbine_id]["gateDemandFraction"] = target_flow / maximum_flow
            self.unit["fieldCurrentA"] = max(0.0, min(assumptions["ratedFieldCurrentA"],
                assumptions["ratedFieldCurrentA"] * (1 + self.unit.get("requestedMvar", 0) / max(assumptions["maxReactiveMvar"], 0.1)) / 2))
            self.unit["bearingTemperatureC"] += ((assumptions["bearingAmbientC"] + assumptions["bearingHeatCPerMW"] * self.unit.get("activeMW", 0)
                - self.unit["bearingTemperatureC"]) / assumptions["bearingCoolingTauSeconds"]) * dt
        elif unit_state in {"LOCKED_OUT", "TRIPPED"}:
            self.states[turbine_id]["gateDemandFraction"] = 0.0
            self.unit["requestedMW"] = 0.0
            generator_state["requestedMW"] = 0.0
            self.unit["speedRpm"] = max(0.0, self.unit["speedRpm"] - assumptions["speedRundownRpmPerSecond"] * dt)
            self.unit["frequencyHz"] = self.unit["speedRpm"] / 60.0
        elif unit_state == "STOPPING":
            self.unit["requestedMW"] = 0.0
            generator_state["requestedMW"] = 0.0
            self.states[turbine_id]["gateDemandFraction"] = 0.0
            if self.unit["stopPhase"] == "unload" and self.unit.get("activeMW", 0) <= 0.05 and self.states[turbine_id].get("flowM3S", 0) <= 0.25:
                if self.states[self.unit_sequence["generatorBreakerId"]].get("position") == "open":
                    self.unit["stopPhase"] = "rundown"
                else:
                    self.unit["stopPhase"] = "disconnect"
                    self._schedule_internal_open(self.unit_sequence["generatorBreakerId"], "unit_stop")
            if self.unit["stopPhase"] == "rundown":
                self.unit["speedRpm"] = max(0.0, self.unit["speedRpm"] - assumptions["speedRundownRpmPerSecond"] * dt)
                self.unit["frequencyHz"] = self.unit["speedRpm"] / 60.0
                if self.unit["speedRpm"] <= assumptions["minimumStopSpeedRpm"] and self.states[turbine_id].get("flowM3S", 0) <= 0.1:
                    self.unit.update({"sequenceState": "STOPPED", "sequenceElapsedMs": 0, "brakesApplied": True,
                                      "speedRpm": 0.0, "frequencyHz": 0.0, "voltageKVLL": 0.0, "fieldCurrentA": 0.0, "stopPhase": ""})
                    self._emit("unit_sequence_step", {"unitId": generator_id, "state": "STOPPED"})
        if self.unit["sequenceState"] in {"STARTING", "READY_TO_SYNCHRONIZE", "SYNCHRONIZING", "ONLINE"}:
            self.unit["hpuPressureKPa"] = max(0.0, self.unit["hpuPressureKPa"] - max(0.0, self.unit.get("flowM3S", 0)) * 2.0 * dt)
        elif self.unit["sequenceState"] in {"STOPPING", "STOPPED"}:
            self.unit["hpuPressureKPa"] = min(assumptions["initialHpuPressureKPa"],
                self.unit["hpuPressureKPa"] + assumptions["stopPressureRecoveryKPaPerSecond"] * dt)
        turbine = self.states[turbine_id]
        gate = float(turbine.get("gateFraction", 0))
        demand = max(0.0, min(1.0, float(turbine.get("gateDemandFraction", 0))))
        change = float(assumptions["gateRateFractionPerSecond"]) * dt
        turbine["gateFraction"] = max(gate - change, min(gate + change, demand))
        generator_state["requestedMW"] = float(self.unit.get("requestedMW", 0))
        generator_state["reactiveMvar"] = float(self.unit.get("requestedMvar", 0))
        self.unit["activeMW"] = float(generator_state.get("activeMW", 0))

    def _evaluate_protection_rules(self) -> None:
        for rule in self.rule_set.applicable("protection"):
            if rule["ruleId"] in self.rule_runtime.latched:
                continue
            outcome = self._rule_value(rule["when"])
            if not self.rule_runtime.sustained(rule, outcome.value, self.sim_time_ms):
                continue
            self.rule_runtime.latched.add(rule["ruleId"])
            for action in rule.get("actions", []):
                if action["type"] == "lockout":
                    self.states[action["equipmentId"]]["lockout"] = True
                elif action["type"] == "trip":
                    if action["equipmentId"] == self.unit_sequence["generatorBreakerId"]:
                        self.unit["tripCause"] = rule["ruleId"]
                        self.unit["sequenceState"] = "LOCKED_OUT"
                        self.unit["stopPhase"] = "rundown"
                    self._schedule_internal_open(action["equipmentId"], "protection", rule["ruleId"])
            self.control_revision += 1
            self._emit("protection_operated", {"ruleId": rule["ruleId"]})

    def _inject_local_overload(self, duration_ms: int) -> dict[str, Any]:
        if not self.instructor_enabled:
            raise SimError("INSTRUCTOR_ONLY", "Instructor faults are disabled for this session", 403)
        if self.status not in {"running", "paused"}:
            raise SimError("SESSION_NOT_ACTIVE", "Fault requires an active exercise", 409)
        self.faults["load_overcurrent"] = {"untilSimTimeMs": self.sim_time_ms + duration_ms}
        load_id = next(item["equipmentId"] for item in self.model["equipment"] if item["type"] == "load")
        self.states[load_id]["faultActiveMW"] = 4.0
        self._emit("instructor_fault_injected", {"type": "load_overcurrent", "durationMs": duration_ms})
        self.control_revision += 1
        return {"source": "simulation", "sessionId": self.session_id, "stateRevision": self.state_revision,
                "controlRevision": self.control_revision, "faultId": "load_overcurrent", "status": "injected"}

    def _settle(self) -> None:
        try:
            result = solve_radial(self.model, self.states)
        except SolverError as exc:
            result = {"quality": "unsupported", "solver": "balanced_radial_v1", "reason": str(exc), "nodes": {}, "branches": {}}
        self.truth = {"electrical": result}
        self._refresh_unit_electrical(result)
        self.truth["hydro"] = {key: {k: v for k, v in state.items() if k in {"flowM3S", "netHeadM", "hydraulicPowerMW"}}
                                for key, state in self.states.items() if "flowM3S" in state}
        self.state_revision += 1
        by_id = {item["equipmentId"]: item for item in self.model["equipment"]}
        samples = []
        for tag in self.model.get("tags", []):
            eq_id = tag["equipmentId"]
            path = tag["source"].split(".")
            value: Any = self.states.get(eq_id, {})
            if path[0] == "unit" and len(path) == 3:
                value = self.unit.get(path[2])
            elif path[0] == "node" and len(path) == 3 and path[-1] == "voltageKVLL":
                value = result.get("nodes", {}).get(path[1], {}).get("voltageKVLL")
            elif path[-1] == "voltageKVLL":
                device = by_id[eq_id]
                node_id = device.get("terminals", [{}])[0].get("nodeId")
                value = result.get("nodes", {}).get(node_id, {}).get("voltageKVLL")
            elif path[-1] == "currentA":
                value = result.get("branches", {}).get(eq_id, {}).get("currentA")
            elif path[-1] == "activeMW" and by_id[eq_id]["type"] in {"load", "generator"}:
                device = by_id[eq_id]
                node_id = device.get("terminals", [{}])[0].get("nodeId")
                energization = result.get("nodes", {}).get(node_id, {}).get("energization")
                if energization == "deenergized":
                    value = 0.0
                elif energization != "energized":
                    value = None
                elif device["type"] == "load":
                    value = device["parameters"].get("activeMW", 0)
                else:
                    value = self.states[eq_id].get("activeMW", 0)
            elif path[-1] in value:
                value = value[path[-1]]
            quality = result.get("quality", "good")
            previous = self.observations.get(tag["tagId"])
            fault = self.active_faults.get(tag["tagId"])
            if previous and fault and self.sim_time_ms < fault["until"]:
                sample = copy.deepcopy(previous)
                sample["receivedSimTimeMs"] = self.sim_time_ms
                if self.sim_time_ms - sample["observedSimTimeMs"] > int(tag.get("staleAfterMs", 0)):
                    sample["quality"] = "stale"
                    sample["reason"] = "SIMULATED_COMMUNICATION_FROZEN"
                samples.append(sample)
                self.observations[tag["tagId"]] = sample
                continue
            if previous and self.sim_time_ms < previous["observedSimTimeMs"] + int(tag.get("scanMs", TICK_MS)):
                sample = copy.deepcopy(previous)
                if self.sim_time_ms - sample["observedSimTimeMs"] > int(tag.get("staleAfterMs", 0)):
                    sample["quality"] = "stale"
                    sample["reason"] = "SIMULATED_SCAN_STALE"
                samples.append(sample)
                self.observations[tag["tagId"]] = sample
                continue
            sample = {"tagId": tag["tagId"], "equipmentId": eq_id, "kind": tag["kind"], "unit": tag["unit"],
                      "value": value, "quality": quality, "reason": result.get("reason"),
                      "observedSimTimeMs": self.sim_time_ms, "receivedSimTimeMs": self.sim_time_ms,
                      "stateRevision": self.state_revision, "source": "simulation"}
            if fault and self.sim_time_ms >= fault["until"]:
                del self.active_faults[tag["tagId"]]
                self._emit("telemetry_fault_cleared", {"tagId": tag["tagId"]})
            samples.append(sample)
            self.observations[tag["tagId"]] = sample
        self.truth["tags"] = samples
        for command in self.commands.values():
            if command.get("lifecycle") != "succeeded" or command.get("action") not in {"open", "close"}:
                continue
            tag = self.observations.get(f"sim.{command['equipmentId']}.position", {})
            command["indicationConfirmed"] = bool(tag.get("quality") == "good"
                and tag.get("observedSimTimeMs", -1) >= command.get("completedAtSimTimeMs", 0)
                and tag.get("value") == command.get("physicalOutcome"))
        self._evaluate_alarms()

    def _refresh_unit_electrical(self, result: dict[str, Any]) -> None:
        generator_id = self.unit_sequence["generatorId"]
        breaker_id = self.unit_sequence["generatorBreakerId"]
        gen_state = self.states[generator_id]
        terminals = self._device(generator_id).get("terminals", [])
        node_id = terminals[0]["nodeId"] if terminals else ""
        node = result.get("nodes", {}).get(node_id, {})
        connected = self.states[breaker_id].get("position") == "closed" and node.get("energization") == "energized"
        self.unit["activeMW"] = float(gen_state.get("activeMW", 0)) if connected and gen_state.get("enabled") else 0.0
        self.unit["requestedMW"] = float(gen_state.get("requestedMW", self.unit.get("requestedMW", 0)))
        self.unit["requestedMvar"] = float(gen_state.get("reactiveMvar", self.unit.get("requestedMvar", 0)))
        self.unit["gateFraction"] = float(self.states.get(self.unit_sequence["turbineId"], {}).get("gateFraction", 0))
        self.unit["netHeadM"] = float(self.states.get(self.unit_sequence["turbineId"], {}).get("netHeadM", self.unit.get("netHeadM", 0)))
        self.unit["mechanicalPowerMW"] = float(self.states.get(self.unit_sequence["turbineId"], {}).get("hydraulicPowerMW", 0))
        voltage = node.get("voltageKVLL")
        power = self.unit["activeMW"]
        reactive = self.unit["requestedMvar"] if connected else 0.0
        apparent = math.hypot(power, reactive)
        self.unit["powerFactor"] = abs(power) / apparent if apparent > 1e-9 else 1.0
        self.unit["currentA"] = (1000 * apparent / (math.sqrt(3) * voltage)
                                  if connected and voltage and voltage > 0 else 0.0)

    def _evaluate_alarms(self) -> None:
        for rule in self.rule_set.applicable("alarm"):
            action = next((item for item in rule.get("actions", []) if item.get("type") == "alarm"), None)
            if action is None:
                continue
            condition = self._rule_value(rule["when"])
            picked_up = self.rule_runtime.sustained(rule, condition.value, self.sim_time_ms)
            active = next((item for item in reversed(self.alarm_occurrences)
                           if item["ruleId"] == rule["ruleId"] and item["state"] in {"active_unacknowledged", "active_acknowledged"}), None)
            if active:
                clear_value = self._rule_value(rule["clearWhen"]).value if rule.get("clearWhen") else condition.value is False
                if self.rule_runtime.sustained_clear(rule, clear_value, self.sim_time_ms):
                    active["state"] = "returned_acknowledged" if active["acknowledged"] else "returned_unacknowledged"
                    active["returnedAtSimTimeMs"] = self.sim_time_ms
                    self._emit("alarm_returned", {"occurrenceId": active["occurrenceId"], "alarmId": active["alarmId"]})
                continue
            if picked_up:
                occurrence = {"occurrenceId": secrets.token_urlsafe(12), "alarmId": action["alarmId"],
                              "ruleId": rule["ruleId"], "severity": action.get("severity", "medium"),
                              "state": "active_unacknowledged", "acknowledged": False,
                              "pickedUpAtSimTimeMs": self.sim_time_ms, "source": "simulation"}
                self.alarm_occurrences.append(occurrence)
                self._emit("alarm_picked_up", {"occurrenceId": occurrence["occurrenceId"], "alarmId": occurrence["alarmId"]})

    def acknowledge_alarm(self, occurrence_id: str) -> dict[str, Any]:
        occurrence = next((item for item in self.alarm_occurrences if item["occurrenceId"] == occurrence_id), None)
        if occurrence is None:
            raise SimError("ALARM_NOT_FOUND", "Simulated alarm occurrence not found", 404)
        if occurrence["state"] not in {"active_unacknowledged", "returned_unacknowledged"}:
            return copy.deepcopy(occurrence)
        occurrence["acknowledged"] = True
        occurrence["state"] = "active_acknowledged" if occurrence["state"] == "active_unacknowledged" else "returned_acknowledged"
        occurrence["acknowledgedAtSimTimeMs"] = self.sim_time_ms
        self._emit("alarm_acknowledged", {"occurrenceId": occurrence_id, "alarmId": occurrence["alarmId"]})
        return copy.deepcopy(occurrence)

    def finish(self) -> dict[str, Any]:
        if self.status == "completed":
            raise SimError("SESSION_ALREADY_COMPLETED", "This run is already complete", 409)
        for pending in list(self.pending):
            self.pending.remove(pending)
            command = self.commands[pending["commandId"]]
            command.update({"lifecycle": "cancelled", "failureReason": "SESSION_FINISHED", "completedAtSimTimeMs": self.sim_time_ms})
            self._emit("command_cancelled", {"commandId": command["commandId"], "reason": "SESSION_FINISHED"})
        self.status = "completed"
        self.control_revision += 1
        achieved = False
        if self.scenario["scenarioId"] == "NORMAL-OPEN":
            achieved = self.states.get("CB1", {}).get("position") == "open" and self.truth.get("electrical", {}).get("nodes", {}).get("BUS", {}).get("energization") == "deenergized"
        elif self.scenario["scenarioId"] == "BACKFEED":
            achieved = self.states.get("CB1", {}).get("position") == "open" and self.truth.get("electrical", {}).get("nodes", {}).get("BUS", {}).get("energization") == "energized"
        elif self.scenario["scenarioId"] == "UNIT-STARTUP":
            achieved = (self.unit["sequenceState"] == "STOPPED" and self.unit.get("energyMWh", 0) > 0
                        and any(event["runId"] == self.run_id and event["kind"] == "unit_stop_started" for event in self.events))
        elif self.scenario["scenarioId"] == "UNIT-TRIP":
            achieved = (self.unit["sequenceState"] == "STOPPED"
                        and any(event["runId"] == self.run_id and event["kind"] == "protection_operated" for event in self.events)
                        and not any(state.get("lockout", False) for state in self.states.values()))
        debrief = {"source": "simulation", "simulation": True, "sessionId": self.session_id, "runId": self.run_id,
                    "modelId": self.model["modelId"], "modelHash": self.model_hash,
                    "rulesHash": self.rule_hash, "unitSequenceHash": self.unit_hash,
                   "scenarioId": self.scenario["scenarioId"], "scenarioHash": self.scenario_hash,
                   "engineVersion": ENGINE_VERSION, "completedAtSimTimeMs": self.sim_time_ms,
                   "objective": self.scenario.get("objective", "Review the synthetic exercise state."),
                   "objectiveAchieved": achieved, "notAProcedure": True,
                   "limitations": list(self.model.get("fidelity", {}).get("limitations", [])),
                   "unsafeAttempts": sum(event["kind"] == "command_refused" for event in self.events),
                   "events": copy.deepcopy(self.events)}
        self._emit("session_completed", {"runId": self.run_id, "objectiveAchieved": achieved})
        debrief["events"] = [public for event in self.events if event["runId"] == self.run_id
                             if (public := self.public_event(event)) is not None]
        self.debriefs.append(debrief)
        return copy.deepcopy(debrief)

    def reset(self) -> dict[str, Any]:
        if self.status != "completed":
            raise SimError("SESSION_NOT_COMPLETED", "Finish the current run before resetting", 409)
        self.run_id = secrets.token_urlsafe(12)
        self.sim_time_ms = 0
        self.state_revision = 0
        self.control_revision += 1
        self.status = "paused"
        self.states = {item["equipmentId"]: copy.deepcopy(item.get("initialState", {})) for item in self.model["equipment"]}
        for override in self.scenario.get("initialOverrides", []):
            self.states[override["equipmentId"]][override["field"]] = copy.deepcopy(override["value"])
        self.pending.clear(); self.commands.clear(); self.selections.clear(); self.idempotency.clear()
        self.observations.clear(); self.truth.clear(); self.alarm_occurrences.clear()
        self.unit = initial_unit_state(self.unit_sequence)
        self.rule_runtime = RuleRuntime(self.rule_set)
        self.faults.clear()
        self.low_voltage_since = None; self.low_voltage_clear_since = None
        self.scenario_injections = [copy.deepcopy(item) for item in self.scenario.get("injections", []) if int(item.get("atSimTimeMs", 0)) > 0]
        self.active_faults.clear()
        for item in self.scenario.get("injections", []):
            if int(item.get("atSimTimeMs", 0)) == 0:
                if item.get("type") == "mechanism_stuck" and item.get("equipmentId") in self.states:
                    self.states[item["equipmentId"]]["mechanismHealthy"] = False
                elif item.get("type") == "freeze_observation" and item.get("tagId"):
                    self.active_faults[item["tagId"]] = {"until": int(item.get("durationMs") or 0)}
        self._emit("run_reset", {"runId": self.run_id})
        self._settle()
        return self.snapshot()

    def _permissives(self, device: dict[str, Any], action: str) -> list[dict[str, str]]:
        eq_id = device["equipmentId"]
        state = self.states[eq_id]
        failures = []
        switch_action = action in {"open", "close"} and device["type"] in {"breaker", "isolator", "earth_switch"}
        unit_action = device["type"] == "generator" and action in {"start", "stop", "setpoint", "set_mvar"}
        reset_action = action == "reset_lockout" and device["type"] in {"breaker", "isolator"}
        if not (switch_action or unit_action or reset_action):
            return [{"code": "UNSUPPORTED_ACTION", "message": "Action is not supported for this device"}]
        if state.get("remote", True) is not True:
            failures.append({"code": "LOCAL_CONTROL", "message": "Device is in local control"})
        if switch_action:
            if state.get("mechanismState") in {"opening", "closing"}:
                failures.append({"code": "DEVICE_MOVING", "message": "Mechanism is already moving"})
            if state.get("position") == ("closed" if action == "close" else "open"):
                failures.append({"code": "ALREADY_IN_POSITION", "message": f"Device is already {action}"})
        if action in {"close", "start", "setpoint", "set_mvar", "reset_lockout"}:
            params = device.get("parameters", {})
            supply = next((self.states[x["equipmentId"]] for x in self.model["equipment"]
                           if x["type"] == "control_supply" and x["equipmentId"] == params.get("controlSupplyRef")),
                          self.states.get("DC1"))
            if supply is not None and not supply.get("available", False):
                failures.append({"code": "CONTROL_POWER_LOST", "message": "Control supply unavailable"})
        if action == "close" and state.get("lockout", False):
            failures.append({"code": "LOCKOUT_ACTIVE", "message": "Lockout is active"})
        if action == "close" and device["type"] == "earth_switch":
            node_id = device["terminals"][0]["nodeId"]
            if self.truth.get("electrical", {}).get("nodes", {}).get(node_id, {}).get("energization") == "energized":
                failures.append({"code": "GROUND_PRESENT", "message": "Synthetic earth switch cannot close onto an energized node"})
        if action == "close" and device["type"] != "earth_switch":
            graph: dict[str, set[str]] = {}
            for item in self.model["equipment"]:
                if len(item.get("terminals", [])) != 2:
                    continue
                active = item["equipmentId"] == eq_id or item["type"] == "line" or (
                    item["type"] in {"breaker", "isolator", "earth_switch"}
                    and self.states[item["equipmentId"]].get("position") == "closed")
                if active:
                    a, b = (terminal["nodeId"] for terminal in item["terminals"])
                    graph.setdefault(a, set()).add(b)
                    graph.setdefault(b, set()).add(a)
            reachable = set()
            todo = [terminal["nodeId"] for terminal in device.get("terminals", [])]
            while todo:
                node = todo.pop()
                if node in reachable:
                    continue
                reachable.add(node)
                todo.extend(graph.get(node, set()) - reachable)
            if any(item["type"] == "earth_switch" and self.states[item["equipmentId"]].get("position") == "closed"
                   and item["equipmentId"] != eq_id and item["terminals"][0]["nodeId"] in reachable
                   for item in self.model["equipment"]):
                failures.append({"code": "GROUND_PRESENT", "message": "A connected synthetic earth switch is closed"})
            if self.truth.get("electrical", {}).get("quality") != "good":
                failures.append({"code": "UNSUPPORTED_MODEL", "message": "Electrical permissive is unknown or unsupported"})
            if eq_id == self.unit_sequence["generatorBreakerId"]:
                self._sync_check()
        if action == "open" and device["type"] == "isolator" and not device.get("parameters", {}).get("loadBreakCapable", False):
            current = max((entry.get("currentA", 0) for entry in self.truth.get("electrical", {}).get("branches", {}).values()), default=0)
            limit = float(device.get("parameters", {}).get("maxSwitchingCurrentA", 0))
            if current > limit:
                failures.append({"code": "LOAD_BREAK_NOT_PERMITTED", "message": "Non-load-break isolator has current above its declared limit"})
        if action == "start" and self.unit["sequenceState"] != "STOPPED":
            failures.append({"code": "UNIT_NOT_STOPPED", "message": f"Unit is {self.unit['sequenceState']}, not STOPPED"})
        if action == "stop" and self.unit["sequenceState"] not in {"START_CHECK", "STARTING", "READY_TO_SYNCHRONIZE", "SYNCHRONIZING", "ONLINE"}:
            failures.append({"code": "UNIT_NOT_RUNNING", "message": f"Unit is {self.unit['sequenceState']} and cannot normal-stop"})
        if action == "set_mvar" and self.unit["sequenceState"] != "ONLINE":
            failures.append({"code": "UNIT_NOT_ONLINE", "message": "Reactive demand requires an online unit"})
        if action == "reset_lockout":
            if not state.get("lockout", False):
                failures.append({"code": "NO_LOCKOUT", "message": "No lockout is active"})
            for rule in self.rule_set.applicable("protection"):
                if rule["ruleId"] in self.rule_runtime.latched and any(item.get("equipmentId") == eq_id for item in rule.get("actions", [])):
                    if self._rule_value(rule["when"]).value is not False:
                        failures.append({"code": "LOCKOUT_CAUSE_ACTIVE", "message": "Protection cause is active or unknown"})
            if state.get("position") != "open":
                failures.append({"code": "BREAKER_NOT_OPEN", "message": "Open and verify the breaker before reset"})
        for rule in self.rule_set.applicable("permissive", eq_id, action):
            outcome = self._rule_value(rule["when"])
            if outcome.value is not True:
                failures.append({"code": rule.get("failureCode", "PERMISSIVE_NOT_MET"),
                                 "message": rule.get("explanation", f"Permissive {rule['ruleId']} is false or unknown")})
        return failures

    def select(self, actor: str, payload: dict[str, Any]) -> dict[str, Any]:
        if self.status != "running":
            raise SimError("SESSION_NOT_RUNNING", "Equipment commands require a running exercise", 409)
        if "actor" in payload or "role" in payload:
            raise SimError("CLIENT_IDENTITY_FORBIDDEN", "Actor and role are server-assigned", 400)
        unknown = set(payload) - {"equipmentId", "action", "requestedValue", "unit", "expectedControlRevision", "clientRequestId"}
        if unknown:
            raise SimError("UNKNOWN_FIELDS", "Selection contains unsupported fields", 400, sorted(unknown))
        if payload.get("expectedControlRevision") != self.control_revision:
            raise SimError("STALE_REVISION", "Control revision changed; refresh and select again", 409,
                           {"controlRevision": self.control_revision})
        now = time.time()
        self.selections = {token: item for token, item in self.selections.items() if item["expiresAt"] > now}
        if len(self.selections) >= 100:
            raise SimError("SELECTION_LIMIT", "Too many outstanding selections; wait for expiry", 429)
        device = self._device(str(payload.get("equipmentId", "")))
        action = str(payload.get("action", ""))
        requested_value = payload.get("requestedValue")
        if action in {"setpoint", "set_mvar"}:
            if not isinstance(requested_value, (int, float)) or isinstance(requested_value, bool) or not math.isfinite(requested_value):
                raise SimError("INVALID_SETPOINT", "A finite numeric requestedValue is required", 422)
            if action == "setpoint":
                limit = float(device.get("parameters", {}).get("ratedMW", 0))
                if payload.get("unit") != "MW" or not 0 <= requested_value <= limit:
                    raise SimError("SETPOINT_OUT_OF_RANGE", f"Requested power must be 0..{limit:g} MW", 422)
            else:
                if payload.get("unit") != "Mvar" or not self.unit_sequence["assumptions"]["minReactiveMvar"] <= requested_value <= self.unit_sequence["assumptions"]["maxReactiveMvar"]:
                    raise SimError("SETPOINT_OUT_OF_RANGE", "Reactive demand exceeds synthetic Mvar limits", 422)
        failures = self._permissives(device, action)
        token = secrets.token_urlsafe(24)
        selection = {"token": token, "actor": actor, "equipmentId": device["equipmentId"], "action": action,
                     "requestedValue": requested_value, "unit": payload.get("unit"),
                     "expiresAt": now + 10, "controlRevision": self.control_revision,
                     "permissives": failures}
        self.selections[token] = selection
        return {"selectionToken": token, "expiresInSeconds": 10, "controlRevision": self.control_revision,
                "permissives": failures, "canExecute": not failures, "source": "simulation", "sessionId": self.session_id}

    def execute(self, actor: str, payload: dict[str, Any]) -> dict[str, Any]:
        if "actor" in payload or "role" in payload:
            raise SimError("CLIENT_IDENTITY_FORBIDDEN", "Actor and role are server-assigned", 400)
        unknown = set(payload) - {"selectionToken", "expectedControlRevision", "idempotencyKey"}
        if unknown:
            raise SimError("UNKNOWN_FIELDS", "Command contains unsupported fields", 400, sorted(unknown))
        token = str(payload.get("selectionToken", ""))
        key = str(payload.get("idempotencyKey", ""))
        if not key or len(key) > 128:
            raise SimError("IDEMPOTENCY_KEY_REQUIRED", "A bounded idempotencyKey is required", 400)
        fingerprint = content_hash({"operation": "command", "payload": {k: v for k, v in payload.items() if k != "idempotencyKey"}})
        idem_key = "command:" + key
        if idem_key in self.idempotency:
            old_fingerprint, old_response = self.idempotency[idem_key]
            if fingerprint != old_fingerprint:
                raise SimError("IDEMPOTENCY_CONFLICT", "Idempotency key was used with different content", 409)
            return copy.deepcopy(old_response)
        selection = self.selections.pop(token, None)
        if not selection or selection["actor"] != actor:
            raise SimError("INVALID_SELECTION", "Selection is missing or belongs to another learner", 409)
        if time.time() > selection["expiresAt"]:
            raise SimError("SELECTION_EXPIRED", "Selection expired; select the device again", 409)
        if payload.get("expectedControlRevision") != self.control_revision or selection["controlRevision"] != self.control_revision:
            raise SimError("STALE_REVISION", "Control revision changed; select again", 409,
                           {"controlRevision": self.control_revision})
        device = self._device(selection["equipmentId"])
        failures = self._permissives(device, selection["action"])
        if failures:
            self._emit("command_refused", {"equipmentId": device["equipmentId"], "action": selection["action"], "reasons": failures})
            raise SimError(failures[0]["code"], failures[0]["message"], 422, failures)
        command_id = secrets.token_urlsafe(14)
        action = selection["action"]
        if action in {"open", "close"}:
            delay_key = "openDelayMs" if action == "open" else "closeDelayMs"
            delay = int(device.get("parameters", {}).get(delay_key, 0))
            if self.states[device["equipmentId"]].get("mechanismHealthy", True) is False:
                delay = int(device.get("parameters", {}).get("commandTimeoutMs", max(delay, 1)))
        else:
            delay = 0 if action == "reset_lockout" else TICK_MS
        command = {"commandId": command_id, "equipmentId": device["equipmentId"], "action": selection["action"],
                   "lifecycle": "accepted", "acceptedAtSimTimeMs": self.sim_time_ms,
                   "expectedCompletionSimTimeMs": self.sim_time_ms + delay, "indicationConfirmed": False,
                   "source": "simulation", "requestedValue": selection.get("requestedValue"),
                   "requestedUnit": selection.get("unit")}
        self.commands[command_id] = command
        if action in {"open", "close"}:
            self.states[device["equipmentId"]]["mechanismState"] = "opening" if action == "open" else "closing"
        if action == "close" and device["equipmentId"] == self.unit_sequence["generatorBreakerId"]:
            self.unit["sequenceState"] = "SYNCHRONIZING"
        self.pending.append({"due": self.sim_time_ms + delay, "commandId": command_id, "equipmentId": device["equipmentId"],
                             "action": action, "delay": delay, "requestedValue": selection.get("requestedValue"),
                             "purpose": "learner"})
        command["lifecycle"] = "executing" if delay else "accepted"
        self.control_revision += 1
        self._emit("command_accepted", {"commandId": command_id, "equipmentId": device["equipmentId"], "action": action})
        response = {**command, "controlRevision": self.control_revision, "stateRevision": self.state_revision,
                    "sessionId": self.session_id, "runId": self.run_id}
        self.idempotency[idem_key] = (fingerprint, copy.deepcopy(response))
        return response

    def tick(self) -> None:
        self.sim_time_ms += TICK_MS
        if self.unit.get("sequenceState") == "ONLINE" and self.states[self.unit_sequence["generatorBreakerId"]].get("position") == "closed":
            self.unit["energyMWh"] += max(0.0, self.unit.get("activeMW", 0)) * TICK_MS / 3_600_000
        for injection in list(self.scenario_injections):
            if int(injection.get("atSimTimeMs", 0)) > self.sim_time_ms:
                continue
            self.scenario_injections.remove(injection)
            if injection.get("type") == "mechanism_stuck" and injection.get("equipmentId") in self.states:
                self.states[injection["equipmentId"]]["mechanismHealthy"] = False
                self._emit("scenario_fault_injected", {"type": "mechanism_stuck", "equipmentId": injection["equipmentId"]})
            elif injection.get("type") == "freeze_observation" and injection.get("tagId"):
                self.active_faults[injection["tagId"]] = {"until": self.sim_time_ms + int(injection.get("durationMs") or 0)}
                self._emit("scenario_fault_injected", {"type": "freeze_observation", "tagId": injection["tagId"]})
        for pending in sorted(list(self.pending), key=lambda x: (x["due"], x["commandId"])):
            if pending["due"] > self.sim_time_ms:
                continue
            self.pending.remove(pending)
            command = self.commands[pending["commandId"]]
            device = self._device(pending["equipmentId"])
            state = self.states[pending["equipmentId"]]
            action = pending["action"]
            is_switch = action in {"open", "close"}
            if is_switch:
                state["mechanismState"] = state.get("position")
            failures = self._permissives(device, action) if pending.get("purpose", "learner") == "learner" else []
            if failures:
                command.update({"lifecycle": "cancelled", "failureReason": failures[0]["code"], "completedAtSimTimeMs": self.sim_time_ms})
                if device["equipmentId"] == self.unit_sequence["generatorBreakerId"] and action == "close":
                    self.unit["sequenceState"] = "READY_TO_SYNCHRONIZE"
                self._emit("command_cancelled", {"commandId": command["commandId"], "reason": failures[0]["code"]})
                self.control_revision += 1
                continue
            if is_switch and state.get("mechanismHealthy", True) is False:
                state["mechanismState"] = "failed"
                if device["equipmentId"] == self.unit_sequence["generatorBreakerId"] and action == "close":
                    self.unit["sequenceState"] = "READY_TO_SYNCHRONIZE"
                command.update({"lifecycle": "timed_out", "failureReason": "MECHANISM_FAILED", "completedAtSimTimeMs": self.sim_time_ms})
                self._emit("mechanism_failed", {"commandId": command["commandId"], "equipmentId": pending["equipmentId"]})
                self.control_revision += 1
                continue
            if is_switch:
                position = "closed" if action == "close" else "open"
                state["position"] = position
                state["mechanismState"] = position
                command.update({"lifecycle": "succeeded", "physicalOutcome": position,
                                "completedAtSimTimeMs": self.sim_time_ms, "indicationConfirmed": False})
                self._emit("mechanism_completed", {"commandId": command["commandId"], "equipmentId": pending["equipmentId"],
                                                    "position": position})
                if pending["equipmentId"] == self.unit_sequence["generatorBreakerId"]:
                    if action == "close" and self.unit["sequenceState"] == "SYNCHRONIZING":
                        self.unit["sequenceState"] = "ONLINE"
                        self.unit["sequenceElapsedMs"] = 0
                        self.states[self.unit_sequence["generatorId"]]["enabled"] = True
                        self.states[self.unit_sequence["turbineId"]]["gateDemandFraction"] = self.unit_sequence["assumptions"]["syncGateDemandFraction"]
                        self._emit("unit_sequence_step", {"unitId": self.unit_sequence["unitId"], "state": "ONLINE"})
                    elif action == "open" and pending.get("purpose") == "unit_stop":
                        self.unit["stopPhase"] = "rundown"
                        self.states[self.unit_sequence["generatorId"]]["enabled"] = False
                        self.states[self.unit_sequence["generatorId"]]["activeMW"] = 0.0
                    elif action == "open" and pending.get("purpose") == "protection":
                        self.states[self.unit_sequence["generatorId"]]["enabled"] = False
                        self.states[self.unit_sequence["generatorId"]]["activeMW"] = 0.0
                        self.states[self.unit_sequence["turbineId"]]["gateDemandFraction"] = 0.0
                    elif action == "open" and pending.get("purpose") == "learner" and self.unit["sequenceState"] == "ONLINE":
                        self.unit["sequenceState"] = "LOCKED_OUT"
                        self.unit["tripCause"] = "GENERATOR_BREAKER_OPENED"
                        state["lockout"] = True
                        self.states[self.unit_sequence["turbineId"]]["gateDemandFraction"] = 0.0
                        self._emit("unit_protection_operated", {"unitId": self.unit_sequence["unitId"]})
            else:
                self._apply_unit_action(action, pending.get("requestedValue"), pending["equipmentId"])
                command.update({"lifecycle": "succeeded", "completedAtSimTimeMs": self.sim_time_ms,
                                "indicationConfirmed": True})
                self._emit("unit_command_completed", {"commandId": command["commandId"], "action": action,
                                                        "unitId": self.unit_sequence["unitId"]})
            self.control_revision += 1
        self._advance_unit()
        self._expire_faults()
        hydro_step(self.model, self.states, TICK_MS / 1000)
        turbine_state = self.states.get(self.unit_sequence["turbineId"], {})
        self.unit["netHeadM"] = float(turbine_state.get("netHeadM", 0))
        self.unit["activeMW"] = float(self.states[self.unit_sequence["generatorId"]].get("activeMW", 0))
        self.unit["flowM3S"] = float(turbine_state.get("flowM3S", 0))
        self._settle()
        self._evaluate_protection_rules()

    def _expire_faults(self) -> None:
        fault = self.faults.get("load_overcurrent")
        if fault and self.sim_time_ms >= fault["untilSimTimeMs"]:
            load_id = next(item["equipmentId"] for item in self.model["equipment"] if item["type"] == "load")
            self.states[load_id].pop("faultActiveMW", None)
            del self.faults["load_overcurrent"]
            self._emit("instructor_fault_expired", {"type": "load_overcurrent"})

    def clock(self, action: str, speed: int | None = None) -> dict[str, Any]:
        if action == "pause":
            self.status = "paused"
        elif action == "run":
            self.status = "running"
        elif action == "step":
            self.status = "paused"
            self.tick()
        elif action == "speed" and speed in {1, 5, 10}:
            self.speed = speed
        else:
            raise SimError("INVALID_CLOCK_ACTION", "Expected run, pause, step, or speed (1, 5, 10)")
        self.control_revision += 1
        self._emit("clock_changed", {"action": action, "status": self.status, "speed": self.speed})
        return self.snapshot()

    def snapshot(self) -> dict[str, Any]:
        by_device = {item["equipmentId"]: item for item in self.model["equipment"]}
        node_observations: dict[str, dict[str, Any]] = {}
        switch_observations: dict[str, dict[str, Any]] = {}
        for tag in self.model.get("tags", []):
            observation = copy.deepcopy(self.observations.get(tag["tagId"], {}))
            if not observation:
                continue
            path = tag["source"].split(".")
            node_id = path[1] if path[0] == "node" and len(path) == 3 else None
            if path[0] == "equipment" and len(path) == 3 and path[-1] == "voltageKVLL" and by_device.get(path[1], {}).get("type") == "bus":
                node_id = by_device[path[1]]["terminals"][0]["nodeId"]
            if node_id:
                energized = "indeterminate"
                if observation.get("quality") == "good" and isinstance(observation.get("value"), (int, float)):
                    energized = "energized" if observation["value"] > 0.05 else "deenergized"
                node_observations[node_id] = {"energization": energized, "voltageKVLL": observation.get("value"),
                                              "quality": observation.get("quality"), "observedSimTimeMs": observation.get("observedSimTimeMs")}
            if path[0] == "equipment" and len(path) == 3 and path[-1] == "position":
                switch_observations[path[1]] = observation
        return {"source": "simulation", "sessionId": self.session_id, "runId": self.run_id,
                "modelId": self.model["modelId"], "modelRevision": self.model["revision"],
                "modelHash": self.model_hash, "scenarioId": self.scenario["scenarioId"],
                "scenarioHash": self.scenario_hash, "rulesHash": self.rule_hash,
                "unitSequenceId": self.unit_sequence["sequenceId"], "unitSequenceHash": self.unit_hash,
                "engineVersion": ENGINE_VERSION,
                "readiness": self.model["readiness"], "simTimeMs": self.sim_time_ms,
                "stateRevision": self.state_revision, "controlRevision": self.control_revision,
                "status": self.status, "speed": self.speed,
                "sessionMode": "SOLO LOCAL — LEARNER + INSTRUCTOR" if self.instructor_enabled else "LEARNER",
                "tags": copy.deepcopy(self.truth["tags"]),
                "commands": [{key: value for key, value in command.items()
                              if key not in {"physicalOutcome", "failureReason"}}
                             for command in self.commands.values()],
                "alarms": copy.deepcopy(self.alarm_occurrences),
                "debriefs": [{key: value for key, value in item.items() if key != "events"} for item in self.debriefs],
                "diagram": {"nodes": copy.deepcopy(self.model["nodes"]), "nodeObservations": node_observations, "equipment": [
                    {"equipmentId": item["equipmentId"], "type": item["type"],
                     "terminals": copy.deepcopy(item.get("terminals", [])),
                     "reportedPosition": switch_observations.get(item["equipmentId"], {}).get("value"),
                     "indicationQuality": switch_observations.get(item["equipmentId"], {}).get("quality", "missing"),
                     "indicationObservedSimTimeMs": switch_observations.get(item["equipmentId"], {}).get("observedSimTimeMs")}
                    for item in self.model["equipment"] if item.get("terminals")
                ]},
                "equipment": [{"equipmentId": item["equipmentId"], "type": item["type"],
                               "reportedPosition": switch_observations.get(item["equipmentId"], {}).get("value"),
                               "indicationQuality": switch_observations.get(item["equipmentId"], {}).get("quality", "missing"),
                               "indicationObservedSimTimeMs": switch_observations.get(item["equipmentId"], {}).get("observedSimTimeMs")}
                              for item in self.model["equipment"]
                              if item["type"] in {"breaker", "isolator", "earth_switch"}]}
