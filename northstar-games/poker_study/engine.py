import json
import random
from dataclasses import dataclass, field, asdict
from pathlib import Path
from .cards import DECK, rank, validate

@dataclass
class Config:
    stacks: list[int] = field(default_factory=lambda: [10000] * 6)
    small_blind: int = 50
    big_blind: int = 100
    button: int = 0
    seed: int = 1

    def validate(self):
        if len(self.stacks) not in (5,6) or any(type(s) is not int or s <= 0 for s in self.stacks):
            raise ValueError('Exactly five or six positive integer stacks required.')
        if type(self.small_blind) is not int or type(self.big_blind) is not int or not 0 < self.small_blind <= self.big_blind:
            raise ValueError('Require 0 < small blind <= big blind, in integer chips.')
        if type(self.button) is not int or not 0 <= self.button < len(self.stacks): raise ValueError('Button must be 0–5.')

class Game:
    hand_rank = staticmethod(rank)
    def __init__(self, config=None, deck=None):
        self.config = Config(**asdict(config)) if config is not None else Config()
        self.config.validate()
        self.seat_count=len(self.config.stacks)
        self.positions={5:['BTN','SB','BB','UTG','CO'],6:['BTN','SB','BB','UTG','HJ','CO']}[self.seat_count]
        self.stacks = self.config.stacks.copy()
        self.deck = list(deck) if deck is not None else DECK.copy()
        validate(self.deck)
        if len(self.deck) != 52: raise ValueError('Replay deck must contain all 52 cards.')
        if deck is None: random.Random(self.config.seed).shuffle(self.deck)
        self.initial_deck = self.deck.copy()
        self.holes = [[] for _ in range(self.seat_count)]
        for _ in range(2):
            for offset in range(1, self.seat_count+1): self.holes[(self.config.button + offset) % self.seat_count].append(self.deck.pop())
        self.board, self.history, self.awards = [], [], []
        self.folded = [False] * self.seat_count
        self.total, self.street_bets = [0] * self.seat_count, [0] * self.seat_count
        self.street, self.done = 'preflop', False
        self.current, self.last_raise = self.config.big_blind, self.config.big_blind
        self.acted = {}
        self._pay((self.config.button + 1) % self.seat_count, self.config.small_blind)
        self._pay((self.config.button + 2) % self.seat_count, self.config.big_blind)
        self.pending = set(self.active())
        self.actor = (self.config.button + 3) % self.seat_count
        self._advance((self.actor - 1) % self.seat_count)

    @property
    def pot(self): return 0 if self.done else sum(self.total)

    def active(self): return [i for i in range(self.seat_count) if not self.folded[i] and self.stacks[i] > 0]
    def live(self): return [i for i in range(self.seat_count) if not self.folded[i]]
    def position(self, i): return self.positions[(i - self.config.button) % self.seat_count]
    def _pay(self, i, amount):
        amount = min(amount, self.stacks[i])
        self.stacks[i] -= amount
        self.total[i] += amount
        self.street_bets[i] += amount

    def legal(self):
        if self.done: return {}
        i = self.actor
        call = min(max(0, self.current - self.street_bets[i]), self.stacks[i])
        maximum = self.street_bets[i] + self.stacks[i]
        reopened = i not in self.acted or self.current - self.acted[i][0] >= self.acted[i][1]
        can_raise = reopened and maximum > self.current and any(j != i for j in self.active())
        minimum = self.current + self.last_raise if self.current else self.config.big_blind
        return {'fold': True, 'check': call == 0, 'call': call,
                'raise_min': min(minimum, maximum) if can_raise else None,
                'raise_max': maximum if can_raise else None}

    def act(self, action, amount=None):
        if self.done: raise ValueError('Hand is over.')
        i, legal = self.actor, self.legal()
        if action == 'fold': self.folded[i] = True
        elif action == 'check' and legal['check']: pass
        elif action == 'call' and legal['call'] > 0: self._pay(i, legal['call'])
        elif action == 'raise' and type(amount) is int and legal['raise_min'] is not None and legal['raise_min'] <= amount <= legal['raise_max']:
            increase = amount - self.current
            self._pay(i, amount - self.street_bets[i])
            if increase >= self.last_raise: self.last_raise = increase
            self.current = amount
            self.pending.update(j for j in self.active() if self.street_bets[j] < self.current)
        else: raise ValueError(f'Illegal action. Legal options: {legal}')
        self.history.append({'street': self.street, 'seat': i, 'action': action, 'amount': amount if action == 'raise' else None})
        self.acted[i] = (self.current, self.last_raise)
        self.pending.discard(i)
        self._advance(i)

    def _advance(self, previous):
        if len(self.live()) == 1:
            winner = self.live()[0]
            amount = sum(self.total)
            self.stacks[winner] += amount
            self.awards = [{'amount': amount, 'winners': [winner]}]
            self.done, self.actor = True, None
            return
        self.pending.intersection_update(self.active())
        active = self.active()
        if len(active) <= 1 and (not active or self.street_bets[active[0]] >= self.current): self.pending.clear()
        if self.pending:
            self.actor = next((previous + k) % self.seat_count for k in range(1, self.seat_count+1) if (previous + k) % self.seat_count in self.pending)
            return
        if self.street == 'river':
            self._showdown()
            return
        self.deck.pop()  # burn
        count = 3 if self.street == 'preflop' else 1
        self.board.extend(self.deck.pop() for _ in range(count))
        self.street = {'preflop': 'flop', 'flop': 'turn', 'turn': 'river'}[self.street]
        self.street_bets = [0] * self.seat_count
        self.current, self.last_raise, self.acted = 0, self.config.big_blind, {}
        self.pending = set(self.active())
        self._advance(self.config.button)

    def _showdown(self):
        scores = {i: self.hand_rank(self.holes[i] + self.board) for i in self.live()}
        previous = 0
        for level in sorted(set(self.total) - {0}):
            contributors = [i for i in range(self.seat_count) if self.total[i] >= level]
            amount = (level - previous) * len(contributors)
            eligible = [i for i in contributors if i in scores]
            if len(contributors) == 1: winners = contributors  # uncalled excess returned
            else:
                best = max(scores[i] for i in eligible)
                winners = [i for i in eligible if scores[i] == best]
            winners.sort(key=lambda i: (i - self.config.button - 1) % self.seat_count)
            share, odd = divmod(amount, len(winners))
            for n, i in enumerate(winners): self.stacks[i] += share + (n < odd)
            self.awards.append({'amount': amount, 'winners': winners})
            previous = level
        self.done, self.actor = True, None

    def view(self, seat=None):
        seat = self.actor if seat is None else seat
        return {'street': self.street, 'board': self.board.copy(), 'pot': self.pot,
                'stacks': self.stacks.copy(), 'street_bets': self.street_bets.copy(),
                'folded': self.folded.copy(), 'actor': self.actor,
                'position': self.position(seat) if seat is not None else None,
                'hole': self.holes[seat].copy() if seat is not None else [], 'legal': self.legal(),
                'awards': self.awards.copy()}

    def save(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(json.dumps({'version': 1, 'config': asdict(self.config),
            'deck': self.initial_deck, 'actions': self.history, 'final_stacks': self.stacks}, indent=2), encoding='utf-8')

def replay(path):
    data = json.loads(Path(path).read_text(encoding='utf-8'))
    return replay_data(data)

def replay_data(data):
    if data['version'] != 1: raise ValueError('Unsupported history version.')
    game = Game(Config(**data['config']), data['deck'])
    views = [game.view()]
    for event in data['actions']:
        if event['seat'] != game.actor or event['street'] != game.street: raise ValueError('History turn mismatch.')
        game.act(event['action'], event.get('amount'))
        views.append(game.view())
    if game.stacks != data['final_stacks']: raise ValueError('History result mismatch.')
    return game, views

