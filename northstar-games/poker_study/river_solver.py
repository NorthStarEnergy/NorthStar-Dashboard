"""Original CFR+ implementation for a two-player, fixed-range NLHE river subgame.

The abstraction starts with no river wagers, equal effective stacks, no rake,
and player 0 first. Opening bets and raises use configured pot fractions plus
all-in; raises are capped. This is not a full-game or multiplayer GTO claim.
Ranges must be based on public information, never the other player's hole cards.
No opponent private cards enter any information set. Exact best responses use
the same finite betting tree and supplied ranges as training.

Algorithm references: Tammelin, CFR+ (arXiv:1407.5042), and OpenSpiel's CFR /
exploitability documentation. This implementation does not copy their code.
"""
from collections.abc import Mapping
from dataclasses import dataclass, field
import math
import time

import numpy as np

from .cards import DECK, rank, validate

_CARD_INDEX = {card: index for index, card in enumerate(DECK)}


def canonical_combo(cards):
    """Return exact two-card key in deck order, e.g. KhAs (not hand class AKo)."""
    if isinstance(cards, str):
        cards = cards.replace(' ', '').replace(',', '')
        cards = [cards[:2], cards[2:]] if len(cards) == 4 else []
    cards = list(cards)
    validate(cards)
    if len(cards) != 2:
        raise ValueError('Each range entry must contain two exact cards.')
    return ''.join(sorted(cards, key=_CARD_INDEX.__getitem__))


def _read_range(raw, board):
    entries = raw.items() if isinstance(raw, Mapping) else raw
    combined, blocked = {}, 0
    try:
        for combo, raw_weight in entries:
            key = canonical_combo(combo)
            if isinstance(raw_weight, bool):
                raise ValueError('Range weights must be finite nonnegative numbers.')
            weight = float(raw_weight)
            if not math.isfinite(weight) or weight < 0:
                raise ValueError('Range weights must be finite nonnegative numbers.')
            if key[:2] in board or key[2:] in board:
                blocked += 1
                continue
            if weight:
                combined.setdefault(key, []).append(weight)
    except (TypeError, OverflowError) as exc:
        raise ValueError('Ranges must map exact hole combinations to weights.') from exc
    if not combined:
        raise ValueError('Each range needs positive board-compatible weight.')
    keys = sorted(combined, key=lambda k: (_CARD_INDEX[k[:2]], _CARD_INDEX[k[2:]]))
    # Scaling before combining duplicate orientations also prevents overflow.
    largest = max(max(values) for values in combined.values())
    weights = np.asarray([math.fsum(weight/largest for weight in combined[k]) for k in keys], dtype=np.float64)
    weights /= weights.sum()
    return keys, weights, blocked


@dataclass
class _Node:
    path: str
    player: int | None
    commitments: tuple
    terminal: str | None = None
    winner: int | None = None
    actions: list = field(default_factory=list)
    children: list = field(default_factory=list)
    regrets: np.ndarray | None = None
    total: np.ndarray | None = None


class RiverGame:
    """Finite river game; public for independent policy evaluation and tests.

    ``ranges`` is two mappings ``{'AsKh': 1.0, ...}``, or two iterables of
    ``((card, card), weight)`` pairs. Board-blocked combinations are excluded;
    opposing combinations sharing a card have zero joint chance probability.
    ``max_raises`` counts raises after the initial bet, not the opening bet.
    All chip amounts are positive integers (stack may be zero).
    """

    def __init__(self, board, ranges, pot, stack, *, min_bet=1,
                 bet_sizes=(0.5, 1.0), max_raises=2):
        self.board = list(board)
        validate(self.board)
        if len(self.board) != 5:
            raise ValueError('River solving requires exactly five board cards.')
        if len(ranges) != 2:
            raise ValueError('Exactly two public ranges are required.')
        if type(pot) is not int or pot <= 0:
            raise ValueError('pot must be a positive integer chip amount.')
        if type(stack) is not int or stack < 0:
            raise ValueError('stack must be a nonnegative integer chip amount.')
        if type(min_bet) is not int or min_bet <= 0:
            raise ValueError('min_bet must be a positive integer chip amount.')
        if type(max_raises) is not int or not 0 <= max_raises <= 3:
            raise ValueError('max_raises must be between 0 and 3.')
        sizes = tuple(sorted(set(float(size) for size in bet_sizes)))
        if not sizes or len(sizes) > 5 or any(not math.isfinite(s) or s <= 0 for s in sizes):
            raise ValueError('Use between one and five finite positive pot fractions.')
        self.pot, self.stack, self.min_bet = pot, stack, min_bet
        self.bet_sizes, self.max_raises = sizes, max_raises
        loaded = [_read_range(raw, set(self.board)) for raw in ranges]
        self.hands = [item[0] for item in loaded]
        self.weights = [item[1] for item in loaded]
        self.board_blocked = [item[2] for item in loaded]
        self.cards = [np.asarray([[_CARD_INDEX[k[:2]], _CARD_INDEX[k[2:]]] for k in keys])
                      for keys in self.hands]
        scores = {key: rank(self.board + [key[:2], key[2:]])
                  for key in set(self.hands[0] + self.hands[1])}
        ordered = {score: index for index, score in enumerate(sorted(set(scores.values())))}
        self.rank_count = len(ordered)
        self.ranks = [np.asarray([ordered[scores[key]] for key in keys]) for keys in self.hands]
        self.card_rank = [cards * self.rank_count + ranks[:, None]
                          for cards, ranks in zip(self.cards, self.ranks)]
        self.same = []
        for player in (0, 1):
            other = {key: index for index, key in enumerate(self.hands[1-player])}
            self.same.append(np.asarray([other.get(key, -1) for key in self.hands[player]]))
        self.normalizer = float(self.weights[0] @ self.compatible_mass(0, self.weights[1]))
        if self.normalizer <= 1e-15:
            raise ValueError('Compatible joint range mass is zero or below the 1e-15 numerical tolerance.')
        self.nodes = {}
        self.root = self._tree('root', 0, (0, 0), False, 0, min_bet)

    def compatible_mass(self, player, opponent_reach):
        """Opponent mass excluding both of our cards, with overlap correction."""
        other = 1-player
        card_mass = np.bincount(self.cards[other].ravel(),
                               weights=np.repeat(opponent_reach, 2), minlength=52)
        result = opponent_reach.sum() - card_mass[self.cards[player]].sum(axis=1)
        same = self.same[player]
        valid = same >= 0
        result[valid] += opponent_reach[same[valid]]
        return np.maximum(result, 0.0)

    def showdown_mass(self, player, opponent_reach):
        """Win-minus-loss mass using rank prefixes and exact card removal."""
        other = 1-player
        bins = np.bincount(self.ranks[other], weights=opponent_reach, minlength=self.rank_count)
        prefix = np.cumsum(bins)
        own = self.ranks[player]
        score = 2 * prefix[own] - bins[own] - prefix[-1]
        card_bins = np.bincount(self.card_rank[other].ravel(),
                               weights=np.repeat(opponent_reach, 2),
                               minlength=52*self.rank_count).reshape(52, self.rank_count)
        card_prefix = np.cumsum(card_bins, axis=1)
        for column in (0, 1):
            card = self.cards[player][:, column]
            score -= 2 * card_prefix[card, own] - card_bins[card, own] - card_prefix[card, -1]
        # A combination overlapping in both cards has equal rank, so its
        # win-minus-loss contribution is zero; no double-overlap add-back.
        return score

    def terminal_values(self, node, player, opponent_reach):
        """Per-own-hand counterfactual chip values, centered on half the pot."""
        if node.terminal == 'fold':
            loser = 1-node.winner
            payoff = self.pot/2 + node.commitments[loser]
            return self.compatible_mass(player, opponent_reach) * (payoff if player == node.winner else -payoff)
        return self.showdown_mass(player, opponent_reach) * (self.pot/2 + node.commitments[player])

    def _tree(self, path, player, commitments, checked, raises, last_raise,
              terminal=None, winner=None):
        node = _Node(path, None if terminal else player, commitments, terminal, winner)
        self.nodes[path] = node
        if len(self.nodes) > 3000:
            raise ValueError('Betting abstraction exceeds the 3000-node safety limit.')
        if terminal:
            return node
        if self.stack == 0:
            node.player, node.terminal = None, 'showdown'
            return node
        current, other = max(commitments), 1-player
        call = current-commitments[player]

        def add(label, next_commitments=commitments, next_checked=False,
                next_raises=raises, next_last_raise=last_raise, end=None, won=None):
            node.actions.append(label)
            node.children.append(self._tree(path+'/'+label, other, next_commitments,
                                           next_checked, next_raises, next_last_raise, end, won))

        if call:
            add('fold', end='fold', won=other)
            add('call', (current, current), end='showdown')
        else:
            add('check', next_checked=True, end='showdown' if checked else None)
        if current < self.stack and (not call or raises < self.max_raises):
            minimum = current+last_raise if call else self.min_bet
            pot_after_call = self.pot + sum(commitments) + call
            targets = {min(self.stack, max(minimum, current+int(math.floor(fraction*pot_after_call+0.5))))
                       for fraction in self.bet_sizes}
            targets.add(self.stack)
            for target in sorted(targets):
                updated = list(commitments)
                updated[player] = target
                add('raise:'+str(target), tuple(updated), next_raises=raises+(1 if call else 0),
                    next_last_raise=target-current)
        shape = (len(self.hands[player]), len(node.actions))
        node.regrets = np.zeros(shape)
        node.total = np.zeros(shape)
        return node

    @staticmethod
    def _normalize(matrix):
        totals = matrix.sum(axis=1, keepdims=True)
        result = np.full(matrix.shape, 1/matrix.shape[1])
        np.divide(matrix, totals, out=result, where=totals > 0)
        return result

    def current_policy(self):
        return {path: self._normalize(node.regrets) for path, node in self.nodes.items() if node.player is not None}

    def average_policy(self):
        return {path: self._normalize(node.total) for path, node in self.nodes.items() if node.player is not None}

    def train_player(self, player, iteration):
        policy = self.current_policy()

        def walk(node, own_reach, opponent_reach):
            if node.terminal:
                return self.terminal_values(node, player, opponent_reach)
            probs = policy[node.path]
            if node.player == player:
                values = np.column_stack([walk(child, own_reach*probs[:, index], opponent_reach)
                                          for index, child in enumerate(node.children)])
                value = (values*probs).sum(axis=1)
                node.regrets = np.maximum(0, node.regrets + values-value[:, None])
                node.total += iteration*own_reach[:, None]*probs
                return value
            values = [walk(child, own_reach, opponent_reach*probs[:, index])
                      for index, child in enumerate(node.children)]
            return np.sum(values, axis=0)

        walk(self.root, np.ones(len(self.hands[player])), self.weights[1-player])

    def evaluate(self, policy, player=0, best_response=False):
        """Exact EV or BR in this abstraction, never maximizing over opponent cards."""
        if player not in (0, 1):
            raise ValueError('player must be 0 or 1.')

        def walk(node, opponent_reach):
            if node.terminal:
                return self.terminal_values(node, player, opponent_reach)
            if node.player == player:
                values = np.column_stack([walk(child, opponent_reach) for child in node.children])
                return values.max(axis=1) if best_response else (values*policy[node.path]).sum(axis=1)
            probs = policy[node.path]
            return np.sum([walk(child, opponent_reach*probs[:, index])
                           for index, child in enumerate(node.children)], axis=0)

        return float(self.weights[player] @ walk(self.root, self.weights[1-player]) / self.normalizer)

    def metrics(self, policy):
        ev = self.evaluate(policy)
        best = [self.evaluate(policy, player, True) for player in (0, 1)]
        nash_conv = max(0.0, sum(best))
        return {'player0_ev': ev, 'player1_ev': -ev, 'best_response_ev': best,
                'nash_conv': nash_conv, 'exploitability': nash_conv/2,
                'exploitability_pot_fraction': nash_conv/(2*self.pot),
                'exploitability_fraction_pot': nash_conv/(2*self.pot),
                'units': 'chips; original pot split equally for zero-sum centering',
                'scope': 'Exact best responses only in this two-player river betting abstraction and supplied ranges.'}

    def export_nodes(self, policy):
        nodes = {}
        prior_mass = [self.compatible_mass(player, self.weights[1-player]) for player in (0, 1)]

        def walk(node, reaches):
            path = node.path
            mass = self.compatible_mass(0, self.weights[1]*reaches[1])
            public_reach = float((self.weights[0]*reaches[0]) @ mass / self.normalizer)
            record = {'player': node.player, 'commitments': list(node.commitments),
                      'public_reach_probability': max(0.0, min(1.0, public_reach))}
            if node.terminal:
                record.update(terminal=node.terminal, winner=node.winner)
            else:
                player = node.player
                other_mass = self.compatible_mass(player, self.weights[1-player]*reaches[1-player])
                hand_reach = np.zeros(len(self.hands[player]))
                np.divide(reaches[player]*other_mass, prior_mass[player], out=hand_reach,
                          where=prior_mass[player] > 1e-15)
                hand_reach = np.clip(hand_reach, 0, 1)
                record.update(actions=node.actions,
                              children={action: child.path for action, child in zip(node.actions, node.children)},
                              strategy={key: policy[path][index].tolist()
                                        for index, key in enumerate(self.hands[player])},
                              hand_reach_probability=dict(zip(self.hands[player], hand_reach.tolist())))
            nodes[path] = record
            for index, child in enumerate(node.children):
                next_reaches = list(reaches)
                next_reaches[node.player] = reaches[node.player]*policy[path][:, index]
                walk(child, next_reaches)

        walk(self.root, [np.ones(len(hands)) for hands in self.hands])
        return nodes


def solve_river(board, ranges, pot, stack, *, min_bet=1, bet_sizes=(0.5, 1.0),
                max_raises=2, iterations=1000, target_exploitability=0.005,
                time_limit=10.0, check_every=25):
    """Solve and return a JSON-serializable average policy plus exact diagnostics.

    ``target_exploitability`` is a fraction of the initial pot; ``None`` disables
    convergence stopping. ``time_limit`` bounds training approximately, checked
    between iterations; setup, one iteration, metrics, and export can overrun it.
    Policies are at ``result['nodes']['root']['strategy'][canonical_combo(hole)]``.
    Zero iterations are never represented as trained; reaching a cap does not
    imply the target was achieved. No private combinations are sampled away.
    """
    if type(iterations) is not int or not 1 <= iterations <= 1_000_000:
        raise ValueError('iterations must be between 1 and 1000000.')
    if type(check_every) is not int or check_every < 1:
        raise ValueError('check_every must be positive.')
    if target_exploitability is not None and (not math.isfinite(target_exploitability) or target_exploitability < 0):
        raise ValueError('target_exploitability must be a nonnegative finite pot fraction or None.')
    if time_limit is not None and (not math.isfinite(time_limit) or time_limit <= 0):
        raise ValueError('time_limit must be positive and finite or None.')
    started = time.perf_counter()
    game = RiverGame(board, ranges, pot, stack, min_bet=min_bet, bet_sizes=bet_sizes, max_raises=max_raises)
    setup_seconds = time.perf_counter()-started
    train_started = time.perf_counter()
    completed, stop_reason, result_metrics = 0, 'iteration_limit', None
    for iteration in range(1, iterations+1):
        if time_limit is not None and time.perf_counter()-train_started >= time_limit:
            stop_reason = 'time_limit'
            break
        for player in (0, 1):
            game.train_player(player, iteration)
        completed = iteration
        if iteration % check_every == 0 or iteration == iterations:
            result_metrics = game.metrics(game.average_policy())
            if target_exploitability is not None and result_metrics['exploitability_pot_fraction'] <= target_exploitability:
                stop_reason = 'target_reached'
                break
    training_seconds = time.perf_counter()-train_started
    policy = game.average_policy()
    # Always re-evaluate the actual returned policy, even after a cap between checks.
    result_metrics = game.metrics(policy)
    converged = target_exploitability is not None and result_metrics['exploitability_pot_fraction'] <= target_exploitability
    result_metrics.update(iterations=completed, stop_reason=stop_reason, target_reached=converged, converged=converged,
                          setup_seconds=setup_seconds, training_seconds=training_seconds,
                          hand_counts=[len(hands) for hands in game.hands],
                          board_blocked_combinations=game.board_blocked,
                          node_count=len(game.nodes), sampled_ranges=False)
    result = {'schema': 'northstar-river-cfr/1', 'algorithm': 'alternating CFR+ with linearly weighted average strategies',
              'config': {'board': game.board, 'pot': pot, 'stack': stack, 'min_bet': min_bet,
                         'bet_sizes': list(game.bet_sizes), 'max_raises': max_raises, 'opening_player': 0,
                         'target_exploitability_pot_fraction': target_exploitability,
                         'iteration_limit': iterations, 'time_limit_seconds': time_limit},
              'ranges': [dict(zip(hands, weights.tolist())) for hands, weights in zip(game.hands, game.weights)],
              'nodes': game.export_nodes(policy), 'metrics': result_metrics}
    result_metrics['elapsed_seconds'] = time.perf_counter()-started
    return result
