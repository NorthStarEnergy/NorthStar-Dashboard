from __future__ import annotations

import math
from typing import Any


class SolverError(ValueError):
    pass


def solve_radial(model: dict[str, Any], states: dict[str, dict[str, Any]], *, tolerance: float = 1e-6,
                 max_iterations: int = 50) -> dict[str, Any]:
    """Balanced three-phase radial backward/forward sweep; powers are total three-phase MW/Mvar."""
    nodes = {node["nodeId"]: node for node in model["nodes"]}
    parent = {node_id: node_id for node_id in nodes}

    def find(item: str) -> str:
        while parent[item] != item:
            parent[item] = parent[parent[item]]
            item = parent[item]
        return item

    def union(a: str, b: str) -> None:
        parent[find(b)] = find(a)

    branches: list[tuple[str, str, complex, str]] = []
    for device in model["equipment"]:
        kind, terms = device["type"], device.get("terminals", [])
        if len(terms) != 2:
            continue
        state = states.get(device["equipmentId"], device.get("initialState", {}))
        # During travel the contacts retain the pre-command electrical topology;
        # the authoritative position changes only when the mechanism completes.
        closed = state.get("position", "closed") == "closed"
        if kind == "line":
            z = complex(float(device["parameters"].get("resistanceOhmPerPhase", 0)),
                        float(device["parameters"].get("reactanceOhmPerPhase", 0)))
            if abs(z) == 0:
                raise SolverError(f"{device['equipmentId']}: finite impedance required for a line")
            branches.append((terms[0]["nodeId"], terms[1]["nodeId"], z, device["equipmentId"]))
        elif kind in {"breaker", "isolator", "earth_switch"} and closed:
            union(terms[0]["nodeId"], terms[1]["nodeId"])
        elif kind == "transformer_2w" and closed:
            raise SolverError("transformer_2w is visible but not supported by balanced_radial_v1")

    groups: dict[str, set[str]] = {}
    for node_id in nodes:
        groups.setdefault(find(node_id), set()).add(node_id)
    collapsed = []
    for a, b, z, eq_id in branches:
        ra, rb = find(a), find(b)
        if ra == rb:
            raise SolverError(f"closed branch {eq_id} forms a mesh or self-loop")
        collapsed.append((ra, rb, z, eq_id))
    adjacency: dict[str, list[tuple[str, complex, str]]] = {root: [] for root in groups}
    for a, b, z, eq_id in collapsed:
        adjacency[a].append((b, z, eq_id))
        adjacency[b].append((a, z, eq_id))
    sources: dict[str, list[tuple[str, float]]] = {}
    for device in model["equipment"]:
        if device["type"] == "grid_source" and states.get(device["equipmentId"], device.get("initialState", {})).get("enabled", False):
            sources.setdefault(find(device["terminals"][0]["nodeId"]), []).append(
                (device["equipmentId"], float(device["parameters"]["nominalKVLL"])))

    result_nodes: dict[str, dict[str, Any]] = {}
    result_branches: dict[str, dict[str, float]] = {}
    seen: set[str] = set()
    for start in groups:
        if start in seen:
            continue
        component: set[str] = set()
        stack = [start]
        while stack:
            node = stack.pop()
            if node in component:
                continue
            component.add(node)
            stack.extend(other for other, _, _ in adjacency[node])
        seen.update(component)
        slacks = [(root, item) for root in component for item in sources.get(root, [])]
        if not slacks:
            for root in component:
                for node_id in groups[root]:
                    result_nodes[node_id] = {"energization": "deenergized", "voltageKVLL": 0.0, "quality": "good"}
            continue
        if len(slacks) != 1:
            for root in component:
                for node_id in groups[root]:
                    result_nodes[node_id] = {"energization": "unsupported", "voltageKVLL": None, "quality": "unsupported",
                                             "reason": "multiple independent voltage sources in island"}
            continue
        slack, source = slacks[0]
        base_kv = source[1]
        for root in component:
            for node_id in groups[root]:
                kv = float(nodes[node_id].get("nominalKVLL", base_kv))
                if kv and not math.isclose(kv, base_kv, rel_tol=1e-6, abs_tol=1e-6):
                    raise SolverError(f"incompatible voltage base at {node_id}; transformer adapter required")
        tree_parent: dict[str, tuple[str, complex, str] | None] = {slack: None}
        order = [slack]
        for root in order:
            for other, z, eq_id in adjacency[root]:
                prev = tree_parent[root]
                if prev is not None and other == prev[0]:
                    continue
                if other in tree_parent:
                    raise SolverError("closed topology is meshed; radial solver cannot solve this island")
                tree_parent[other] = (root, z, eq_id)
                order.append(other)
        powers: dict[str, complex] = {root: 0j for root in component}
        for device in model["equipment"]:
            ds = states.get(device["equipmentId"], device.get("initialState", {}))
            if device["type"] == "load" and ds.get("enabled", True):
                root = find(device["terminals"][0]["nodeId"])
                if root in component:
                    powers[root] += complex(float(ds.get("faultActiveMW", device["parameters"].get("activeMW", 0))),
                                             float(device["parameters"].get("reactiveMvar", 0))) * 1e6
            elif device["type"] == "generator" and ds.get("enabled", False):
                root = find(device["terminals"][0]["nodeId"])
                if root in component:
                    powers[root] -= complex(float(ds.get("activeMW", 0)),
                                            float(ds.get("reactiveMvar", device["parameters"].get("reactiveMvar", 0)))) * 1e6
        v_phase = base_kv * 1000 / math.sqrt(3)
        voltage: dict[str, complex] = {root: complex(v_phase, 0) for root in component}
        converged = False
        branch_current: dict[str, complex] = {}
        for _ in range(max_iterations):
            current: dict[str, complex] = {}
            for root in component:
                v = voltage[root]
                if abs(v) < v_phase * 0.05:
                    raise SolverError("voltage collapse below 0.05 pu")
                current[root] = (powers[root] / (3 * v)).conjugate()
            branch_current = {}
            for root in reversed(order[1:]):
                par, _, eq_id = tree_parent[root]  # type: ignore[misc]
                branch_current[eq_id] = current[root]
                current[par] += current[root]
            updated = {slack: complex(v_phase, 0)}
            for root in order[1:]:
                par, z, eq_id = tree_parent[root]  # type: ignore[misc]
                updated[root] = updated[par] - z * branch_current[eq_id]
            delta = max(abs(updated[root] - voltage[root]) / v_phase for root in component)
            voltage = updated
            if delta < tolerance:
                converged = True
                break
        if not converged:
            raise SolverError(f"radial solver did not converge in {max_iterations} iterations")
        for root in component:
            for node_id in groups[root]:
                result_nodes[node_id] = {"energization": "energized", "voltageKVLL": abs(voltage[root]) * math.sqrt(3) / 1000,
                                         "voltagePu": abs(voltage[root]) / v_phase, "quality": "good"}
        impedances = {eq_id: z.real for _, _, z, eq_id in collapsed}
        for eq_id, amps in branch_current.items():
            result_branches[eq_id] = {"currentA": abs(amps), "lossMW": 3 * abs(amps) ** 2 * impedances[eq_id] / 1e6}
    return {"nodes": result_nodes, "branches": result_branches, "solver": "balanced_radial_v1", "quality": "good"}
