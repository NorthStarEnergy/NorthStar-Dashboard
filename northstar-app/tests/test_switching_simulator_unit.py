from __future__ import annotations

import json
from pathlib import Path

import pytest

from northstar_sim.engine import Session
from northstar_sim.model import load_model
from northstar_sim.service import SimulatorService

FIXTURES = Path(__file__).resolve().parents[1] / "northstar_sim" / "fixtures"


def make_session():
    model, _ = load_model(FIXTURES / "synthetic-station.model.json")
    scenarios = json.loads((FIXTURES / "scenarios.json").read_text(encoding="utf-8"))["scenarios"]
    session = Session(model, next(item for item in scenarios if item["scenarioId"] == "UNIT-STARTUP"), "learner", 1, local_instructor=True)
    session.status = "running"
    return session


def command(session, equipment, action, **extra):
    selection = session.select("learner", {"equipmentId": equipment, "action": action,
                                            "expectedControlRevision": session.control_revision, **extra})
    assert not selection["permissives"], selection["permissives"]
    result = session.execute("learner", {"selectionToken": selection["selectionToken"],
                                         "expectedControlRevision": selection["controlRevision"],
                                         "idempotencyKey": f"command-{len(session.commands)}"})
    return result["commandId"]


def advance_until(session, predicate, limit=1200):
    for _ in range(limit):
        if predicate():
            return
        session.tick()
    pytest.fail(f"condition not reached; unit={session.unit}, pending={session.pending}")


def online(session):
    command(session, "GEN1", "start")
    advance_until(session, lambda: session.unit["sequenceState"] == "READY_TO_SYNCHRONIZE" and session.unit["syncCheckPassed"])
    command_id = command(session, "GB1", "close")
    advance_until(session, lambda: session.commands[command_id]["lifecycle"] != "executing")
    assert session.commands[command_id]["lifecycle"] == "succeeded"
    assert session.states["GB1"]["position"] == "closed"
    assert session.unit["sequenceState"] == "ONLINE"


def test_start_sync_ramp_stop():
    session = make_session()
    early = session.select("learner", {"equipmentId": "GB1", "action": "close", "expectedControlRevision": session.control_revision})
    assert any(item["code"] == "SYNC_NOT_MET" for item in early["permissives"])
    online(session)
    command(session, "GEN1", "setpoint", requestedValue=1.0, unit="MW")
    advance_until(session, lambda: session.unit["activeMW"] >= 0.5)
    assert session.states["TUR1"]["flowM3S"] > 0
    assert session.unit["energyMWh"] > 0
    command(session, "GEN1", "stop")
    advance_until(session, lambda: session.unit["sequenceState"] == "STOPPED")
    assert session.states["GB1"]["position"] == "open"
    assert session.unit["brakesApplied"]
    assert session.unit["activeMW"] == 0
    debrief = session.finish()
    assert debrief["objectiveAchieved"]
    assert debrief["rulesHash"] == session.rule_hash
    assert debrief["unitSequenceHash"] == session.unit_hash


def test_injected_overload_trip_and_reset():
    session = make_session()
    online(session)
    session._inject_local_overload(5000)
    advance_until(session, lambda: session.states["CB1"]["position"] == "open")
    advance_until(session, lambda: session.states["GB1"]["position"] == "open")
    assert session.unit["sequenceState"] == "LOCKED_OUT"
    assert session.states["CB1"]["lockout"] and session.states["GB1"]["lockout"]
    advance_until(session, lambda: not session.faults)
    command(session, "CB1", "reset_lockout")
    session.tick()
    assert not session.states["CB1"]["lockout"]
    assert session.states["GB1"]["lockout"]
    command(session, "GB1", "reset_lockout")
    advance_until(session, lambda: session.unit["sequenceState"] == "STOPPED")
    assert not session.states["GB1"]["lockout"]


def test_reactive_demand_requires_online_and_changes_calculated_current():
    session = make_session()
    refused = session.select("learner", {"equipmentId": "GEN1", "action": "set_mvar", "requestedValue": 0.3,
        "unit": "Mvar", "expectedControlRevision": session.control_revision})
    assert any(item["code"] == "UNIT_NOT_ONLINE" for item in refused["permissives"])
    online(session)
    command(session, "GEN1", "set_mvar", requestedValue=0.3, unit="Mvar")
    session.tick()
    assert session.states["GEN1"]["reactiveMvar"] == 0.3
    assert session.unit["currentA"] > 20


def test_delayed_close_rechecks_sync_and_frozen_feedback_does_not_confirm():
    session = make_session()
    command(session, "GEN1", "start")
    advance_until(session, lambda: session.unit["syncCheckPassed"])
    closing = command(session, "GB1", "close")
    session.unit["phaseDegrees"] = 90
    for _ in range(5):
        session.tick()
    assert session.commands[closing]["lifecycle"] == "cancelled"
    assert session.states["GB1"]["position"] == "open"
    session.unit["phaseDegrees"] = 0
    session.active_faults["sim.GB1.position"] = {"until": session.sim_time_ms + 10000}
    closing = command(session, "GB1", "close")
    for _ in range(5):
        session.tick()
    assert session.states["GB1"]["position"] == "closed"
    assert session.commands[closing]["lifecycle"] == "succeeded"
    assert not session.commands[closing]["indicationConfirmed"]
    assert session.observations["sim.GB1.position"]["value"] == "open"


def test_instructor_endpoints_require_each_request_and_are_revoked_on_restore(tmp_path):
    service = SimulatorService(tmp_path, background=False, local_instructor=True)
    _, created = service.handle("POST", "/api/training/switching/sessions", {"scenarioId": "UNIT-TRIP"}, "local", instructor_access=True)
    path = f"/api/training/switching/sessions/{created['sessionId']}"
    assert service.handle("GET", path + "/instructor-state", None, "local")[0] == 404
    assert service.handle("GET", path + "/instructor-state", None, "local", instructor_access=True)[0] == 200
    request = {"type": "load_overcurrent", "durationMs": 5000, "expectedControlRevision": created["controlRevision"], "idempotencyKey": "fault-1"}
    assert service.handle("POST", path + "/faults", request, "local")[0] == 404
    assert service.handle("POST", path + "/faults", request, "local", instructor_access=True)[0] == 200
    assert service.handle("POST", path + "/faults", {**request, "durationMs": 3000}, "local", instructor_access=True)[0] == 409
    restored = SimulatorService(tmp_path, background=False, local_instructor=False)
    assert restored.handle("GET", path + "/instructor-state", None, "local", instructor_access=True)[0] == 404
