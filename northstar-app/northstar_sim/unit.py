"""Validation and reduced-order unit/synchronizing helpers for synthetic exercises."""
from __future__ import annotations

import copy
import math
from typing import Any

from .model import content_hash

UNIT_SCHEMA = "northstar.synthetic-unit-sequence.v1"


def validate_unit_sequence(data: dict[str, Any], model: dict[str, Any]) -> tuple[dict[str, Any], str]:
    if not isinstance(data, dict) or data.get("schemaVersion") != UNIT_SCHEMA or data.get("synthetic") is not True:
        raise ValueError(f"expected a synthetic {UNIT_SCHEMA} sequence")
    equipment = {item["equipmentId"]: item for item in model.get("equipment", [])}
    for field in ("unitId", "generatorId", "turbineId", "reservoirId", "generatorBreakerId"):
        if data.get(field) not in equipment:
            raise ValueError(f"unit sequence {field} does not resolve to model equipment")
    if equipment[data["generatorId"]]["type"] != "generator" or equipment[data["generatorBreakerId"]]["type"] != "breaker":
        raise ValueError("unit sequence must bind one generator and its breaker")
    assumptions = data.get("assumptions", {})
    for key in ("ratedSpeedRpm", "speedRampRpmPerSecond", "speedRundownRpmPerSecond", "ratedVoltageKVLL",
                "voltageBuildKVPerSecond", "syncVoltageToleranceFraction", "syncFrequencyToleranceHz",
                "syncPhaseToleranceDegrees", "minimumHpuPressureKPa", "initialHpuPressureKPa",
                "ratedFieldCurrentA", "fieldCurrentRateAperSecond", "minReactiveMvar", "maxReactiveMvar"):
        value = assumptions.get(key)
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
            raise ValueError(f"unit sequence assumption {key} must be finite")
    if assumptions["ratedSpeedRpm"] <= 0 or assumptions["ratedVoltageKVLL"] <= 0:
        raise ValueError("rated speed and voltage must be positive")
    if not 0 <= assumptions["syncVoltageToleranceFraction"] <= 0.2:
        raise ValueError("sync voltage window must be between 0 and 20 percent")
    if assumptions["minReactiveMvar"] > assumptions["maxReactiveMvar"]:
        raise ValueError("reactive-power limits are reversed")
    states = data.get("states", [])
    required = {"STOPPED", "START_CHECK", "STARTING", "READY_TO_SYNCHRONIZE", "SYNCHRONIZING", "ONLINE", "STOPPING", "TRIPPED", "LOCKED_OUT"}
    if not isinstance(states, list) or not required.issubset(set(states)) or len(states) != len(set(states)):
        raise ValueError("unit sequence must declare every required state exactly once")
    return copy.deepcopy(data), content_hash(data)


def initial_unit_state(data: dict[str, Any]) -> dict[str, Any]:
    assumptions = data["assumptions"]
    return {
        "sequenceState": "STOPPED", "sequenceElapsedMs": 0, "stopPhase": "",
        "remote": True, "brakesApplied": True, "speedRpm": 0.0, "frequencyHz": 0.0,
        "voltageKVLL": 0.0, "phaseDegrees": float(assumptions["syncPhaseInitialDegrees"]),
        "fieldCurrentA": 0.0, "hpuPressureKPa": float(assumptions["initialHpuPressureKPa"]),
        "bearingTemperatureC": float(assumptions["bearingAmbientC"]), "requestedMW": 0.0,
        "activeMW": 0.0, "requestedMvar": 0.0, "currentA": 0.0, "powerFactor": 1.0,
        "energyMWh": 0.0, "tailwaterM": 100.0, "netHeadM": 20.0, "gateFraction": 0.0,
        "syncCheckPassed": False,
        "tripCause": None, "overloadFaultUntilSimTimeMs": None,
    }


def sync_check(unit: dict[str, Any], bus_voltage_kv: float | None, bus_frequency_hz: float,
               bus_phase_degrees: float, data: dict[str, Any]) -> tuple[bool, dict[str, float | str]]:
    assumptions = data["assumptions"]
    voltage = float(unit.get("voltageKVLL", 0))
    frequency = float(unit.get("frequencyHz", 0))
    phase = float(unit.get("phaseDegrees", 0))
    if bus_voltage_kv is None or bus_voltage_kv <= float(assumptions["deadBusVoltageKVLL"]):
        # This fixture's generator is grid-following, not a black-start source.
        return False, {"mode": "dead_bus_unsupported", "unitVoltageKVLL": voltage, "frequencyDifferenceHz": frequency,
                        "phaseDifferenceDegrees": phase}
    diff_v = abs(voltage - bus_voltage_kv) / max(abs(bus_voltage_kv), 1e-9)
    diff_f = abs(frequency - bus_frequency_hz)
    diff_phase = abs((phase - bus_phase_degrees + 180) % 360 - 180)
    passed = (diff_v <= float(assumptions["syncVoltageToleranceFraction"])
              and diff_f <= float(assumptions["syncFrequencyToleranceHz"])
              and diff_phase <= float(assumptions["syncPhaseToleranceDegrees"]))
    return passed, {"mode": "live_bus", "voltageDifferenceFraction": diff_v,
                    "frequencyDifferenceHz": diff_f, "phaseDifferenceDegrees": diff_phase}
