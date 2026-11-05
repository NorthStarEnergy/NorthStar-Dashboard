from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from northstar_sim.electrical import solve_radial
from northstar_sim.engine import Session, SimError
from northstar_sim.hydro import hydro_step
from northstar_sim.model import ModelError, catalog_only_models, load_model
from northstar_sim.service import SimulatorService

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "northstar_sim" / "fixtures"


class ModelContractTests(unittest.TestCase):
    def test_synthetic_fixture_loads_and_hashes_deterministically(self):
        model, first = load_model(FIXTURES / "synthetic-station.model.json")
        _, second = load_model(copy.deepcopy(model))
        self.assertEqual(first, second)
        self.assertTrue(model["synthetic"])

    def test_duplicate_equipment_and_dangling_terminal_are_rejected(self):
        model, _ = load_model(FIXTURES / "synthetic-station.model.json")
        broken = copy.deepcopy(model)
        broken["equipment"].append(copy.deepcopy(broken["equipment"][0]))
        broken["equipment"][1]["terminals"][0]["nodeId"] = "NOT-A-NODE"
        with self.assertRaises(ModelError) as raised:
            load_model(broken)
        self.assertTrue(any("duplicate equipment ID" in issue["message"] for issue in raised.exception.issues))
        self.assertTrue(any("unknown node" in issue["message"] for issue in raised.exception.issues))

    def test_live_tag_bindings_are_rejected_before_session_creation(self):
        model, _ = load_model(FIXTURES / "synthetic-station.model.json")
        broken = copy.deepcopy(model)
        broken["tags"][0]["source"] = "live://operational-scada/CB1"
        with self.assertRaises(ModelError) as raised:
            load_model(broken)
        self.assertTrue(any(issue["path"] == "tags[0].source" for issue in raised.exception.issues))

    def test_twenty_catalog_stations_are_not_launchable_models(self):
        stations = catalog_only_models(FIXTURES / "station-catalog.json")
        self.assertEqual(len(stations), 20)
        self.assertEqual(len({station["siteId"] for station in stations}), 20)
        self.assertTrue(all(station["readiness"] == "catalog_only" and not station["canLaunch"] for station in stations))
        self.assertNotIn("site:system-transmission", {station["siteId"] for station in stations})


class SimulationPhysicsTests(unittest.TestCase):
    def setUp(self):
        self.model, _ = load_model(FIXTURES / "synthetic-station.model.json")
        self.scenarios = {row["scenarioId"]: row for row in json.loads((FIXTURES / "scenarios.json").read_text(encoding="utf-8"))["scenarios"]}

    def test_radial_solver_updates_bus_voltage_and_branch_current(self):
        states = {item["equipmentId"]: copy.deepcopy(item.get("initialState", {})) for item in self.model["equipment"]}
        result = solve_radial(self.model, states)
        self.assertEqual(result["nodes"]["BUS"]["energization"], "energized")
        self.assertLess(result["nodes"]["BUS"]["voltageKVLL"], 6.6)
        self.assertGreater(result["branches"]["L1"]["currentA"], 0)
        self.assertGreaterEqual(result["branches"]["L1"]["lossMW"], 0)

    def test_backfeed_remains_energized_after_upstream_breaker_opens(self):
        session = Session(self.model, self.scenarios["BACKFEED"], "learner", 101)
        session.states["CB1"]["position"] = "open"
        session._settle()
        self.assertEqual(session.truth["electrical"]["nodes"]["BUS"]["energization"], "energized")

    def test_breaker_travel_completes_at_exact_300_ms_tick(self):
        session = Session(self.model, self.scenarios["NORMAL-OPEN"], "learner", 1)
        session.status = "running"
        selected = session.select("learner", {"equipmentId": "CB1", "action": "open",
                                               "expectedControlRevision": session.control_revision})
        command = session.execute("learner", {"selectionToken": selected["selectionToken"],
                                               "expectedControlRevision": selected["controlRevision"],
                                               "idempotencyKey": "open-1"})
        session.tick(); session.tick()
        self.assertEqual(session.states["CB1"]["position"], "closed")
        self.assertEqual(session.commands[command["commandId"]]["lifecycle"], "executing")
        session.tick()
        self.assertEqual(session.sim_time_ms, 300)
        self.assertEqual(session.states["CB1"]["position"], "open")
        self.assertEqual(session.commands[command["commandId"]]["lifecycle"], "succeeded")

    def test_stuck_breaker_times_out_without_claiming_physical_success(self):
        session = Session(self.model, self.scenarios["STUCK-MECHANISM"], "learner", 102)
        session.status = "running"
        selected = session.select("learner", {"equipmentId": "CB1", "action": "open",
                                               "expectedControlRevision": session.control_revision})
        command = session.execute("learner", {"selectionToken": selected["selectionToken"],
                                               "expectedControlRevision": selected["controlRevision"],
                                               "idempotencyKey": "stuck-open"})
        self.assertEqual(command["expectedCompletionSimTimeMs"], 3000)
        for _ in range(29):
            session.tick()
        self.assertEqual(session.states["CB1"]["position"], "closed")
        session.tick()
        outcome = session.commands[command["commandId"]]
        self.assertEqual(outcome["lifecycle"], "timed_out")
        self.assertNotIn("physicalOutcome", outcome)

    def test_earth_switch_refuses_closure_onto_energized_bus(self):
        session = Session(self.model, self.scenarios["NORMAL-OPEN"], "learner", 1)
        session.status = "running"
        selected = session.select("learner", {"equipmentId": "ES1", "action": "close",
                                               "expectedControlRevision": session.control_revision})
        self.assertEqual(selected["permissives"][0]["code"], "GROUND_PRESENT")

    def test_telemetry_observes_at_declared_scan_rate(self):
        session = Session(self.model, self.scenarios["NORMAL-OPEN"], "learner", 1)
        session.states["CB1"]["position"] = "open"
        session.tick()
        sample = next(item for item in session.truth["tags"] if item["tagId"] == "sim.CB1.position")
        self.assertEqual(sample["value"], "closed")
        self.assertEqual(sample["observedSimTimeMs"], 0)
        for _ in range(9):
            session.tick()
        sample = next(item for item in session.truth["tags"] if item["tagId"] == "sim.CB1.position")
        self.assertEqual(sample["value"], "open")
        self.assertEqual(sample["observedSimTimeMs"], 1000)

    def test_low_voltage_alarm_pickup_acknowledgement_and_return_state(self):
        session = Session(self.model, self.scenarios["NORMAL-OPEN"], "learner", 1)
        session.states["CB1"]["position"] = "open"
        session.status = "running"
        for _ in range(20):
            session.tick()
        self.assertEqual(session.alarm_occurrences[0]["state"], "active_unacknowledged")
        occurrence = session.acknowledge_alarm(session.alarm_occurrences[0]["occurrenceId"])
        self.assertEqual(occurrence["state"], "active_acknowledged")
        session.states["CB1"]["position"] = "closed"
        for _ in range(20):
            session.tick()
        self.assertEqual(session.alarm_occurrences[0]["state"], "returned_acknowledged")

    def test_command_selection_refuses_local_control_and_client_role(self):
        session = Session(self.model, self.scenarios["NORMAL-OPEN"], "learner", 1)
        session.status = "running"
        session.states["CB1"]["remote"] = False
        selected = session.select("learner", {"equipmentId": "CB1", "action": "open",
                                               "expectedControlRevision": session.control_revision})
        self.assertEqual(selected["permissives"][0]["code"], "LOCAL_CONTROL")
        with self.assertRaises(SimError) as raised:
            session.select("learner", {"actor": "admin", "equipmentId": "CB1", "action": "open",
                                        "expectedControlRevision": session.control_revision})
        self.assertEqual(raised.exception.code, "CLIENT_IDENTITY_FORBIDDEN")

    def test_frozen_feedback_does_not_change_physical_topology(self):
        session = Session(self.model, self.scenarios["STALE-STATUS"], "learner", 103)
        session.status = "running"
        for _ in range(10):
            session.tick()
        session.states["CB1"]["position"] = "open"
        session._settle()
        self.assertEqual(session.truth["electrical"]["nodes"]["BUS"]["energization"], "deenergized")
        for _ in range(35):
            session.tick()
        sample = next(item for item in session.truth["tags"] if item["tagId"] == "sim.CB1.position")
        self.assertEqual(sample["quality"], "stale")
        self.assertEqual(sample["value"], "closed")

    def test_learner_snapshot_does_not_expose_hidden_mechanism_truth(self):
        session = Session(self.model, self.scenarios["STALE-STATUS"], "learner", 103)
        session.states["CB1"]["position"] = "open"
        session.active_faults["sim.CB1.position"] = {"until": 10000}
        session._settle()
        snapshot = session.snapshot()
        breaker = next(item for item in snapshot["diagram"]["equipment"] if item["equipmentId"] == "CB1")
        self.assertEqual(breaker["reportedPosition"], "closed")
        self.assertEqual(breaker["indicationQuality"], "good")
        self.assertNotIn("electrical", snapshot)
        self.assertNotIn("truth", snapshot)
        self.assertNotIn("position", snapshot["equipment"][0])

    def test_hydro_energy_and_mass_balance_step(self):
        model = copy.deepcopy(self.model)
        states = {item["equipmentId"]: copy.deepcopy(item.get("initialState", {})) for item in model["equipment"]}
        states["TUR1"]["gateFraction"] = 1
        hydro_step(model, states, 2.0)
        self.assertAlmostEqual(states["TUR1"]["hydraulicPowerMW"], 1.765197, places=5)
        self.assertAlmostEqual(states["POND1"]["storageM3"], 50000 + (12 - 10 - 1) * 2, places=6)


class SimulatorServiceTests(unittest.TestCase):
    def test_dedicated_store_and_session_owner_boundary(self):
        with tempfile.TemporaryDirectory() as folder:
            service = SimulatorService(folder, background=False)
            status, created = service.handle("POST", "/api/training/switching/sessions", {"scenarioId": "NORMAL-OPEN"}, "operator-a")
            self.assertEqual(status, 201)
            denied, body = service.handle("GET", f"/api/training/switching/sessions/{created['sessionId']}", None, "operator-b")
            self.assertEqual(denied, 403)
            hidden, _ = service.handle("GET", f"/api/training/switching/sessions/{created['sessionId']}/instructor-state", None, "operator-a")
            self.assertEqual(hidden, 404)
            self.assertTrue((Path(folder) / "simulator.sqlite3").exists())
            self.assertNotEqual(Path(folder) / "simulator.sqlite3", ROOT / "data" / "northstar.db")

    def test_pending_command_and_idempotent_retry_survive_restart_paused(self):
        with tempfile.TemporaryDirectory() as folder:
            service = SimulatorService(folder, background=False)
            _, created = service.handle("POST", "/api/training/switching/sessions", {"scenarioId": "NORMAL-OPEN"}, "operator-a")
            session = service.sessions[created["sessionId"]]
            session.status = "running"
            selected = session.select("operator-a", {"equipmentId": "CB1", "action": "open",
                                                       "expectedControlRevision": session.control_revision})
            command_payload = {"selectionToken": selected["selectionToken"],
                               "expectedControlRevision": selected["controlRevision"], "idempotencyKey": "restart-open"}
            _, accepted = service.handle("POST", f"/api/training/switching/sessions/{session.session_id}/commands",
                                         command_payload, "operator-a")
            recovered = SimulatorService(folder, background=False)
            restored = recovered.sessions[session.session_id]
            self.assertEqual(restored.status, "paused")
            self.assertEqual(restored.pending[0]["commandId"], accepted["commandId"])
            status, duplicate = recovered.handle("POST", f"/api/training/switching/sessions/{session.session_id}/commands",
                                                 command_payload, "operator-a")
            self.assertEqual(status, 202)
            self.assertEqual(duplicate["commandId"], accepted["commandId"])

    def test_finish_and_reset_retain_simulation_debrief(self):
        with tempfile.TemporaryDirectory() as folder:
            service = SimulatorService(folder, background=False)
            _, created = service.handle("POST", "/api/training/switching/sessions", {"scenarioId": "NORMAL-OPEN"}, "operator-a")
            session = service.sessions[created["sessionId"]]
            session.states["CB1"]["position"] = "open"
            session._settle()
            status, debrief = service.handle("POST", f"/api/training/switching/sessions/{session.session_id}/finish",
                {"expectedControlRevision": session.control_revision, "idempotencyKey": "finish-1"}, "operator-a")
            self.assertEqual(status, 200)
            self.assertTrue(debrief["notAProcedure"])
            status, reset = service.handle("POST", f"/api/training/switching/sessions/{session.session_id}/reset",
                {"expectedControlRevision": session.control_revision, "idempotencyKey": "reset-1"}, "operator-a")
            self.assertEqual(status, 200)
            self.assertEqual(reset["status"], "paused")
            self.assertEqual(len(session.debriefs), 1)


if __name__ == "__main__":
    unittest.main()
