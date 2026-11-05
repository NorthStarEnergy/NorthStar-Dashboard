"""Games invitations and sponsorship, independent of dashboard authorization."""
import base64
import hashlib
import re
import secrets
import sqlite3
import time
from contextlib import closing


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


class Invitations:
    def __init__(self, path):
        self.path = path
        if path:
            path.parent.mkdir(parents=True, exist_ok=True)
            with closing(sqlite3.connect(path, timeout=10)) as db:
                db.executescript('''
                    CREATE TABLE IF NOT EXISTS game_invites (
                        id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL UNIQUE,
                        sponsor TEXT NOT NULL COLLATE NOCASE,
                        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
                        revoked INTEGER NOT NULL DEFAULT 0);
                    CREATE INDEX IF NOT EXISTS game_invites_sponsor ON game_invites(sponsor);
                    CREATE TABLE IF NOT EXISTS game_invite_members (
                        guest_hash TEXT PRIMARY KEY, sponsor TEXT NOT NULL COLLATE NOCASE,
                        account_id TEXT UNIQUE COLLATE NOCASE,
                        joined_at INTEGER NOT NULL, invite_id TEXT NOT NULL);
                    CREATE INDEX IF NOT EXISTS game_members_sponsor ON game_invite_members(sponsor);
                ''')

    def connect(self):
        if not self.path:
            raise ValueError('Invitations are unavailable on this server.')
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    @staticmethod
    def account(db, session_token):
        if not db.execute("SELECT 1 FROM sqlite_master WHERE name='accounts'").fetchone():
            return None
        row = db.execute('SELECT username FROM accounts WHERE career_token=?', (session_token,)).fetchone()
        return row['username'] if row else None

    @staticmethod
    def valid_invite(db, secret):
        if not isinstance(secret, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', secret):
            raise ValueError('This invitation is invalid, expired or revoked.')
        row = db.execute('SELECT * FROM game_invites WHERE secret_hash=? AND revoked=0 AND expires_at>?',
                         (token_hash(secret), int(time.time()))).fetchone()
        if not row:
            raise ValueError('This invitation is invalid, expired or revoked.')
        return row

    def overview(self, session_token):
        with closing(self.connect()) as db:
            account = self.account(db, session_token)
            member = db.execute('SELECT sponsor FROM game_invite_members WHERE guest_hash=?',
                                (token_hash(session_token),)).fetchone()
            result = {'account': account, 'sponsor': member['sponsor'] if member else None,
                      'invites': [], 'people': [], 'people_count': 0}
            if account:
                now = int(time.time())
                result['invites'] = [dict(r) for r in db.execute(
                    'SELECT id,created_at,expires_at FROM game_invites WHERE sponsor=? AND revoked=0 AND expires_at>? ORDER BY created_at DESC',
                    (account, now))]
                result['people_count'] = db.execute('SELECT COUNT(*) FROM game_invite_members WHERE sponsor=?', (account,)).fetchone()[0]
                result['people'] = [{'name': r['account_id'] or 'Guest ' + r['guest_hash'][:6],
                                     'kind': 'account' if r['account_id'] else 'guest', 'joined_at': r['joined_at']}
                                    for r in db.execute('SELECT guest_hash,account_id,joined_at FROM game_invite_members WHERE sponsor=? ORDER BY joined_at DESC LIMIT 100', (account,))]
            return result

    def create(self, session_token, origin):
        # Construct the QR before writing, so a missing dependency cannot create a hidden invite.
        import qrcode
        from qrcode.image.svg import SvgPathFillImage
        secret = secrets.token_urlsafe(32)
        url = origin + '/#invite=' + secret
        with closing(self.connect()) as db:
            db.execute('BEGIN IMMEDIATE')
            account = self.account(db, session_token)
            if not account:
                raise ValueError('Sign in or create a Games account to invite people.')
            now = int(time.time())
            active = db.execute('SELECT COUNT(*) FROM game_invites WHERE sponsor=? AND revoked=0 AND expires_at>?', (account, now)).fetchone()[0]
            recent = db.execute('SELECT COUNT(*) FROM game_invites WHERE sponsor=? AND created_at>?', (account, now-86400)).fetchone()[0]
            if active >= 10 or recent >= 50:
                raise ValueError('Invite limit reached. Revoke an unused link or try again tomorrow.')
            qr = qrcode.make(url, image_factory=SvgPathFillImage, border=4).to_string()
            invite_id, expires = secrets.token_urlsafe(12), now + 30*86400
            db.execute('INSERT INTO game_invites(id,secret_hash,sponsor,created_at,expires_at) VALUES (?,?,?,?,?)',
                       (invite_id, token_hash(secret), account, now, expires))
            db.commit()
        return {'id': invite_id, 'url': url, 'sponsor': account, 'expires_at': expires,
                'qr': 'data:image/svg+xml;base64,' + base64.b64encode(qr).decode()}

    def preview(self, secret):
        with closing(self.connect()) as db:
            row = self.valid_invite(db, secret)
            return {'sponsor': row['sponsor'], 'expires_at': row['expires_at']}

    def accept(self, session_token, secret):
        with closing(self.connect()) as db:
            db.execute('BEGIN IMMEDIATE')
            invite = self.valid_invite(db, secret)
            member = db.execute('SELECT sponsor FROM game_invite_members WHERE guest_hash=?', (token_hash(session_token),)).fetchone()
            if member:
                if member['sponsor'].casefold() != invite['sponsor'].casefold():
                    raise ValueError('You already joined under another sponsor. Your sponsor has been kept.')
            elif self.account(db, session_token):
                raise ValueError('You are already signed in. Existing accounts keep their sponsor. You can browse all games now.')
            else:
                db.execute('INSERT INTO game_invite_members VALUES (?,?,NULL,?,?)',
                           (token_hash(session_token), invite['sponsor'], int(time.time()), invite['id']))
            db.commit()
        return self.overview(session_token)

    def revoke(self, session_token, invite_id):
        if not isinstance(invite_id, str) or len(invite_id) > 64:
            raise ValueError('Invitation not found.')
        with closing(self.connect()) as db:
            account = self.account(db, session_token)
            if not account:
                raise ValueError('Sign in to manage invitations.')
            changed = db.execute('UPDATE game_invites SET revoked=1 WHERE id=? AND sponsor=? AND revoked=0', (invite_id, account)).rowcount
            if not changed:
                raise ValueError('Invitation not found.')
            db.commit()
        return self.overview(session_token)


def promote_guest(db, old_token, new_token, username):
    """Called inside account creation's transaction; no client-supplied sponsor."""
    if db.execute("SELECT 1 FROM sqlite_master WHERE name='game_invite_members'").fetchone():
        db.execute('UPDATE game_invite_members SET guest_hash=?,account_id=? WHERE guest_hash=? AND account_id IS NULL',
                   (token_hash(new_token), username, token_hash(old_token or '')))
