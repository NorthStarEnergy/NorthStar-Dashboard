"""All-street, 2--6 live-player outcome-sampling MCCFR research solver.

Outcome-sampling update equations adapted from OpenSpiel (Copyright 2019
DeepMind Technologies Limited), Apache-2.0. See poker_study/licenses/
OPEN_SPIEL_LICENSE.txt and NOTICE.txt. Our hold'em adapter, range sampler and checkpoints are separate.

Finite bet/card abstractions and inferred ranges are explicit approximations.
Multiplayer training is NOT an equilibrium certificate. Never reads real
opponent cards, the real deck, or the real deal seed.
"""
from bisect import bisect_left
from collections import Counter, OrderedDict
from dataclasses import asdict
import hashlib
from itertools import combinations
import json
import math
from pathlib import Path
import random
import threading
import time

from .cards import DECK, hand_class, rank, validate
from .engine import Config, Game
from .bot_policy import OPEN_CUTOFF, public_action_context, weighted_range
from .personalities import NEUTRAL

SCHEMA = 'northstar-outcome-mccfr/1'


def seven_rank(cards):
    """Direct 5--7 card rank; same tuple ordering as the reference evaluator."""
    validate(cards)
    if not 5 <= len(cards) <= 7:
        raise ValueError('Require 5--7 distinct cards.')
    values = ['23456789TJQKA'.index(c[0]) + 2 for c in cards]
    counts = Counter(values)
    def straight(rs):
        rs = set(rs)
        if 14 in rs:
            rs.add(1)
        return next((high for high in range(14, 4, -1) if set(range(high-4, high+1)) <= rs), 0)
    flush = next(([v for v, c in zip(values, cards) if c[1] == s]
                  for s in 'cdhs' if sum(c[1] == s for c in cards) >= 5), None)
    if flush and straight(flush):
        return (8, straight(flush))
    groups = sorted(((n, v) for v, n in counts.items()), reverse=True)
    if groups[0][0] == 4:
        return (7, groups[0][1], max(v for v in values if v != groups[0][1]))
    trips = sorted((v for v, n in counts.items() if n >= 3), reverse=True)
    if trips:
        pairs = [v for v, n in counts.items() if n >= 2 and v != trips[0]]
        if pairs:
            return (6, trips[0], max(pairs))
    if flush:
        return (5, *sorted(flush, reverse=True)[:5])
    if straight(values):
        return (4, straight(values))
    if trips:
        return (3, trips[0], *sorted((v for v in values if v != trips[0]), reverse=True)[:2])
    pairs = sorted((v for v, n in counts.items() if n >= 2), reverse=True)
    if len(pairs) >= 2:
        return (2, *pairs[:2], max(v for v in values if v not in pairs[:2]))
    if pairs:
        return (1, pairs[0], *sorted((v for v in values if v != pairs[0]), reverse=True)[:3])
    return (0, *sorted(values, reverse=True)[:5])


def public_state(game):
    """Explicit allowlist: no holes, seed, deck, initial_deck or identities."""
    if game.done or game.actor is None:
        raise ValueError('An unfinished decision is required.')
    return {'config': {'stacks': list(game.config.stacks), 'small_blind': game.config.small_blind,
                       'big_blind': game.config.big_blind, 'button': game.config.button},
            'stacks': list(game.stacks), 'total': list(game.total), 'street_bets': list(game.street_bets),
            'folded': list(game.folded), 'board': list(game.board), 'street': game.street,
            'current': game.current, 'last_raise': game.last_raise, 'actor': game.actor,
            'pending': sorted(game.pending), 'acted': {str(k): list(v) for k, v in game.acted.items()},
            'history': [dict(e) for e in game.history]}


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def abstract_actions(game, bet_sizes=(.5, 1.), max_raises=2):
    legal = game.legal()
    if not legal:
        return []
    actions = ['check'] if legal['check'] else ['fold', 'call']
    raises = sum(e['street'] == game.street and e['action'] == 'raise' for e in game.history)
    if legal['raise_min'] is not None and raises < max_raises:
        targets = {legal['raise_min'], legal['raise_max']}
        targets.update(max(legal['raise_min'], min(legal['raise_max'],
                       game.current + int((game.pot + legal['call'])*f + .5))) for f in bet_sizes)
        actions += ['raise:' + str(t) for t in sorted(targets)]
    return actions


def apply(game, label):
    if label.startswith('raise:'):
        game.act('raise', int(label.split(':')[1]))
    else:
        game.act(label)


def card_bucket(hole, board):
    """Documented coarse private abstraction, not an equity estimate."""
    if not board:
        return hand_class(hole)
    made = seven_rank(list(hole) + list(board))
    board_only = seven_rank(board) if len(board) == 5 else None
    personal = made[0] if board_only is None or made > board_only else 0
    counts = Counter('23456789TJQKA'.index(c[0]) + 2 for c in board)
    hole_values = ['23456789TJQKA'.index(c[0]) + 2 for c in hole]
    if personal in (1, 3, 7) and made[1] not in hole_values:
        personal = 0
    if personal == 2 and not set(hole_values).intersection(made[1:3]):
        personal = 0
    suits = Counter(c[1] for c in list(hole)+list(board))
    flush_draw = len(board) < 5 and any(n == 4 and any(c[1] == s for c in hole) for s, n in suits.items())
    rs = set(counts) | set(hole_values)
    if 14 in rs:
        rs.add(1)
    straight_draw = len(board) < 5 and any(len(rs & set(range(low, low+5))) == 4 for low in range(1, 11))
    return [personal, made[1] // 4, max(hole_values) // 4, int(flush_draw), int(straight_draw)]


def information_key(game, root_board_count, history_offset):
    """Own cards and public observations only; retain prior abstract observations."""
    lengths = sorted({root_board_count, len(game.board)} | {n for n in (0, 3, 4, 5) if root_board_count <= n <= len(game.board)})
    recall = [card_bucket(game.holes[game.actor], game.board[:n]) for n in lengths]
    # Exact public cards preserve public chance observations. Root cards/history
    # are fixed by the trainer; include future cards and all subsequent actions.
    events = [(e['street'], e['seat'], e['action'], e['amount']) for e in game.history[history_offset:]]
    return json.dumps([game.actor, recall, game.board[root_board_count:], events], separators=(',', ':'))


class CapacityLimit(Exception):
    pass


class OutcomeTrainer:
    """Importance-corrected outcome sampling; no full-tree expansion."""
    def __init__(self, rng=None, exploration=.6, max_infosets=40000):
        if not 0 < exploration <= 1 or not 1 <= max_infosets <= 250000:
            raise ValueError('Invalid exploration or information-set limit.')
        self.rng = rng or random.Random(1)
        self.exploration, self.max_infosets = exploration, max_infosets
        self.nodes = {}
        self.episodes = 0

    @staticmethod
    def normalize(values):
        positive = [max(0., x) for x in values]
        total = sum(positive)
        return [x/total for x in positive] if total else [1/len(values)] * len(values)

    def episode(self, state, player):
        trail = []
        own, opponents, sampling = 1., 1., 1.
        while not state.done:
            key, actions, actor = state.info_key(), state.actions(), state.actor
            record = self.nodes.get(key)
            if record is None:
                if len(self.nodes) >= self.max_infosets:
                    raise CapacityLimit('Information-set capacity reached.')
                record = {'actions': list(actions), 'regrets': [0.] * len(actions),
                          'average': [0.] * len(actions), 'updates': 0}
                self.nodes[key] = record
            elif record['actions'] != actions:
                raise ValueError('Information set merged inconsistent legal actions.')
            policy = self.normalize(record['regrets'])
            proposal = [(1-self.exploration)*p + self.exploration/len(actions) for p in policy] if actor == player else policy
            index = self.rng.choices(range(len(actions)), weights=proposal)[0]
            trail.append((record, policy, proposal[index], index, actor == player, own, opponents, sampling))
            if actor == player:
                own *= policy[index]
            else:
                opponents *= policy[index]
            sampling *= proposal[index]
            state.act(actions[index])
        value = state.payoff(player)
        for record, policy, probability, index, updating, own, opponents, sampling in reversed(trail):
            action_value = value / probability
            estimate = policy[index] * action_value
            if updating:
                ratio = opponents / sampling
                changes = [ratio * ((action_value if a == index else 0.) - estimate) for a in range(len(policy))]
                average = [own * p / sampling for p in policy]
                updated_r = [r+d for r, d in zip(record['regrets'], changes)]
                updated_a = [r+d for r, d in zip(record['average'], average)]
                if not all(math.isfinite(x) for x in updated_r + updated_a):
                    raise ArithmeticError('Nonfinite importance weight; result is unusable.')
                record['regrets'], record['average'] = updated_r, updated_a
                record['updates'] += 1
            value = estimate
        self.episodes += 1

    def policy(self, key):
        record = self.nodes.get(key)
        if record is None or not record['updates']:
            return None
        return dict(zip(record['actions'], self.normalize(record['average'])))


class SampleGame(Game):
    hand_rank = staticmethod(seven_rank)


class HoldemEpisode:
    def __init__(self, game, root, bet_sizes, max_raises):
        self.game, self.root = game, root
        self.bet_sizes, self.max_raises = bet_sizes, max_raises
        self.participants = [i for i, folded in enumerate(root['folded']) if not folded]

    @property
    def actor(self):
        return self.game.actor

    @property
    def done(self):
        return self.game.done

    def info_key(self):
        return information_key(self.game, len(self.root['board']), len(self.root['history']))

    def actions(self):
        return abstract_actions(self.game, self.bet_sizes, self.max_raises)

    def act(self, label):
        apply(self.game, label)

    def payoff(self, player):
        centered = self.game.stacks[player] - self.root['stacks'][player] - sum(self.root['total']) / len(self.participants)
        return centered / self.root['config']['big_blind']


class HoldemSolver:
    """Train a public subgame, including all remaining streets and side pots."""
    def __init__(self, game, *, seed=1, bet_sizes=(.5, 1.), max_raises=2, max_infosets=40000):
        if type(seed) is not int or type(max_raises) is not int or not 1 <= max_raises <= 4:
            raise ValueError('Invalid solver seed or raise cap.')
        if not bet_sizes or len(bet_sizes) > 4 or any(not math.isfinite(x) or x <= 0 for x in bet_sizes):
            raise ValueError('Invalid bet sizes.')
        self.root = public_state(game)
        self.options = {'seed': seed, 'bet_sizes': list(bet_sizes), 'max_raises': max_raises,
                        'max_infosets': max_infosets, 'card_abstraction': 'recall-buckets-v1',
                        'range_model': 'public-action-v1-uniform-unacted'}
        self.context = fingerprint({'root': self.root, 'options': self.options})
        self.trainer = OutcomeTrainer(random.Random(seed), max_infosets=max_infosets)
        self.players = game.active()
        self.live = game.live()
        self.ranges = self._ranges(game)
        self.iterations, self.sampling_rejections = 0, 0
        self.stop_reason = 'not_trained'

    def _ranges(self, game):
        context = public_action_context(game)
        ranges = {}
        for seat in self.live:
            pre = [e for e in game.history if e['seat'] == seat and e['street'] == 'preflop']
            if not any(e['seat'] == seat for e in game.history):
                # Before any action, dealing is uniform. Hand-strength priors
                # here would bias the initial preflop training distribution.
                hands = tuple(combinations([c for c in DECK if c not in game.board], 2))
                ranges[seat] = (hands, tuple(range(1, len(hands)+1)))
                continue
            raises = sum(e['action'] == 'raise' for e in pre)
            cutoff = (OPEN_CUTOFF[game.position(seat)] + .09 * max(0, raises-1) if raises
                      else .40 if any(e['action'] == 'call' for e in pre) else 0.)
            events = tuple((e['street'], e['action'], size) for e, size in context
                           if e['seat'] == seat and e['street'] != 'preflop')
            # Removing no player's actual hole cards is essential: the joint
            # prior must be identical regardless of which bot requests a row.
            ranges[seat] = weighted_range((), tuple(game.board), (cutoff, events, 0.))
        return ranges

    def sample_world(self):
        rng = self.trainer.rng
        # Whole-tuple rejection samples product(range weights) conditioned on
        # card compatibility. Sequential renormalization would bias that prior.
        for _ in range(10000):
            used = set(self.root['board'])
            holes = [[] for _ in self.root['stacks']]
            valid = True
            for seat in self.live:
                hands, cumulative = self.ranges[seat]
                hand = hands[bisect_left(cumulative, rng.random()*cumulative[-1])]
                holes[seat] = list(hand)
                if used.intersection(hand):
                    valid = False
                    break
                used.update(hand)
            if valid:
                break
            self.sampling_rejections += 1
        else:
            raise ValueError('Unable to sample compatible ranges within rejection limit.')
        deck = [c for c in DECK if c not in used]
        rng.shuffle(deck)
        for seat, folded in enumerate(self.root['folded']):
            if folded:
                holes[seat] = [deck.pop(), deck.pop()]
        game = object.__new__(SampleGame)
        game.config = Config(**self.root['config'], seed=0)
        game.seat_count = len(self.root['stacks'])
        game.positions = {5: ['BTN','SB','BB','UTG','CO'], 6: ['BTN','SB','BB','UTG','HJ','CO']}[game.seat_count]
        for name in ('stacks', 'total', 'street_bets', 'folded', 'board'):
            setattr(game, name, list(self.root[name]))
        for name in ('street', 'current', 'last_raise', 'actor'):
            setattr(game, name, self.root[name])
        game.pending = set(self.root['pending'])
        game.acted = {int(k): tuple(v) for k, v in self.root['acted'].items()}
        game.history = [dict(e) for e in self.root['history']]
        game.holes, game.deck, game.initial_deck = holes, deck, []
        game.done, game.awards = False, []
        return game

    def train(self, iterations=1000, time_limit=2.):
        if type(iterations) is not int or not 1 <= iterations <= 1000000:
            raise ValueError('Positive iteration count <= 1000000 required.')
        if time_limit is not None and (not math.isfinite(time_limit) or time_limit <= 0):
            raise ValueError('Positive finite time limit required.')
        started = time.perf_counter()
        self.stop_reason = 'iteration_limit'
        for _ in range(iterations):
            if time_limit is not None and time.perf_counter()-started >= time_limit:
                self.stop_reason = 'time_limit'
                break
            try:
                for player in self.players:
                    world = self.sample_world()
                    episode = HoldemEpisode(world, self.root, self.options['bet_sizes'], self.options['max_raises'])
                    self.trainer.episode(episode, player)
            except CapacityLimit:
                self.stop_reason = 'capacity_limit'
                break
            self.iterations += 1
        return self.metrics(time.perf_counter()-started)

    def metrics(self, elapsed=None):
        return {'iterations': self.iterations, 'episodes': self.trainer.episodes,
                'information_sets': len(self.trainer.nodes), 'sampling_rejections': self.sampling_rejections,
                'stop_reason': self.stop_reason, 'elapsed_seconds': elapsed,
                'root_street': self.root['street'], 'live_players': len(self.live),
                'covers_remaining_streets': True, 'certified': False, 'converged': False,
                'exploitability': None, 'range_source': 'Heuristic public-action inferred ranges; no hidden cards.',
                'scope': 'Sampled self-play in a restricted betting/private-card abstraction. No equilibrium or strength certificate, especially for multiplayer.'}

    def advise(self, game, min_updates=16):
        if public_state(game) != self.root:
            raise ValueError('Policy requested for a different public subgame.')
        key = information_key(game, len(self.root['board']), len(self.root['history']))
        record = self.trainer.nodes.get(key)
        updates = record['updates'] if record else 0
        return (self.trainer.policy(key) if updates >= min_updates else None), updates

    def save(self, path):
        data = {'schema': SCHEMA, 'context': self.context, 'root': self.root, 'options': self.options,
                'iterations': self.iterations, 'episodes': self.trainer.episodes,
                'sampling_rejections': self.sampling_rejections,
                'rng': self.trainer.rng.getstate(), 'nodes': self.trainer.nodes, 'metrics': self.metrics()}
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + '.tmp')
        temporary.write_text(json.dumps(data, separators=(',', ':'), allow_nan=False), encoding='utf-8')
        temporary.replace(path)

    def resume(self, path):
        path = Path(path)
        if path.stat().st_size > 100_000_000:
            raise ValueError('Checkpoint exceeds 100 MB limit.')
        data = json.loads(path.read_text(encoding='utf-8'))
        if data.get('schema') != SCHEMA or data.get('context') != self.context:
            raise ValueError('Checkpoint schema/public state/options mismatch.')
        if data.get('root') != self.root or data.get('options') != self.options:
            raise ValueError('Checkpoint public state/options altered.')
        for field in ('iterations', 'episodes'):
            if type(data.get(field)) is not int or data[field] < 0:
                raise ValueError('Invalid checkpoint progress counter.')
        rejections = data.get('sampling_rejections', data.get('metrics', {}).get('sampling_rejections', 0))
        if type(rejections) is not int or rejections < 0:
            raise ValueError('Invalid checkpoint sampling counter.')
        nodes = data['nodes']
        if not isinstance(nodes, dict) or len(nodes) > self.options['max_infosets']:
            raise ValueError('Invalid checkpoint size.')
        for key, record in nodes.items():
            if not isinstance(key, str) or not isinstance(record, dict):
                raise ValueError('Invalid checkpoint node.')
            actions = record['actions']
            if not isinstance(actions, list) or not 1 <= len(actions) <= 8 or len(set(actions)) != len(actions):
                raise ValueError('Invalid action list.')
            for name in ('regrets', 'average'):
                values = record[name]
                if len(values) != len(actions) or any(type(x) not in (int, float) or not math.isfinite(x) or (name == 'average' and x < 0) for x in values):
                    raise ValueError('Invalid checkpoint numbers.')
            if type(record['updates']) is not int or record['updates'] < 0:
                raise ValueError('Invalid update count.')
        def tuples(v):
            return tuple(tuples(x) for x in v) if isinstance(v, list) else v
        restored = random.Random()
        restored.setstate(tuples(data['rng']))
        self.trainer.nodes, self.trainer.rng = nodes, restored
        self.trainer.episodes, self.iterations = data['episodes'], data['iterations']
        self.sampling_rejections = rejections
        self.stop_reason = 'resumed'


class SampledSolverBot:
    """Explicit experimental opt-in; sample count is not a GTO accuracy gate."""
    def __init__(self, *, allow_experimental=False, iterations=2000, time_limit=1.,
                 min_updates=16, cache_size=2, max_infosets=20000):
        if type(min_updates) is not int or min_updates < 1 or not 1 <= cache_size <= 8:
            raise ValueError('Invalid sampled policy limits.')
        self.allow_experimental = allow_experimental
        self.iterations, self.time_limit, self.min_updates = iterations, time_limit, min_updates
        self.cache_size, self.max_infosets = cache_size, max_infosets
        self.cache, self.lock = OrderedDict(), threading.RLock()
        self.last_status = {'source': 'not_used'}

    def load_checkpoint(self, path):
        """Load a validated public-state model for later matching decisions."""
        path = Path(path)
        if path.stat().st_size > 100_000_000:
            raise ValueError('Checkpoint exceeds 100 MB limit.')
        data = json.loads(path.read_text(encoding='utf-8'))
        from .train_solver import from_public
        game = from_public(data['root'])
        options = {k: data['options'][k] for k in ('seed', 'bet_sizes', 'max_raises', 'max_infosets')}
        if options['max_infosets'] > self.max_infosets:
            raise ValueError('Checkpoint exceeds this bot information-set limit.')
        solver = HoldemSolver(game, **options)
        solver.resume(path)
        with self.lock:
            self.cache[fingerprint(solver.root)] = solver
            while len(self.cache) > self.cache_size:
                self.cache.popitem(last=False)
        return solver.metrics()

    def advise(self, game, traits=None):
        if not self.allow_experimental:
            self.last_status = {'source': 'fallback', 'reason': 'uncertified_sampled_policy_disabled'}
            return None
        context = fingerprint(public_state(game))
        with self.lock:
            solver = self.cache.get(context)
            if solver is None:
                solver = HoldemSolver(game, seed=int(context[:12], 16), max_infosets=self.max_infosets)
                self.cache[context] = solver
                while len(self.cache) > self.cache_size:
                    self.cache.popitem(last=False)
            else:
                self.cache.move_to_end(context)
            metrics = solver.train(self.iterations, self.time_limit)
            row, updates = solver.advise(game, self.min_updates)
        if row is None:
            self.last_status = {'source': 'fallback', 'reason': 'insufficient_sampled_updates', 'updates': updates, 'metrics': metrics}
            return None
        from .solver_bot import handicap_policy
        row = handicap_policy(row, list(row), game.holes[game.actor], game.board, traits or NEUTRAL)
        self.last_status = {'source': 'sampled_solver_experimental', 'updates': updates, 'metrics': metrics}
        return row, 'Experimental all-street sampled CFR policy; abstracted cards/bets and inferred ranges; no certified GTO accuracy.'
