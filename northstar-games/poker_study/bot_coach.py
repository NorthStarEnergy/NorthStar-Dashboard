"""Evidence-based review against a common policy, not a claim of solved poker.

Stores only probability summaries and action categories, never private cards.
Corrections shrink toward the shared policy; they cannot create new styles.
"""
import copy
import hashlib
import json
import math
import sqlite3
import threading
import time
from contextlib import closing
from pathlib import Path

from .bot_policy import bound_deviation
from .personalities import NEUTRAL
from .opponent_memory import hand_identity

CATEGORIES = ('fold', 'call', 'check', 'raise')
WINDOW = 240
MIN_SAMPLES = 80
REVIEW_EVERY = 40
MAX_BLEND = .30
MAX_SHIFT = .03


def masses(row):
    return {c: sum(p for a, p in row.items() if a.split(':')[0] == c) for c in CATEGORIES}


def context(game):
    position = game.position(game.actor) if game.street == 'preflop' else ('multiway' if len(game.live()) > 2 else 'heads-up')
    return f"{game.street} · {position} · {'facing a bet' if game.legal()['call'] else 'free check'}"


def review(samples):
    """Compare opportunity-matched choices, not raw VPIP or money won/lost."""
    n = len(samples)
    if n < MIN_SAMPLES:
        return []
    findings = []
    for c in CATEGORIES:
        expected = sum(s['reference'][c] for s in samples)
        actual = sum(s['chosen'] == c for s in samples)
        policy = sum(s['policy'][c] for s in samples)
        variance = sum(s['reference'][c] * (1-s['reference'][c]) for s in samples)
        gap = (actual-expected)/n
        policy_gap = (policy-expected)/n
        # Both sampled behavior and the bot's policy must support the pattern.
        if abs(gap) < .08 or abs(policy_gap) < .04 or gap*policy_gap <= 0:
            continue
        z = abs(actual-expected)/math.sqrt(max(1., variance))
        if z < 2.5:
            continue
        word = {'fold':'folding', 'call':'calling', 'check':'checking', 'raise':'betting / raising'}[c]
        direction = 'too often' if gap > 0 else 'too rarely'
        findings.append({'category': c, 'direction': 1 if gap > 0 else -1,
                         'message': f'{word.capitalize()} {direction} relative to the shared strategy.',
                         'observed': round(actual/n, 4), 'reference': round(expected/n, 4),
                         'samples': n, 'evidence_score': round(z, 2)})
    return findings


class BotCoach:
    def __init__(self, path=None):
        self.path = Path(path) if path else None
        self.lock = threading.RLock()
        self.data = {}
        self.seen = set()
        self.error = ''
        if self.path:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with closing(sqlite3.connect(self.path, timeout=3)) as db, db:
                db.execute('CREATE TABLE IF NOT EXISTS coach_bots (id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
                db.execute('CREATE TABLE IF NOT EXISTS coach_seen (id TEXT PRIMARY KEY, updated REAL NOT NULL)')
                self.data = {k: json.loads(v) for k, v in db.execute('SELECT id,payload FROM coach_bots')}
                self.seen = {r[0] for r in db.execute('SELECT id FROM coach_seen')}

    def reference(self, strategy, game):
        return strategy.advise(game, NEUTRAL, [NEUTRAL]*game.seat_count)

    def prepare(self, game, identities, row, reference, source):
        bot = identities[game.actor]
        bucket = context(game)
        with self.lock:
            saved = self.data.get(bot, {}).get('contexts', {}).get(bucket, {})
            blend = saved.get('blend', 0.)
        # Correct an unambiguous error immediately: folding when checking is free.
        row = dict(row)
        free_fold = row.get('fold', 0.) if game.legal()['check'] else 0.
        if free_fold:
            row['check'] = row.get('check', 0.) + row.pop('fold')
        reference = dict(reference)
        if game.legal()['check'] and reference.get('fold', 0.):
            reference['check'] = reference.get('check', 0.) + reference.pop('fold')
        keys = row.keys() | reference.keys()
        distance = sum(abs(row.get(a,0)-reference.get(a,0)) for a in keys)/2
        weight = min(blend, MAX_SHIFT/distance) if distance else 0.
        corrected = {a:(1-weight)*row.get(a,0)+weight*reference.get(a,0) for a in keys}
        # Includes opponent-read adjustments in the same common-policy guardrail.
        corrected = bound_deviation(reference, corrected, limit=.10)
        corrected = {a:p for a,p in corrected.items() if p > 0}
        event = {'id': hashlib.sha256((hand_identity(game, identities)+':'+str(len(game.history))).encode()).hexdigest(),
                 'bot': bot, 'context': bucket, 'reference': masses(reference),
                 'policy': masses(row), 'delivered': masses(corrected),
                 'source': 'Shared neutral policy from the configured strategy engine',
                 'free_fold': bool(free_fold)}
        return corrected, event

    def record(self, event, chosen):
        """Call only after the engine has accepted the action. Duplicate-safe."""
        if not event['bot'].startswith('bot:'):
            return
        with self.lock:
            if event['id'] in self.seen:
                return
            bot = copy.deepcopy(self.data.get(event['bot'], {'decisions':0, 'contexts':{}, 'free_checks_saved':0}))
            bot['decisions'] += 1
            bot['updated'] = time.time()
            bot['free_checks_saved'] += int(event['free_fold'])
            bucket = bot['contexts'].setdefault(event['context'], {'samples':[], 'count':0, 'blend':0., 'pending':[], 'reviews':[], 'clean_reviews':0})
            sample = {k:event[k] for k in ('reference','policy','delivered')}
            sample['chosen'] = chosen.split(':')[0]
            bucket['samples'] = (bucket['samples']+[sample])[-WINDOW:]
            bucket['count'] += 1
            bucket['source'] = event['source']
            if bucket['count'] >= MIN_SAMPLES and bucket['count'] % REVIEW_EVERY == 0:
                findings = review(bucket['samples'])
                signs = [f"{f['category']}:{f['direction']}" for f in findings]
                confirmed = bool(set(signs) & set(bucket['pending']))
                prior = bucket['blend']
                if confirmed:
                    bucket['blend'] = min(MAX_BLEND, prior+.05)
                    bucket['clean_reviews'] = 0
                elif not findings:
                    bucket['clean_reviews'] += 1
                    if bucket['clean_reviews'] >= 2:
                        bucket['blend'] = max(0., prior-.05)
                else:
                    bucket['clean_reviews'] = 0
                bucket['pending'] = signs
                bucket['findings'] = findings
                bucket['reviews'] = (bucket['reviews']+[{'at':bot['updated'], 'decisions':bucket['count'],
                    'findings':findings, 'blend_before':prior, 'blend_after':bucket['blend'],
                    'status':'correcting' if confirmed else 'watching' if findings else 'within reference range'}])[-8:]
            try:
                if self.path:
                    with closing(sqlite3.connect(self.path, timeout=3)) as db, db:
                        if not db.execute('INSERT OR IGNORE INTO coach_seen VALUES (?,?)', (event['id'],bot['updated'])).rowcount:
                            return
                        db.execute('INSERT OR REPLACE INTO coach_bots VALUES (?,?)', (event['bot'],json.dumps(bot)))
                        db.execute('DELETE FROM coach_seen WHERE id IN (SELECT id FROM coach_seen ORDER BY updated DESC LIMIT -1 OFFSET 20000)')
                self.data[event['bot']] = bot
                self.seen.add(event['id'])
                if len(self.seen) > 22000:
                    if self.path:
                        with closing(sqlite3.connect(self.path)) as db:
                            self.seen = {r[0] for r in db.execute('SELECT id FROM coach_seen')}
                    else:
                        self.seen = {event['id']}
                self.error = ''
            except (sqlite3.Error, OSError) as error:
                # Keep the game playable; reports explicitly show unavailable storage.
                self.error = type(error).__name__

    def report(self, roster):
        with self.lock:
            bots = []
            for person in roster:
                saved = self.data.get('bot:'+person.id, {})
                contexts = []
                for name, b in saved.get('contexts', {}).items():
                    samples = b['samples']
                    raw = sum(sum(abs(s['policy'][c]-s['reference'][c]) for c in CATEGORIES)/2 for s in samples)
                    delivered = sum(sum(abs(s['delivered'][c]-s['reference'][c]) for c in CATEGORIES)/2 for s in samples)
                    contexts.append({'name':name, 'decisions':b['count'], 'sample_size':len(samples),
                        'blend':b['blend'], 'findings':b.get('findings',[]), 'reviews':b['reviews'],
                        'source':b.get('source',''), 'raw_distance':raw/max(1,len(samples)),
                        'delivered_distance':delivered/max(1,len(samples))})
                bots.append({'id':person.id, 'name':person.name, 'decisions':saved.get('decisions',0),
                             'free_checks_saved':saved.get('free_checks_saved',0), 'contexts':contexts})
            return {'enabled':True, 'error':self.error, 'bots':bots, 'min_samples':MIN_SAMPLES,
                    'max_probability_shift':MAX_SHIFT, 'max_reference_distance':.10,
                    'method':'Shared-strategy review; likely leaks, not proven EV mistakes. Two reviews with new decisions are required before coaching. No private cards or hand results are stored.',
                    'updated':time.time()}


if __name__ == '__main__':
    import argparse
    from .league_roster import LEAGUE_POOL
    parser = argparse.ArgumentParser(description='Read the persistent NorthStar bot coaching report')
    parser.add_argument('--db', type=Path, required=True)
    args = parser.parse_args()
    if not args.db.is_file():
        parser.error('Coaching database does not exist yet.')
    print(json.dumps(BotCoach(args.db).report(LEAGUE_POOL), indent=2))
