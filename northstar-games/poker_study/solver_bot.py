"""Opt-in river solver policy. Solving inputs contain public information only.

No claim of full-game equilibrium: range inference is heuristic, the river
action tree is restricted, and unsupported/unconverged spots use the old policy.
"""
from collections import OrderedDict
from dataclasses import asdict
import hashlib
import json
import math
import threading

from .bot_policy import OPEN_CUTOFF, features, public_action_context, weighted_range, strength
from .personalities import NEUTRAL


def postflop_request(game):
    """Reconstruct the current street root from public actions only."""
    if game.done or game.street not in ('flop', 'turn', 'river') or len(game.board) != {'flop':3,'turn':4,'river':5}[game.street]:
        return None
    n = game.seat_count
    stacks = game.config.stacks.copy()
    totals, bets, folded = [0] * n, [0] * n, [False] * n
    def pay(seat, amount):
        paid = min(stacks[seat], amount)
        stacks[seat] -= paid
        totals[seat] += paid
        bets[seat] += paid
    pay((game.config.button + 1) % n, game.config.small_blind)
    pay((game.config.button + 2) % n, game.config.big_blind)
    current, street = game.config.big_blind, 'preflop'
    before = []
    for event in game.history:
        if event['street'] == game.street:
            break
        if event['street'] != street:
            street, bets, current = event['street'], [0] * n, 0
        seat, action = event['seat'], event['action']
        if action == 'fold':
            folded[seat] = True
        elif action == 'call':
            pay(seat, max(0, current - bets[seat]))
        elif action == 'raise':
            pay(seat, event['amount'] - bets[seat])
            current = event['amount']
        before.append(event)
    seats = sorted((i for i in range(n) if not folded[i]),
                   key=lambda i: (i - game.config.button - 1) % n)
    # All-in/side-pot roots and pots that only become heads-up on the river
    # require a different game model and are deliberately not approximated.
    if len(seats) != 2 or any(stacks[i] <= 0 for i in seats):
        return None
    if totals[seats[0]] != totals[seats[1]] or max(totals) > totals[seats[0]]:
        return None
    if game.actor not in seats or game.live() != sorted(seats):
        return None
    profiles = []
    contexts = public_action_context(game)
    for seat in seats:
        pre = [e for e in before if e['seat'] == seat and e['street'] == 'preflop']
        raises = sum(e['action'] == 'raise' for e in pre)
        cutoff = (OPEN_CUTOFF[game.position(seat)] + .09 * max(0, raises - 1)
                  if raises else .40 if any(e['action'] == 'call' for e in pre) else 0.)
        events = tuple((e['street'], e['action'], size) for e, size in contexts
                       if e['seat'] == seat and e in before and e['street'] != 'preflop')
        profiles.append((cutoff, events, 0.))
    return {'board': list(game.board), 'pot': sum(totals),
            'stack': min(stacks[i] for i in seats), 'seats': seats,
            'min_bet': game.config.big_blind, 'profiles': profiles,
            'public_history': before,
            'street_history': [e for e in game.history if e['street'] == game.street]}


def river_request(game):
    if game.street != 'river':return None
    request=postflop_request(game)
    if request is not None:request['river_history']=request.pop('street_history')
    return request


def inferred_ranges(request):
    """Full ranges; do not remove the actor's cards from the opponent range."""
    result = []
    for profile in request['profiles']:
        hands, cumulative = weighted_range((), tuple(request['board']), profile)
        previous, weights = 0., {}
        for hand, total in zip(hands, cumulative):
            weights[''.join(hand)] = total - previous
            previous = total
        result.append(weights)
    return result


def handicap_policy(row, actions, hole, board, traits, limit=.10):
    """Move at most limit probability toward a bot's stable weakness profile.

    Skill controls magnitude; traits control direction. A neutral bot retains
    the solved frequencies exactly. Metrics always describe the unmodified base.
    """
    if traits == NEUTRAL or not limit:
        return dict(row)
    f = features(hole, board) if len(board) >= 3 else {'made': 0, 'draw': 0}
    value = f['made'] >= 1 if board else strength(hole) >= .7
    traits_dict = asdict(traits)
    severity = min(limit, sum(abs(x) for x in traits_dict.values()) * .5)
    scores = {}
    raises = [int(a.split(':')[1]) for a in actions if a.startswith('raise:')]
    for action in actions:
        if action == 'fold':
            score = traits.fold_bias + (traits.river_caution if len(board) == 5 else 0) - (traits.range_width if not board else 0)
        elif action == 'call':
            score = traits.flat_bias - traits.fold_bias - (traits.river_caution if len(board) == 5 else 0)
        elif action == 'check':
            score = traits.slowplay - traits.bet_bias
        else:
            score = traits.bet_bias - traits.slowplay - traits.flat_bias
            score += traits.thin_value if value else traits.bluff_bias
            score += traits.draw_aggression if f['draw'] else 0
            score += traits.range_width if not board else 0
            if raises and max(raises) > min(raises):
                score += traits.sizing_bias * (2 * (int(action.split(':')[1]) - min(raises)) / (max(raises) - min(raises)) - 1)
        scores[action] = score
    minimum = min(scores.values())
    scores = {a: score - minimum for a, score in scores.items()}
    total = sum(scores.values())
    if total == 0:
        return dict(row)
    return {a: (1 - severity) * row.get(a, 0.) + severity * scores[a] / total
            for a in actions if row.get(a, 0.) or scores[a]}


class RiverSolverBot:
    """Bounded, cached, opt-in solver adapter shared by both river players."""
    def __init__(self, *, iterations=1000, time_limit=2., target_exploitability=.005,
                 bet_sizes=(.5, 1.), max_raises=2, cache_size=8, handicap_limit=.10):
        if not 1 <= cache_size <= 64 or not 0 <= handicap_limit <= .25:
            raise ValueError('Invalid solver cache or handicap limit.')
        self.options = dict(iterations=iterations, time_limit=time_limit,
                            target_exploitability=target_exploitability,
                            bet_sizes=bet_sizes, max_raises=max_raises)
        self.cache_size, self.handicap_limit = cache_size, handicap_limit
        self.cache, self.lock = OrderedDict(), threading.RLock()
        self.last_status = {'source': 'not_used'}

    def advise(self, game, traits=NEUTRAL):
        request = river_request(game)
        if request is None:
            self.last_status = {'source': 'fallback', 'reason': 'unsupported_root'}
            return None
        from .river_solver import canonical_combo, solve_river
        identity = {k: v for k, v in request.items() if k != 'river_history'}
        cache_key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
        with self.lock:
            solution = self.cache.get(cache_key)
            if solution is None:
                solution = solve_river(request['board'], inferred_ranges(request),
                                       request['pot'], request['stack'],
                                       min_bet=request['min_bet'], **self.options)
                self.cache[cache_key] = solution
                while len(self.cache) > self.cache_size:
                    self.cache.popitem(last=False)
            else:
                self.cache.move_to_end(cache_key)
        metrics = solution['metrics']
        if not metrics['converged']:
            self.last_status = {'source': 'fallback', 'reason': 'not_converged', 'metrics': metrics}
            return None
        node = solution['nodes']['root']
        for event in request['river_history']:
            label = 'raise:' + str(event['amount']) if event['action'] == 'raise' else event['action']
            if request['seats'][node.get('player', -1)] != event['seat'] or label not in node.get('children', {}):
                self.last_status = {'source': 'fallback', 'reason': 'outside_solved_tree'}
                return None
            node = solution['nodes'][node['children'][label]]
        if node.get('player') != request['seats'].index(game.actor) or 'strategy' not in node:
            self.last_status = {'source': 'fallback', 'reason': 'wrong_node'}
            return None
        hand = canonical_combo(game.holes[game.actor])
        probabilities = node['strategy'].get(hand)
        if probabilities is None:
            self.last_status = {'source': 'fallback', 'reason': 'hand_outside_range'}
            return None
        if (node.get('public_reach_probability', 1.) < 1e-6 or
                node.get('hand_reach_probability', {}).get(hand, 1.) < 1e-6):
            self.last_status = {'source': 'fallback', 'reason': 'low_reach_branch'}
            return None
        row = dict(zip(node['actions'], probabilities))
        row = handicap_policy(row, node['actions'], game.holes[game.actor], game.board,
                              traits or NEUTRAL, self.handicap_limit)
        legal = game.legal()
        for label, p in row.items():
            if not math.isfinite(p) or p < 0:
                raise ValueError('Invalid solver probability.')
            if label.startswith('raise:'):
                if legal['raise_min'] is None or not legal['raise_min'] <= int(label.split(':')[1]) <= legal['raise_max']:
                    self.last_status = {'source': 'fallback', 'reason': 'illegal_tree_action'}
                    return None
            elif label not in ('fold', 'check', 'call') or (label == 'check' and not legal['check']) or (label == 'call' and not legal['call']):
                self.last_status = {'source': 'fallback', 'reason': 'illegal_tree_action'}
                return None
        if not math.isclose(sum(row.values()), 1., abs_tol=1e-8):
            raise ValueError('Unnormalized solver policy.')
        self.last_status = {'source': 'river_solver', 'metrics': metrics,
                            'handicap_applied': traits is not None and traits != NEUTRAL}
        reason = ('CFR+ heads-up river solution; inferred ranges, restricted bet tree; '
                  f"baseline exploitability {metrics['exploitability_fraction_pot']:.3%} of root pot. "
                  'Personality and opponent-learning adjustments are outside that guarantee.')
        return {a: p for a, p in row.items() if p > 0}, reason
