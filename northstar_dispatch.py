"""APIROQ dispatch telemetry: simulated generator output vs IESO dispatch instruction.

The dispatch client on the operator dashboard needs a live MW stream. Until a SCADA
or market-commitment feed is wired, this module generates realistic APIROQ values in
the 30–70 MW operating band and exposes them through ``/api/dispatch/apiroq``.

Set ``NORTHSTAR_DISPATCH_SIM=off`` to disable simulation (endpoint returns stale
placeholder). A future SCADA tag import can replace the simulator without changing
the client contract.
"""

from __future__ import annotations

import math
import os
import random
import threading
import time
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Toronto")

MW_MIN = 30.0
MW_MAX = 70.0
MW_CAPACITY = 80.0
OR_RESERVE_MAX_MW = 20.0
TICK_SECONDS = 5
HISTORY_LIMIT = 72  # six minutes at 5 s intervals

_LOCK = threading.Lock()
_STATE: dict[str, Any] | None = None
_RNG = random.Random()


def _sim_enabled() -> bool:
    return os.environ.get("NORTHSTAR_DISPATCH_SIM", "on").strip().lower() not in {
        "0",
        "off",
        "false",
        "no",
    }


def _seed_rng() -> None:
    raw = os.environ.get("NORTHSTAR_DISPATCH_SEED", "").strip()
    if raw:
        _RNG.seed(int(raw))
    else:
        _RNG.seed()


def _now_iso() -> str:
    return datetime.now(TZ).isoformat()


def _clamp(value: float, low: float = 0.0, high: float = MW_CAPACITY) -> float:
    return max(low, min(high, value))


def _clamp_or_reserve(value: float) -> float:
    return round(_clamp(value, 0.0, OR_RESERVE_MAX_MW), 1)


def _random_reserve_standby() -> dict[str, float]:
    return {
        "tenS": _clamp_or_reserve(_RNG.uniform(4.0, 16.0)),
        "tenN": _clamp_or_reserve(_RNG.uniform(4.0, 16.0)),
        "thirtyR": _clamp_or_reserve(_RNG.uniform(0.0, 20.0)),
    }


def _advance_reserve_standby(state: dict[str, Any]) -> None:
    reserve = dict(state.get("reserveStandby") or _random_reserve_standby())
    for key in ("tenS", "tenN", "thirtyR"):
        current = float(reserve.get(key, 0.0))
        if _RNG.random() < 0.18:
            target = _RNG.uniform(0.0, OR_RESERVE_MAX_MW)
            current += (target - current) * _RNG.uniform(0.25, 0.55)
        else:
            current += _RNG.uniform(-1.2, 1.2)
        reserve[key] = _clamp_or_reserve(current)
    state["reserveStandby"] = reserve


def _initial_state() -> dict[str, Any]:
    dispatch = round(_RNG.uniform(44.0, 56.0), 1)
    output = round(dispatch + _RNG.uniform(-1.2, 1.2), 1)
    return {
        "site": "APIROQ",
        "unit": "LT.AG4",
        "source": "simulated",
        "simulated": True,
        "updated": _now_iso(),
        "outputMw": output,
        "dispatchMw": dispatch,
        "deltaMw": round(output - dispatch, 1),
        "tracking": "on-target",
        "capacityMw": MW_CAPACITY,
        "orActivation": None,
        "reserveStandby": _random_reserve_standby(),
        "history": [
            {
                "time": _now_iso(),
                "outputMw": output,
                "dispatchMw": dispatch,
            }
        ],
        "healthy": True,
        "stale": False,
    }


def _tracking_label(delta: float) -> str:
    absolute = abs(delta)
    if absolute <= 1.0:
        return "on-target"
    if absolute <= 2.5:
        return "minor-deviation"
    return "off-target"


def _maybe_or_activation(state: dict[str, Any]) -> None:
    # Rare operating-reserve call; clears on its own after a few ticks.
    if state.get("orActivation"):
        state["orTicks"] = int(state.get("orTicks", 0)) + 1
        if state["orTicks"] >= 6:
            state["orActivation"] = None
            state.pop("orTicks", None)
        return
    if _RNG.random() < 0.02:
        reserve = state.get("reserveStandby") or {}
        product = _RNG.choice(["10S", "10N", "30R"])
        key = {"10S": "tenS", "10N": "tenN", "30R": "thirtyR"}[product]
        standby = float(reserve.get(key, 0.0) or 0.0)
        if standby <= 0.0:
            return
        state["orActivation"] = product
        state["orTicks"] = 0
        state["dispatchMw"] = _clamp(round(float(state["dispatchMw"]) + standby, 1))


def tick(now: float | None = None) -> dict[str, Any]:
    """Advance the simulator one interval and return the latest snapshot."""
    global _STATE

    if not _sim_enabled():
        with _LOCK:
            if _STATE is None:
                return _placeholder_snapshot(stale=True)
            stale = dict(_STATE)
            stale["stale"] = True
            stale["updated"] = _now_iso()
            return stale

    moment = now if now is not None else time.time()
    with _LOCK:
        if _STATE is None:
            _seed_rng()
            _STATE = _initial_state()
            _STATE["_phase"] = _RNG.uniform(0, math.tau)
            _STATE["_last_tick"] = moment
            return snapshot_unlocked()

        elapsed = max(0.0, moment - float(_STATE.get("_last_tick", moment)))
        if elapsed < TICK_SECONDS * 0.9:
            return snapshot_unlocked()

        steps = max(1, int(elapsed // TICK_SECONDS))
        dispatch = float(_STATE["dispatchMw"])
        output = float(_STATE["outputMw"])
        phase = float(_STATE.get("_phase", 0.0))

        for _ in range(steps):
            phase += 0.11
            # Slow drift in the IESO dispatch instruction.
            target = 50.0 + 14.0 * math.sin(phase) + 6.0 * math.sin(phase * 0.37)
            if _RNG.random() < 0.08:
                target += _RNG.uniform(-5.0, 5.0)
            target = _clamp(target, MW_MIN, MW_MAX)
            dispatch += (target - dispatch) * 0.22
            dispatch = round(_clamp(dispatch, MW_MIN, MW_MAX), 1)

            _maybe_or_activation(_STATE)
            dispatch = float(_STATE["dispatchMw"])
            _advance_reserve_standby(_STATE)

            # Output tracks dispatch with plant inertia and measurement noise.
            lag = 0.34 if abs(dispatch - output) > 4 else 0.24
            output += (dispatch - output) * lag
            output += _RNG.uniform(-0.35, 0.35)
            output = round(_clamp(output, max(0.0, MW_MIN - 5.0), MW_MAX + 2.0), 1)

            history = list(_STATE.get("history") or [])
            history.append(
                {
                    "time": _now_iso(),
                    "outputMw": output,
                    "dispatchMw": dispatch,
                }
            )
            _STATE["history"] = history[-HISTORY_LIMIT:]

        delta = round(output - dispatch, 1)
        _STATE.update(
            {
                "updated": _now_iso(),
                "outputMw": output,
                "dispatchMw": dispatch,
                "deltaMw": delta,
                "tracking": _tracking_label(delta),
                "_phase": phase,
                "_last_tick": moment,
                "healthy": True,
                "stale": False,
            }
        )
        return snapshot_unlocked()


def snapshot_unlocked() -> dict[str, Any]:
    assert _STATE is not None
    payload = {key: value for key, value in _STATE.items() if not key.startswith("_")}
    payload["history"] = list(payload.get("history") or [])
    return payload


def snapshot() -> dict[str, Any]:
    with _LOCK:
        if _STATE is None:
            if _sim_enabled():
                return tick()
            return _placeholder_snapshot(stale=True)
        return snapshot_unlocked()


def _placeholder_snapshot(*, stale: bool) -> dict[str, Any]:
    return {
        "site": "APIROQ",
        "unit": "LT.AG4",
        "source": "unavailable",
        "simulated": False,
        "updated": None,
        "outputMw": None,
        "dispatchMw": None,
        "deltaMw": None,
        "tracking": "unknown",
        "capacityMw": MW_CAPACITY,
        "orActivation": None,
        "reserveStandby": {"tenS": 0.0, "tenN": 0.0, "thirtyR": 0.0},
        "history": [],
        "healthy": False,
        "stale": stale,
    }


def reset_for_tests(seed: int | None = 42) -> None:
    """Clear in-memory state — used by the regression suite only."""
    global _STATE
    with _LOCK:
        _STATE = None
        if seed is not None:
            os.environ["NORTHSTAR_DISPATCH_SEED"] = str(seed)
        _seed_rng()
