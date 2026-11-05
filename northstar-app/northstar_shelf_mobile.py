"""Shelf-only PIN sessions. Old R/S device registrations grant no access."""
from contextlib import contextmanager
import hashlib
import hmac
from http.cookies import SimpleCookie, CookieError
import json
import importlib
import os
from pathlib import Path
import re
import sqlite3
import time
from urllib.parse import urlsplit

DATA=Path(os.environ.get('NORTHSTAR_SHELF_MOBILE_DATA',str(Path(__file__).resolve().parent/'data/shelf-mobile')))
COOKIE='__Secure-shelf-device'
SESSION_SECONDS=12*3600

@contextmanager
def database():
    DATA.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(DATA/'pin-sessions.sqlite',timeout=10)
    db.row_factory=sqlite3.Row
    try:
        db.execute('CREATE TABLE IF NOT EXISTS sessions (digest TEXT PRIMARY KEY, expires REAL NOT NULL)')
        db.execute('CREATE TABLE IF NOT EXISTS attempts (id INTEGER PRIMARY KEY, failures INTEGER, until REAL)')
        with db: yield db
    finally: db.close()

def cookie_value(headers,name):
    try:
        jar=SimpleCookie(); jar.load(headers.get('Cookie',''))
        token=jar[name].value
        return token if re.fullmatch('[a-f0-9]{64}',token) else None
    except (KeyError,ValueError,CookieError): return None

def fingerprint(headers):
    token=cookie_value(headers,'__Secure-shelf-web-device') or cookie_value(headers,COOKIE)
    return hashlib.sha256(token.encode()).hexdigest() if token else None

def approved(digest):
    if not digest or not (DATA/'pin-sessions.sqlite').exists(): return False
    with database() as db:
        return db.execute('SELECT 1 FROM sessions WHERE digest=? AND expires>?',(digest,time.time())).fetchone() is not None

def invited(headers):
    web_token=cookie_value(headers,'__Secure-shelf-web-invite')
    if web_token:
        try:
            if hmac.compare_digest(hashlib.sha256(web_token.encode()).hexdigest(),(DATA/'web-invitation.sha256').read_text().strip()):return True
        except OSError:pass
    token=cookie_value(headers,'__Secure-shelf-enroll')
    try:
        expected=(DATA/'enrollment.sha256').read_text().strip()
        return bool(token) and hmac.compare_digest(hashlib.sha256(token.encode()).hexdigest(),expected)
    except OSError: return False

def verify_pin(pin):
    config=json.loads((DATA/'pin-auth.json').read_text())
    derived=hashlib.scrypt(pin.encode(),salt=bytes.fromhex(config['salt']),n=16384,r=8,p=1).hex()
    return hmac.compare_digest(derived,config['verifier'])


def extension(h, shelf, name):
    """Optional workstation integrations are not implied by a source checkout."""
    try:
        return importlib.import_module(name)
    except ModuleNotFoundError as exc:
        if exc.name != name:
            raise
        h.close_connection=True
        shelf.send_json(h,{'error':'This Shelf component is not installed.','status':'unavailable'},503)
        return None

def handle(h,shelf,gate):
    path=h.path.split('?',1)[0]
    if gate!='demo' or not h._is_operator_host(): return False
    if path.startswith('/shelf-web/'):
        web=extension(h,shelf,'northstar_shelf_web')
        return web.handle(h,shelf,__import__(__name__)) if web else True
    if not path.startswith('/api/shelf/'): return False
    digest=fingerprint(h.headers)
    login=path=='/api/shelf/mobile/unlock' and h.command=='POST'
    logout=path=='/api/shelf/mobile/lock' and h.command=='POST'
    device_action=path in {'/api/shelf/push/action','/api/shelf/push/token'} and h.command=='POST'
    web_enroll=path=='/api/shelf/web/enroll' and h.command=='POST'
    if not login and not device_action and not web_enroll and not approved(digest): return False
    try:
        if h.command not in {'GET','HEAD'}:
            origin=urlsplit(h.headers.get('Origin',''))
            if origin.scheme!='https' or origin.netloc.lower()!=h.headers.get('Host','').lower() or h.headers.get('X-Shelf-Request')!='1':
                shelf.send_json(h,{'error':'Request refused'},403); return True
        if web_enroll:
            web=extension(h,shelf,'northstar_shelf_web')
            if web:web.enroll(h,shelf,__import__(__name__))
            return True
        if device_action:
            reminders=extension(h,shelf,'northstar_shelf_reminders')
            if reminders:reminders.device_action(h,shelf)
            return True
        if login:
            if not digest:
                shelf.send_json(h,{'error':'Please reopen the Shelf app.'},400); return True
            if not invited(h.headers):
                shelf.send_json(h,{'error':'Use the private Shelf app.'},403); return True
            try:
                length=int(h.headers.get('Content-Length','0'))
                if not 1<=length<=256: raise ValueError()
                pin=json.loads(h.rfile.read(length)).get('pin')
                if not isinstance(pin,str) or not re.fullmatch('[0-9]{4}',pin): raise ValueError()
            except (ValueError,AttributeError):
                h.close_connection=True
                shelf.send_json(h,{'error':'Enter a four-digit PIN.'},400); return True
            if not (DATA/'pin-auth.json').exists():
                shelf.send_json(h,{'error':'Shelf PIN setup is not active yet.'},503); return True
            with database() as db:
                db.execute('BEGIN IMMEDIATE')
                now=time.time()
                row=db.execute('SELECT * FROM attempts WHERE id=1').fetchone()
                if row and row['until']>now and row['failures']>=5:
                    shelf.send_json(h,{'error':'Too many incorrect attempts. Try again in 15 minutes.'},429); return True
                if not verify_pin(pin):
                    failures=row['failures']+1 if row and row['until']>now else 1
                    until=row['until'] if row and row['until']>now else now+900
                    db.execute('INSERT OR REPLACE INTO attempts VALUES (1,?,?)',(failures,until))
                    db.execute('DELETE FROM sessions WHERE digest=?',(digest,))
                    shelf.send_json(h,{'error':'Incorrect PIN.' if failures<5 else 'Too many incorrect attempts. Try again in 15 minutes.'},401 if failures<5 else 429)
                    return True
                db.execute('DELETE FROM attempts')
                db.execute('DELETE FROM sessions WHERE expires<=?',(now,))
                db.execute('INSERT OR REPLACE INTO sessions VALUES (?,?)',(digest,now+SESSION_SECONDS))
            shelf.send_json(h,{'unlocked':True}); return True
        if logout:
            with database() as db: db.execute('DELETE FROM sessions WHERE digest=?',(digest,))
            shelf.send_json(h,{'locked':True}); return True
        if path=='/api/shelf/session' and h.command in {'GET','HEAD'}:
            shelf.send_json(h,{'authenticated':True,'username':'Shelf','maxUploadMB':shelf.MAX_BYTES//1048576})
        elif path.startswith('/api/shelf/printer'):
            printer=extension(h,shelf,'northstar_shelf_printer')
            if printer:printer.handle(h,shelf)
        else: shelf.dispatch(h)
    except shelf.ShelfError as exc:
        h.close_connection=True
        shelf.send_json(h,{'error':str(exc)},exc.status)
    except Exception:
        h.close_connection=True
        shelf.send_json(h,{'error':'Shelf is temporarily unavailable.'},500)
    return True
