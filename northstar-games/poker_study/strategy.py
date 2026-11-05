"""Explicit, auditable abstractions; bundled ranges are educational heuristics."""
import json
import math
import os
import random
from pathlib import Path
from .cards import DECK, hand_class, rank, validate

def preflop_ranges():
    result = {}
    ranks = '23456789TJQKA'
    for pos, pair_min, broad_min in [('UTG', 6, 11), ('HJ', 5, 10), ('CO', 3, 9), ('BTN', 2, 8), ('SB', 2, 9), ('BB', 2, 9)]:
        table = {}
        for x in range(12, -1, -1):
            for y in range(x, -1, -1):
                for suffix in ([''] if x == y else ['s', 'o']):
                    hi, lo = x + 2, y + 2
                    open_hand = (x == y and hi >= pair_min) or (x != y and lo >= broad_min) or (hi == 14 and suffix == 's') or (suffix == 's' and hi - lo == 1 and lo >= broad_min - 3)
                    table[ranks[x] + ranks[y] + suffix] = 1.0 if open_hand else 0.0
        result[pos] = table
    return result

RANGES = preflop_ranges()

def actions(game):
    legal = game.legal()
    if not legal: return {}
    result = {'fold': ('fold', None)}
    result['check' if legal['check'] else 'call'] = ('check', None) if legal['check'] else ('call', None)
    if legal['raise_min'] is not None:
        i = game.actor
        for fraction in (0.33, 0.75, 1.0):
            target = game.current + round((game.pot + legal['call']) * fraction)
            target = max(legal['raise_min'], min(target, legal['raise_max']))
            result[f'raise:{target}'] = ('raise', target)
        result[f"raise:{legal['raise_min']}"] = ('raise', legal['raise_min'])
        result[f"raise:{legal['raise_max']}"] = ('raise', legal['raise_max'])
    return result

def key(game):
    """Exact local information set. Never includes opponents' private cards or seed."""
    i = game.actor
    if i is None: raise ValueError('No decision at terminal state.')
    return json.dumps({'v': 1, 'button': game.config.button, 'blinds': [game.config.small_blind, game.config.big_blind],
        'initial_stacks': game.config.stacks, 'actor': i, 'hole': sorted(game.holes[i]),
        'board': game.board, 'history': game.history}, sort_keys=True, separators=(',', ':'))

class Strategy:
    def __init__(self, path=None, data=None, river_solver=None, sampled_solver=None, equity_learner=None, texas_solver=None, wait_for_solver=False):
        self.rows = {}
        self.texas_solver = texas_solver
        self.wait_for_solver = wait_for_solver
        self.equity_learner = equity_learner
        if river_solver is None and (os.environ.get('NORTHSTAR_RIVER_SOLVER') == '1' or os.environ.get('NORTHSTAR_SAMPLED_SOLVER') == '1'):
            from .solver_bot import RiverSolverBot
            river_solver = RiverSolverBot()
        self.river_solver = river_solver
        if sampled_solver is None and os.environ.get('NORTHSTAR_SAMPLED_SOLVER') == '1':
            from .sampled_solver import SampledSolverBot
            sampled_solver = SampledSolverBot(allow_experimental=True)
        self.sampled_solver = sampled_solver
        self.solver_status = {'source': 'disabled' if not river_solver else 'not_used'}
        if path:
            data = json.loads(Path(path).read_text(encoding='utf-8'))
        if data is not None:
            if data.get('version') != 1 or data.get('key_format') != 'exact-local-v1': raise ValueError('Unsupported strategy schema.')
            if not isinstance(data.get('source'), str) or not data['source'].strip(): raise ValueError('Strategy provenance required.')
            self.rows = data['states']
            if not isinstance(self.rows, dict): raise ValueError('states must be an object.')
            for row in self.rows.values():
                if not isinstance(row, dict) or not row or any(type(p) not in (int, float) or not math.isfinite(p) or p < 0 for p in row.values()) or not math.isclose(sum(row.values()), 1, abs_tol=1e-8):
                    raise ValueError('Probabilities must be finite, nonnegative, and sum to one.')

    def advise(self, game, traits=None, opponent_traits=None, wait_for_solver=None):
        available = actions(game)
        row = self.rows.get(key(game))
        if row is not None:
            # Exact imports may use sizes beyond the default abstraction.
            for label in row:
                if label not in available:
                    try:
                        kind, raw = label.split(':')
                        amount = int(raw)
                        legal = game.legal()
                        if kind != 'raise' or legal['raise_min'] is None or not legal['raise_min'] <= amount <= legal['raise_max']: raise ValueError()
                        available[label] = ('raise', amount)
                    except (ValueError, TypeError): raise ValueError(f'Imported action is illegal: {label}')
            return row, 'Imported table; quality depends on supplied solver/provenance.'
        if self.texas_solver:
            result = self.texas_solver.advise(game, traits, wait=self.wait_for_solver if wait_for_solver is None else wait_for_solver)
            self.solver_status = dict(self.texas_solver.last_status)
            if result is not None:return result
        if self.river_solver:
            try:
                result = self.river_solver.advise(game, traits)
                self.solver_status = dict(self.river_solver.last_status)
                if result is not None:
                    return result
            except ImportError:
                self.solver_status = {'source': 'fallback', 'reason': 'solver_dependency_missing'}
        if self.sampled_solver:
            result = self.sampled_solver.advise(game, traits)
            self.solver_status = dict(self.sampled_solver.last_status)
            if result is not None:
                return result
        from .bot_policy import advise
        from .personalities import NEUTRAL
        row, reason = advise(game, traits or NEUTRAL, opponent_traits, self.equity_learner)
        if self.texas_solver or self.river_solver or self.sampled_solver:
            reason += ' Solver fallback: ' + self.solver_status.get('reason', 'unavailable') + '.'
        return row, reason

def choose(row, rng): return rng.choices(list(row), weights=list(row.values()))[0]

def apply_label(game, label):
    if label.startswith('raise:'): game.act('raise', int(label.split(':')[1]))
    else: game.act(label)

def equity(hole, board, opponents=1, samples=1000, seed=1):
    validate(hole + board)
    if len(hole) != 2 or len(board) not in (0, 3, 4, 5): raise ValueError('Require two hole cards and 0/3/4/5 board cards.')
    if not 1 <= opponents <= 5 or samples < 2: raise ValueError('Require 1–5 opponents and at least two samples.')
    rng = random.Random(seed)
    remaining = [c for c in DECK if c not in hole + board]
    values = []
    for _ in range(samples):
        draw = rng.sample(remaining, 5 - len(board) + opponents * 2)
        runout = board + draw[:5 - len(board)]
        rest = draw[5 - len(board):]
        scores = [rank(hole + runout)] + [rank(rest[2*i:2*i+2] + runout) for i in range(opponents)]
        values.append(1 / scores.count(max(scores)) if scores[0] == max(scores) else 0)
    mean = sum(values) / samples
    se = math.sqrt(sum((v - mean)**2 for v in values) / (samples - 1) / samples)
    return {'equity': mean, 'standard_error': se, 'samples': samples,
            'assumption': 'Uniform random opponent hands; shared runout, no future betting or range inference.'}
