"""Public, completed-hand records for poker ranking profiles."""
import json
import sqlite3
import threading
from collections import defaultdict
from contextlib import closing
from pathlib import Path


class PlayerProfiles:
    def __init__(self, path):
        self.path = Path(path) if path else None
        self.memory = defaultdict(dict)
        self.lock = threading.RLock()

    def record(self, profile_id, hand_no, hand):
        self.record_many([(profile_id, hand_no, hand)])

    def record_many(self, entries):
        rows = [(profile_id, hand_no, dict(hand, hand_no=hand_no))
                for profile_id, hand_no, hand in entries]
        with self.lock:
            if not self.path:
                for profile_id, hand_no, payload in rows:
                    self.memory[profile_id][hand_no] = payload
                return
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with closing(sqlite3.connect(self.path, timeout=10)) as db:
                db.execute(
                    'CREATE TABLE IF NOT EXISTS player_hands ('
                    'profile_id TEXT NOT NULL, hand_no INTEGER NOT NULL, '
                    'pot INTEGER NOT NULL, net INTEGER NOT NULL, payload TEXT NOT NULL, '
                    'PRIMARY KEY(profile_id, hand_no))'
                )
                db.execute('CREATE INDEX IF NOT EXISTS player_hands_pot ON player_hands(profile_id,pot DESC,hand_no DESC)')
                db.executemany(
                    'INSERT OR REPLACE INTO player_hands VALUES (?,?,?,?,?)',
                    [(profile_id,hand_no,int(payload['pot']),int(payload['net']),json.dumps(payload))
                     for profile_id,hand_no,payload in rows],
                )
                db.commit()

    def read(self, profile_id, offset=0, limit=30):
        if offset < 0 or offset > 10000000:
            raise ValueError('Invalid hand history page.')
        with self.lock:
            if not self.path:
                rows = list(self.memory[profile_id].values())
                rows.sort(key=lambda row: row['hand_no'])
                nets = [(row['hand_no'],row['net']) for row in rows]
                recent = list(reversed(rows))[offset:offset + limit]
                top_pots = sorted(rows, key=lambda row: (row['pot'], row['hand_no']), reverse=True)[:10]
            else:
                if not self.path.exists():
                    nets,recent,top_pots = [],[],[]
                else:
                    with closing(sqlite3.connect(self.path, timeout=10)) as db:
                        exists = db.execute(
                            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='player_hands'"
                        ).fetchone()
                        if exists:
                            nets=db.execute('SELECT hand_no,net FROM player_hands WHERE profile_id=? ORDER BY hand_no',(profile_id,)).fetchall()
                            recent=[json.loads(row[0]) for row in db.execute(
                                'SELECT payload FROM player_hands WHERE profile_id=? ORDER BY hand_no DESC LIMIT ? OFFSET ?',
                                (profile_id,limit,offset),
                            )]
                            top_pots=[json.loads(row[0]) for row in db.execute(
                                'SELECT payload FROM player_hands WHERE profile_id=? ORDER BY pot DESC,hand_no DESC LIMIT 10',
                                (profile_id,),
                            )]
                        else:nets,recent,top_pots = [],[],[]
        cumulative = 0
        performance = []
        for hand_no,net in nets:
            cumulative += net
            performance.append({'hand': hand_no, 'profit': cumulative})
        if len(performance) > 200:
            step = (len(performance) - 1) / 199
            performance = [performance[round(i * step)] for i in range(200)]
        return {
            'performance': performance,
            'hands': recent,
            'top_pots': top_pots,
            'recorded_hands': len(nets),
            'next_offset': offset + limit if offset + limit < len(nets) else None,
        }
