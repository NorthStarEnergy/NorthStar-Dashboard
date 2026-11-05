from __future__ import annotations

import copy
import json
import os
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

from .engine import ENGINE_VERSION, Session, SimError, TICK_MS
from .model import ModelError, catalog_only_models, content_hash, load_model
from .rules import RuleSet
from .unit import validate_unit_sequence
from .complex import ComplexSession, MODEL_ID as COMPLEX_ID

HERE = Path(__file__).resolve().parent
MODEL_PATH = HERE / "fixtures" / "synthetic-station.model.json"
SCENARIOS_PATH = HERE / "fixtures" / "scenarios.json"
RULES_PATH = HERE / "fixtures" / "synthetic-rules.json"
UNIT_SEQUENCE_PATH = HERE / "fixtures" / "synthetic-unit-sequence.json"
CATALOG_PATH = HERE / "fixtures" / "station-catalog.json"
PREFIX = "/api/training/switching"


class SimulatorService:
    """Simulation-only session registry and persistence; it has no OT or operational-store imports."""

    def __init__(self, root: str | Path | None = None, *, background: bool = True, local_instructor: bool = False):
        self.root = Path(root or os.environ.get("NORTHSTAR_SIM_ROOT", str(Path.home() / "AppData" / "Local" / "NorthStar" / "TrainingSimulator")))
        self.root.mkdir(parents=True, exist_ok=True)
        self.database = self.root / "simulator.sqlite3"
        self.lock = threading.RLock()
        self.sessions: dict[str, Session] = {}
        self.session_locks: dict[str, threading.RLock] = {}
        self.model, self.model_hash = load_model(MODEL_PATH)
        self.rules = json.loads(RULES_PATH.read_text(encoding="utf-8"))
        self.rule_set = RuleSet(self.model, self.rules)
        raw_unit_sequence = json.loads(UNIT_SEQUENCE_PATH.read_text(encoding="utf-8"))
        self.unit_sequence, self.unit_hash = validate_unit_sequence(raw_unit_sequence, self.model)
        self.rule_hash = content_hash(self.rules)
        self.local_instructor = bool(local_instructor)
        self.scenarios = {item["scenarioId"]: item for item in json.loads(SCENARIOS_PATH.read_text(encoding="utf-8"))["scenarios"]}
        self.complex_model, self.complex_hash = load_model(HERE / 'fixtures' / 'twin-iroquois.model.json')
        self.scenarios.update({item['scenarioId']: item for item in json.loads((HERE / 'fixtures' / 'twin-iroquois-scenarios.json').read_text(encoding='utf-8'))['scenarios']})
        self._init_store()
        self._restore_sessions()
        if background:
            self.thread = threading.Thread(target=self._clock_loop, name="northstar-simulator-clock", daemon=True)
            self.thread.start()

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.database, timeout=5)
        db.row_factory = sqlite3.Row
        return db

    @contextmanager
    def _db(self):
        db = self._connect()
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def _init_store(self) -> None:
        with self._db() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS sessions(
                    session_id TEXT PRIMARY KEY, owner TEXT NOT NULL, status TEXT NOT NULL,
                    model_hash TEXT NOT NULL, scenario_hash TEXT NOT NULL, payload TEXT NOT NULL,
                    updated_utc TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS events(
                    session_id TEXT NOT NULL, sequence INTEGER NOT NULL, sim_time_ms INTEGER NOT NULL,
                    kind TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(session_id, sequence)
                );
                CREATE INDEX IF NOT EXISTS events_session_time ON events(session_id, sim_time_ms);
            """)

    @staticmethod
    def _dump(session: Session) -> str:
        data = {key: copy.deepcopy(getattr(session, key)) for key in (
            "model", "model_hash", "scenario", "scenario_hash", "owner", "session_id", "run_id", "seed",
            "sim_time_ms", "state_revision", "control_revision", "status", "speed", "sequence", "states",
            "pending", "commands", "events", "observations", "truth", "alarm_active", "scenario_injections", "active_faults", "idempotency",
            "alarm_occurrences", "low_voltage_since", "low_voltage_clear_since", "debriefs",
            "rule_data", "rule_hash", "unit_sequence", "unit_hash", "unit", "instructor_enabled", "faults",
            "rule_runtime_since", "rule_runtime_clear_since", "rule_runtime_latched")}
        data["status"] = "paused" if session.status == "running" else session.status
        return json.dumps(data, separators=(",", ":"), allow_nan=False)

    def _save(self, session: Session, new_events: list[dict[str, Any]] | None = None) -> None:
        payload = self._dump(session)
        with self._db() as db:
            db.execute("INSERT INTO sessions(session_id,owner,status,model_hash,scenario_hash,payload) VALUES(?,?,?,?,?,?) "
                       "ON CONFLICT(session_id) DO UPDATE SET status=excluded.status, payload=excluded.payload, updated_utc=CURRENT_TIMESTAMP",
                       (session.session_id, session.owner, "paused" if session.status == "running" else session.status,
                        session.model_hash, session.scenario_hash, payload))
            if new_events:
                db.executemany("INSERT OR IGNORE INTO events(session_id,sequence,sim_time_ms,kind,payload) VALUES(?,?,?,?,?)",
                               [(session.session_id, event["sequence"], event["simTimeMs"], event["kind"],
                                 json.dumps(event, separators=(",", ":"), allow_nan=False)) for event in new_events])

    def _restore_sessions(self) -> None:
        with self._db() as db:
            rows = db.execute("SELECT payload FROM sessions WHERE status IN ('paused','running')").fetchall()
        for row in rows:
            data = json.loads(row["payload"])
            scenario = data["scenario"]
            session_class = ComplexSession if data['model']['modelId'] == COMPLEX_ID else Session
            session = session_class(data["model"], scenario, data["owner"], data["seed"],
                              data.get("rule_data"), data.get("unit_sequence"), data.get("instructor_enabled", False))
            for key, value in data.items():
                if hasattr(session, key):
                    setattr(session, key, value)
            session.instructor_enabled = bool(session.instructor_enabled and self.local_instructor)
            session.status = "paused"
            session.selections = {}
            self.sessions[session.session_id] = session
            self.session_locks[session.session_id] = threading.RLock()

    def _clock_loop(self) -> None:
        last = time.monotonic()
        accumulator: dict[str, float] = {}
        while True:
            now = time.monotonic()
            wall_elapsed = now - last
            last = now
            with self.lock:
                sessions = list(self.sessions.values())
            if wall_elapsed > 0.25:
                for session in sessions:
                    if session.status == "running":
                        with self.session_locks[session.session_id]:
                            session.status = "paused"
                            event = session._emit("host_stall_paused", {"lagMs": round(wall_elapsed * 1000)})
                            self._save(session, [event])
                    accumulator.pop(session.session_id, None)
                time.sleep(0.01)
                continue
            elapsed = wall_elapsed
            for session in sessions:
                if session.status != "running":
                    accumulator.pop(session.session_id, None)
                    continue
                lock = self.session_locks[session.session_id]
                with lock:
                    accumulator[session.session_id] = accumulator.get(session.session_id, 0.0) + elapsed * 1000 * session.speed
                    if accumulator[session.session_id] > 1000:
                        session.status = "paused"
                        session._emit("host_stall_paused", {"lagMs": round(accumulator[session.session_id])})
                        self._save(session, session.events[-1:])
                        accumulator[session.session_id] = 0
                        continue
                    new_events = []
                    before_sequence = session.sequence
                    while accumulator[session.session_id] >= TICK_MS and session.status == "running":
                        try:
                            session.tick()
                        except Exception as exc:
                            session.status = "failed"
                            session._emit("engine_failed", {"reason": type(exc).__name__})
                        accumulator[session.session_id] -= TICK_MS
                    new_events = [event for event in session.events if event["sequence"] > before_sequence]
                    if new_events or session.sim_time_ms % 1000 < TICK_MS:
                        self._save(session, new_events)
            time.sleep(0.01)

    def _owned(self, session_id: str, actor: str) -> Session:
        session = self.sessions.get(session_id)
        if not session:
            raise SimError("SESSION_NOT_FOUND", "Simulation session not found", 404)
        if session.owner != actor:
            raise SimError("SESSION_FORBIDDEN", "Session belongs to another operator", 403)
        return session

    def _mutate(self, session: Session, payload: dict[str, Any], operation, scope: str, content: dict[str, Any] | None = None) -> tuple[int, dict[str, Any]]:
        if set(payload) - {"expectedControlRevision", "idempotencyKey"}:
            raise SimError("UNKNOWN_FIELDS", "Mutation contains unsupported fields", 400)
        raw_key = str(payload.get("idempotencyKey", ""))
        if not raw_key or len(raw_key) > 128:
            raise SimError("IDEMPOTENCY_KEY_REQUIRED", "A bounded idempotencyKey is required", 400)
        key = f"{scope}:{raw_key}"
        fingerprint = content_hash({"scope": scope, "payload": payload, "content": content})
        if key in session.idempotency:
            old_fingerprint, old_response = session.idempotency[key]
            if fingerprint != old_fingerprint:
                raise SimError("IDEMPOTENCY_CONFLICT", "Idempotency key was used with different content", 409)
            return 200, copy.deepcopy(old_response)
        if payload.get("expectedControlRevision") != session.control_revision:
            raise SimError("STALE_REVISION", "Control revision changed; refresh and retry", 409,
                           {"controlRevision": session.control_revision})
        before_sequence = session.sequence
        response = operation()
        session.idempotency[key] = (fingerprint, copy.deepcopy(response))
        self._save(session, [event for event in session.events if event["sequence"] > before_sequence])
        return 200, response

    def handle(self, method: str, path: str, body: dict[str, Any] | None, actor: str, *, instructor_access: bool = False) -> tuple[int, dict[str, Any]] | None:
        if not (path == PREFIX or path.startswith(PREFIX + "/")):
            return None
        parsed = urlparse(path)
        suffix = unquote(parsed.path[len(PREFIX):]).strip("/")
        payload = body or {}
        try:
            if method == "GET" and suffix == "models":
                return 200, {"source": "simulation", "models": [{"modelId": self.model["modelId"], "revision": self.model["revision"],
                    "label": self.model["label"], "readiness": self.model["readiness"], "synthetic": True,
                    "hash": self.model_hash, "unitSequenceHash": self.unit_hash, "rulesHash": self.rule_hash,
                    "canLaunch": True}, {"modelId": COMPLEX_ID, "revision": self.complex_model['revision'],
                    "label": self.complex_model['label'], "readiness": "draft_synthetic", "synthetic": True,
                    "hash": self.complex_hash, "canLaunch": True}] + catalog_only_models(CATALOG_PATH)}
            if method == "GET" and suffix == "scenarios":
                return 200, {"source": "simulation", "scenarios": [
                    {"scenarioId": item["scenarioId"], "revision": item["revision"], "title": item["title"],
                     "modelId": item["modelId"], "synthetic": True, "notAProcedure": item.get("notAProcedure", True)}
                    for item in self.scenarios.values()]}
            if method == "POST" and suffix == "models/validate":
                candidate, digest = load_model(payload.get("model"))
                return 200, {"source": "simulation", "valid": True, "modelId": candidate["modelId"], "revision": candidate["revision"], "hash": digest,
                             "readiness": candidate["readiness"], "synthetic": candidate["synthetic"]}
            if method == "POST" and suffix == "sessions":
                model_id = payload.get('modelId', self.model['modelId'])
                if model_id not in {self.model['modelId'], COMPLEX_ID}:
                    raise SimError("MODEL_NOT_AVAILABLE", "Only the explicit synthetic training model is launchable", 422)
                if sum(session.status in {"paused", "running"} for session in self.sessions.values()) >= 10:
                    raise SimError("SESSION_LIMIT", "Ten isolated training sessions are already active", 429)
                scenario_id = str(payload.get("scenarioId", "NORMAL-OPEN"))
                scenario = self.scenarios.get(scenario_id)
                if not scenario:
                    raise SimError("SCENARIO_NOT_FOUND", "Unknown synthetic scenario", 404)
                if scenario['modelId'] != model_id:
                    raise SimError('SCENARIO_MODEL_MISMATCH', 'Choose a scenario for the selected model', 422)
                session_class = ComplexSession if model_id == COMPLEX_ID else Session
                model = self.complex_model if model_id == COMPLEX_ID else self.model
                session = session_class(model, scenario, actor, int(payload.get("seed", scenario.get("seed", 1))),
                                  self.rules, self.unit_sequence, self.local_instructor and instructor_access)
                with self.lock:
                    self.sessions[session.session_id] = session
                    self.session_locks[session.session_id] = threading.RLock()
                self._save(session, session.events)
                return 201, session.snapshot()
            parts = suffix.split("/") if suffix else []
            if len(parts) < 2 or parts[0] != "sessions":
                raise SimError("ROUTE_NOT_FOUND", "Training simulator route not found", 404)
            session = self._owned(parts[1], actor)
            lock = self.session_locks[session.session_id]
            with lock:
                if method == "GET" and len(parts) == 2:
                    return 200, session.snapshot()
                if method == "GET" and len(parts) == 3 and parts[2] == "debrief":
                    return 200, {"source": "simulation", "sessionId": session.session_id,
                                 "debriefs": copy.deepcopy(session.debriefs)}
                if method == "GET" and len(parts) == 3 and parts[2] == "instructor-state":
                    if not (self.local_instructor and instructor_access and session.instructor_enabled):
                        raise SimError("INSTRUCTOR_ONLY", "Instructor truth is disabled for this session", 404)
                    return 200, {"source": "simulation", "sessionId": session.session_id, "runId": session.run_id,
                                 "stateRevision": session.state_revision, "simTimeMs": session.sim_time_ms,
                                 "unit": copy.deepcopy(session.unit), "equipmentTruth": copy.deepcopy(session.states),
                                 "truth": copy.deepcopy(session.truth), "faults": copy.deepcopy(session.faults),
                                 "ruleMemory": {"pickupSince": dict(session.rule_runtime.since),
                                                "clearSince": dict(session.rule_runtime.clear_since),
                                                "latched": sorted(session.rule_runtime.latched)}}
                if method == "GET" and len(parts) == 3 and parts[2] == "tags":
                    snap = session.snapshot()
                    return 200, {key: snap[key] for key in ("source", "sessionId", "runId", "stateRevision", "simTimeMs", "modelHash", "tags")}
                if method == "GET" and len(parts) == 3 and parts[2] == "events":
                    after = int(parse_qs(parsed.query).get("afterSequence", ["0"])[0])
                    events = [public for event in session.events if event["sequence"] > after
                              if (public := session.public_event(event)) is not None]
                    oldest = session.events[0]["sequence"] if session.events else session.sequence + 1
                    return 200, {"source": "simulation", "sessionId": session.session_id, "events": events,
                                 "nextSequence": session.sequence, "gap": after + 1 < oldest,
                                 "stateRevision": session.state_revision}
                if method == "POST" and len(parts) == 3 and parts[2] == "clock":
                    if set(payload) - {"action", "speed", "expectedControlRevision", "idempotencyKey"}:
                        raise SimError("UNKNOWN_FIELDS", "Clock request contains unsupported fields", 400)
                    key = str(payload.get("idempotencyKey", ""))
                    if not key or len(key) > 128:
                        raise SimError("IDEMPOTENCY_KEY_REQUIRED", "A bounded idempotencyKey is required", 400)
                    idem_key = "clock:" + key
                    fingerprint = content_hash({"operation": "clock", "payload": payload})
                    if idem_key in session.idempotency:
                        old_fingerprint, old_response = session.idempotency[idem_key]
                        if fingerprint != old_fingerprint:
                            raise SimError("IDEMPOTENCY_CONFLICT", "Idempotency key was used with different content", 409)
                        return 200, copy.deepcopy(old_response)
                    if payload.get("expectedControlRevision") != session.control_revision:
                        raise SimError("STALE_REVISION", "Control revision changed; refresh and retry", 409,
                                       {"controlRevision": session.control_revision})
                    before_sequence = session.sequence
                    result = session.clock(str(payload.get("action", "")), payload.get("speed"))
                    session.idempotency[idem_key] = (fingerprint, copy.deepcopy(result))
                    self._save(session, [event for event in session.events if event["sequence"] > before_sequence])
                    return 200, result
                if method == "POST" and len(parts) == 3 and parts[2] == "finish":
                    return self._mutate(session, payload, session.finish, "finish")
                if method == "POST" and len(parts) == 3 and parts[2] == "reset":
                    return self._mutate(session, payload, session.reset, "reset")
                if method == "POST" and len(parts) == 5 and parts[2] == "alarms" and parts[4] == "ack":
                    return self._mutate(session, payload, lambda: session.acknowledge_alarm(parts[3]), "alarm-ack:" + parts[3])
                if method == "POST" and len(parts) == 3 and parts[2] == "select":
                    result = session.select(actor, payload)
                    self._save(session)
                    return 200, result
                if method == "POST" and len(parts) == 3 and parts[2] == "commands":
                    before_sequence = session.sequence
                    result = session.execute(actor, payload)
                    self._save(session, [event for event in session.events if event["sequence"] > before_sequence])
                    return 202, result
                if method == "POST" and len(parts) == 3 and parts[2] == "faults":
                    if not (self.local_instructor and instructor_access and session.instructor_enabled):
                        raise SimError("INSTRUCTOR_ONLY", "Instructor faults are disabled for this session", 404)
                    if set(payload) != {"type", "durationMs", "expectedControlRevision", "idempotencyKey"}:
                        raise SimError("UNKNOWN_FIELDS", "Fault injection request is malformed", 400)
                    if payload.get("type") != "load_overcurrent" or type(payload.get("durationMs")) is not int or payload.get("durationMs") not in {3000, 5000, 10000}:
                        raise SimError("FAULT_NOT_SUPPORTED", "Only the bounded synthetic overload fault is available", 422)
                    result_status, result = self._mutate(session,
                        {"expectedControlRevision": payload.get("expectedControlRevision"), "idempotencyKey": payload.get("idempotencyKey")},
                        lambda: session._inject_local_overload(int(payload["durationMs"])), "fault:load_overcurrent",
                        {"type": payload["type"], "durationMs": payload["durationMs"]})
                    return result_status, result
            raise SimError("ROUTE_NOT_FOUND", "Training simulator route not found", 404)
        except ModelError as exc:
            return 422, {"code": "INVALID_MODEL", "message": str(exc), "details": exc.issues}
        except SimError as exc:
            return exc.status, {"code": exc.code, "message": str(exc), "details": exc.details}
        except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
            return 400, {"code": "INVALID_REQUEST", "message": str(exc)}


_SIMULATOR: SimulatorService | None = None
_SIMULATOR_LOCK = threading.Lock()


def get_simulator(local_instructor: bool = False) -> SimulatorService:
    global _SIMULATOR
    if _SIMULATOR is None:
        with _SIMULATOR_LOCK:
            if _SIMULATOR is None:
                _SIMULATOR = SimulatorService(local_instructor=local_instructor)
    return _SIMULATOR
