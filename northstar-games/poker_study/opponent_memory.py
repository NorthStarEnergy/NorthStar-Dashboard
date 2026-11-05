"""Private, per-bot reads learned only from public actions at its own tables."""
import copy
import hashlib
import json
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

from .bot_policy import features, strength
from .personalities import NEUTRAL

DECAY = .99
PRIOR = 24
MAX_SHIFT = .03
METRICS = {'vpip': ('pre', .28), 'pfr': ('pre', .20),
           'fold': ('faced', .45), 'aggression': ('post', .30),
           'size': ('raises', .70)}


def observations(game):
    """Reconstruct opportunities, not just raw action counts. No card access."""
    names = ('pre', 'vpip', 'pfr', 'faced', 'fold', 'post', 'aggression', 'raises', 'size')
    rows = [dict.fromkeys(names, 0.) for _ in range(game.seat_count)]
    stacks = game.config.stacks.copy()
    bets = [0] * game.seat_count
    pot = 0
    current = game.config.big_blind
    for seat, blind in [((game.config.button + 1) % game.seat_count, game.config.small_blind),
                        ((game.config.button + 2) % game.seat_count, game.config.big_blind)]:
        paid = min(stacks[seat], blind)
        stacks[seat] -= paid; bets[seat] += paid; pot += paid
    street = 'preflop'
    for event in game.history:
        if event['street'] != street:
            street = event['street']; bets = [0] * game.seat_count; current = 0
        seat, action = event['seat'], event['action']
        row = rows[seat]
        call = min(stacks[seat], max(0, current - bets[seat]))
        if street == 'preflop':
            row['pre'] = 1
            if action in ('call', 'raise'): row['vpip'] = 1
            if action == 'raise': row['pfr'] = 1
        else:
            row['post'] += 1
            row['aggression'] += action == 'raise'
        if call:
            row['faced'] += 1
            row['fold'] += action == 'fold'
        if action == 'raise':
            if street != 'preflop':
                row['raises'] += 1
                row['size'] += min(2., (event['amount'] - current) / max(1, pot + call))
            paid = event['amount'] - bets[seat]
            current = event['amount']
        else:
            paid = call if action == 'call' else 0
        stacks[seat] -= paid; bets[seat] += paid; pot += paid
    return rows


def perception(profile):
    counts = profile.get('counts', {})
    return {metric: (counts.get(metric, 0) + PRIOR * prior) /
            (counts.get(denominator, 0) + PRIOR)
            for metric, (denominator, prior) in METRICS.items()}


class OpponentMemory:
    def __init__(self, path=None):
        self.path = Path(path) if path else None
        self.lock = threading.RLock()
        self.profiles, self.seen, self.decisions = {}, set(), {}
        if self.path:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.connection() as db:
                db.execute('CREATE TABLE IF NOT EXISTS bot_reads (observer TEXT, opponent TEXT, payload TEXT NOT NULL, PRIMARY KEY(observer,opponent))')
                db.execute('CREATE TABLE IF NOT EXISTS bot_observed_hands (hand TEXT PRIMARY KEY)')
                db.execute('CREATE TABLE IF NOT EXISTS bot_decisions (observer TEXT PRIMARY KEY, payload TEXT NOT NULL)')

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=15)
        try:
            with db: yield db
        finally:
            db.close()

    def _get(self, observer, opponent, db=None):
        if db is not None:
            row = db.execute('SELECT payload FROM bot_reads WHERE observer=? AND opponent=?', (observer, opponent)).fetchone()
            return json.loads(row[0]) if row else {}
        return copy.deepcopy(self.profiles.get((observer, opponent), {}))

    def profile(self, observer, opponent):
        with self.lock:
            if self.path:
                with self.connection() as db: return self._get(observer, opponent, db)
            return self._get(observer, opponent)

    def observe(self, hand_id, game, identities):
        if not game.done: return
        rows = observations(game)
        with self.lock:
            if self.path:
                with self.connection() as db:
                    db.execute('BEGIN IMMEDIATE')
                    if not db.execute('INSERT OR IGNORE INTO bot_observed_hands VALUES (?)', (hand_id,)).rowcount: return
                    self._update(hand_id, identities, rows, db)
            elif hand_id not in self.seen:
                self._update(hand_id, identities, rows)
                self.seen.add(hand_id)

    def _update(self, hand_id, identities, rows, db=None):
        for observer in identities:
            if not observer.startswith('bot:'): continue
            for opponent, observed in zip(identities, rows):
                if opponent == observer or not any(observed.values()): continue
                profile = self._get(observer, opponent, db)
                counts = profile.setdefault('counts', {})
                for name, value in observed.items(): counts[name] = counts.get(name, 0) * DECAY + value
                profile['hands'] = profile.get('hands', 0) + 1
                profile['recent'] = (profile.get('recent', []) + [{'hand': hand_id, 'observed': observed}])[-12:]
                if db is not None:
                    db.execute('INSERT OR REPLACE INTO bot_reads VALUES (?,?,?)', (observer, opponent, json.dumps(profile)))
                else: self.profiles[observer, opponent] = profile

    def adjust(self, game, identities, row, traits=NEUTRAL):
        """Reweight existing legal actions; cap total probability moved at 3pp."""
        observer = identities[game.actor]
        if not observer.startswith('bot:'): return row, {}
        active = [j for j in game.live() if j != game.actor]
        # When facing a bet, put the read on the bettor rather than folded seats.
        bettor = next((e['seat'] for e in reversed(game.history)
                       if e['street'] == game.street and e['action'] == 'raise' and e['seat'] in active), None)
        targets = [bettor] if bettor is not None and game.legal()['call'] else active
        reads = {identities[j]: perception(self.profile(observer, identities[j])) for j in targets}
        if not reads: return row, reads
        average = {metric: sum(r[metric] for r in reads.values()) / len(reads) for metric in METRICS}
        loose = (average['vpip'] - .28) + (average['pfr'] - .20) * .5
        pressure = average['aggression'] - .30
        folds = average['fold'] - .45
        large = average['size'] - .70
        own = game.holes[game.actor]
        value = strength(own) >= .72 if game.street == 'preflop' else features(own, game.board)['made'] >= 1
        aggression = (.10 * loose - .10 * folds) if value else .24 * folds - .08 * loose
        defense = .12 * loose + .10 * pressure - .04 * large
        sensitivity = max(.8, min(1.2, 1 + traits.bet_bias - traits.fold_bias))
        weights = {}
        for action, probability in row.items():
            change = aggression if action.startswith('raise:') else -defense if action == 'fold' else defense if action == 'call' else -aggression
            weights[action] = probability * (1 + max(-.12, min(.12, change * sensitivity)))
        total = sum(weights.values())
        adjusted = {a: p / total for a, p in weights.items()}
        distance = sum(abs(adjusted[a] - row[a]) for a in row) / 2
        blend = min(1., MAX_SHIFT / distance) if distance else 1.
        return {a: (1 - blend) * row[a] + blend * adjusted[a] for a in row}, reads

    def record_decisions(self, records):
        if not records: return
        with self.lock:
            if self.path:
                with self.connection() as db:
                    db.execute('BEGIN IMMEDIATE')
                    for observer in {r['observer'] for r in records}:
                        saved = db.execute('SELECT payload FROM bot_decisions WHERE observer=?', (observer,)).fetchone()
                        history = json.loads(saved[0]) if saved else []
                        history = (history + [r for r in records if r['observer'] == observer])[-40:]
                        db.execute('INSERT OR REPLACE INTO bot_decisions VALUES (?,?)', (observer, json.dumps(history)))
            else:
                for record in records:
                    observer = record['observer']
                    self.decisions[observer] = (self.decisions.get(observer, []) + [copy.deepcopy(record)])[-40:]


def hand_identity(game, identities):
    # Seed is solely a deduplication key; it never enters observations or decisions.
    return hashlib.sha256(json.dumps([game.config.seed, identities, game.config.stacks, game.config.button]).encode()).hexdigest()


def decision_record(game, identities, base, adjusted, reads, chosen):
    return {'observer': identities[game.actor], 'street': game.street, 'action_index': len(game.history),
            'base': base, 'probabilities': adjusted, 'reads': reads, 'chosen': chosen}
