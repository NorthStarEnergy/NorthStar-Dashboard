from __future__ import annotations

import math
from typing import Any


def hydro_step(model: dict[str, Any], states: dict[str, dict[str, Any]], dt_seconds: float) -> dict[str, Any]:
    """Advance declared reduced-order turbine/reservoir states by one fixed step."""
    result: dict[str, Any] = {}
    devices = {item["equipmentId"]: item for item in model["equipment"]}
    for turbine in (item for item in model["equipment"] if item["type"] == "turbine"):
        tid = turbine["equipmentId"]
        ts = states.setdefault(tid, dict(turbine.get("initialState", {})))
        tp = turbine["parameters"]
        pond = devices.get(tp.get("reservoirRef"))
        if pond is None or pond["type"] != "reservoir":
            raise ValueError(f"{tid}: reservoirRef is unresolved")
        pid = pond["equipmentId"]
        ps = states.setdefault(pid, dict(pond.get("initialState", {})))
        pp = pond["parameters"]
        target_flow = max(0.0, min(float(tp["maxFlowM3S"]), float(ts.get("gateFraction", 0)) * float(tp["maxFlowM3S"])))
        tau = max(float(tp.get("flowTimeConstantSeconds", 1)), 1e-9)
        flow = float(ts.get("flowM3S", 0)) + (target_flow - float(ts.get("flowM3S", 0))) * min(dt_seconds / tau, 1.0)
        headwater = float(ps.get("headwaterM", pp["levelAtZeroStorageM"] + float(ps["storageM3"]) / float(pp["areaM2"])))
        net_head = headwater - float(tp["tailwaterM"]) - float(tp.get("hydraulicLossM", 0))
        if net_head < 0 or not math.isfinite(net_head):
            raise ValueError(f"{tid}: invalid net head")
        power_mw = float(tp["rhoKgM3"]) * float(tp["gMSecond2"]) * flow * net_head * float(tp["efficiency"]) / 1e6
        ts.update({"flowM3S": flow, "netHeadM": net_head, "hydraulicPowerMW": power_mw})
        new_storage = float(ps["storageM3"]) + (float(ps.get("inflowM3S", 0)) - flow - float(ps.get("spillM3S", 0)) - float(ps.get("bypassM3S", 0))) * dt_seconds
        if new_storage < float(pp["minimumStorageM3"]) or new_storage > float(pp["maximumStorageM3"]):
            raise ValueError(f"{pid}: storage boundary requires explicit overflow response")
        ps["storageM3"] = new_storage
        ps["headwaterM"] = float(pp["levelAtZeroStorageM"]) + new_storage / float(pp["areaM2"])
        gen_id = tp.get("generatorRef")
        if gen_id in states:
            gen = devices[gen_id]
            gs = states[gen_id]
            requested = float(gs.get("requestedMW", 0))
            ramp = float(gen["parameters"].get("rampMWPerSecond", 0)) * dt_seconds
            target = min(requested, power_mw, float(gen["parameters"].get("ratedMW", requested)))
            old = float(gs.get("activeMW", 0))
            gs["activeMW"] = max(old - ramp, min(old + ramp, target))
        result[tid] = {"flowM3S": flow, "netHeadM": net_head, "hydraulicPowerMW": power_mw}
    return result
