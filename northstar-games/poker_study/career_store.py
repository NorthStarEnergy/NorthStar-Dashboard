"""Local anonymous play-money saves. Never exposed by the static file server."""
import json
import hashlib
import hmac
import secrets
import sqlite3
from contextlib import closing
from dataclasses import asdict
from pathlib import Path
from .engine import Game, Config

class CareerStore:
    def __init__(self, path):
        self.path=Path(path) if path else None
    def load(self, token):
        if not self.path or not self.path.exists() or not token:return None
        with closing(sqlite3.connect(self.path)) as db:
            if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='careers'").fetchone():return None
            row=db.execute('SELECT payload FROM careers WHERE token=?',(token,)).fetchone()
        return json.loads(row[0]) if row else None
    def save(self, token, session):
        if not self.path or not session.get('career'):return
        self.path.parent.mkdir(parents=True,exist_ok=True)
        game=session['game']
        data={k:session.get(k) for k in ('hero','number','mode','career','lineup','settled_number','notice','opponent_id','bet_limits')}
        data['game']={'config':asdict(game.config),'deck':game.initial_deck,'history':game.history} if game else None
        data['strategy_rows']=session['strategy'].rows
        with closing(sqlite3.connect(self.path)) as db:
            db.execute('CREATE TABLE IF NOT EXISTS careers (token TEXT PRIMARY KEY, payload TEXT NOT NULL)')
            db.execute('INSERT OR REPLACE INTO careers VALUES (?,?)',(token,json.dumps(data)))
            db.commit()

    def standings(self):
        if not self.path or not self.path.exists():return []
        with closing(sqlite3.connect(self.path,timeout=10)) as db:
            if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='careers'").fetchone():return []
            rows=db.execute('SELECT token,payload FROM careers').fetchall()
        players=[]
        for token,payload in rows:
            career=json.loads(payload).get('career')
            if career and career.get('hands',0)>0:
                players.append({'id':career.get('profile_id') or self.profile_id(token),
                                'name':career['name'],'kind':'Player','hands':career['hands'],
                                'wins':career['wins'],'profit':career['net'],
                                'rebuys':max(0,career.get('buyins',1)-1)})
        return players

    @staticmethod
    def profile_id(token):
        return 'player-' + hashlib.sha256(token.encode()).hexdigest()[:20]

    def public_profile(self, profile_id):
        if not self.path or not self.path.exists():return None
        with closing(sqlite3.connect(self.path,timeout=10)) as db:
            if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='careers'").fetchone():return None
            rows=db.execute('SELECT token,payload FROM careers').fetchall()
        for token,payload in rows:
            career=json.loads(payload).get('career')
            if career and (career.get('profile_id') or self.profile_id(token))==profile_id:
                return {'id':profile_id,'name':career['name'],'kind':'Player',
                        'hands':career.get('hands',0),'wins':career.get('wins',0),
                        'profit':career.get('net',0),'rebuys':max(0,career.get('buyins',1)-1)}
        return None

    @staticmethod
    def _password_hash(password, salt):
        return hashlib.scrypt(password.encode('utf-8'), salt=salt, n=2**14, r=8, p=1, dklen=32)

    @staticmethod
    def _career_payload(session):
        game=session['game']
        data={k:session.get(k) for k in ('hero','number','mode','career','lineup','settled_number','notice','opponent_id','bet_limits')}
        data['game']={'config':asdict(game.config),'deck':game.initial_deck,'history':game.history} if game else None
        data['strategy_rows']=session['strategy'].rows
        return json.dumps(data)

    def create_account(self, username, password, new_token, old_token, session):
        if not self.path: raise ValueError('Accounts are unavailable on this server.')
        self.path.parent.mkdir(parents=True,exist_ok=True)
        salt=secrets.token_bytes(16); password_hash=self._password_hash(password,salt)
        payload=self._career_payload(session)
        try:
            with closing(sqlite3.connect(self.path,timeout=10)) as db:
                db.execute('CREATE TABLE IF NOT EXISTS accounts (username TEXT PRIMARY KEY COLLATE NOCASE, salt TEXT NOT NULL, password_hash TEXT NOT NULL, career_token TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)')
                db.execute('CREATE TABLE IF NOT EXISTS careers (token TEXT PRIMARY KEY, payload TEXT NOT NULL)')
                db.execute('BEGIN IMMEDIATE')
                db.execute('INSERT INTO accounts(username,salt,password_hash,career_token) VALUES (?,?,?,?)',(username,salt.hex(),password_hash.hex(),new_token))
                db.execute('INSERT OR REPLACE INTO careers VALUES (?,?)',(new_token,payload))
                from .invitations import promote_guest
                promote_guest(db, old_token, new_token, username)
                if old_token and old_token!=new_token:db.execute('DELETE FROM careers WHERE token=?',(old_token,))
                db.commit()
        except sqlite3.IntegrityError as error:
            raise ValueError('That ID is unavailable. Choose another.') from error
        return username

    def authenticate(self, username, password):
        if not self.path: raise ValueError('ID or password is incorrect.')
        with closing(sqlite3.connect(self.path,timeout=10)) as db:
            exists=db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounts'").fetchone()
            row=db.execute('SELECT username,salt,password_hash,career_token FROM accounts WHERE username=?',(username,)).fetchone() if exists else None
        salt=bytes.fromhex(row[1]) if row else bytes.fromhex('00112233445566778899aabbccddeeff')
        expected=bytes.fromhex(row[2]) if row else b'\x00'*32
        actual=self._password_hash(password,salt)
        if not hmac.compare_digest(actual,expected) or not row: return None
        return row[0],row[3]

    def account_for_token(self, token):
        if not self.path or not token:return None
        with closing(sqlite3.connect(self.path,timeout=10)) as db:
            exists=db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounts'").fetchone()
            row=db.execute('SELECT username FROM accounts WHERE career_token=?',(token,)).fetchone() if exists else None
        return row[0] if row else None

def restore(data):
    saved=data.pop('game')
    if saved:
        game=Game(Config(**saved['config']),saved['deck'])
        for event in saved['history']:game.act(event['action'],event.get('amount'))
        data['game']=game
    else:data['game']=None
    return data
