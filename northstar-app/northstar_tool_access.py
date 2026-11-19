"""Password sessions scoped to the two explicitly shared existing workspaces."""
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import closing
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

import northstar_auth as auth
import northstar_store as store
import northstar_scada_workbench as scada

PREFIX = '/public-outage-api/tools/'
TTL = 12 * 60 * 60
TOOLS = {'outages', 'scada'}
throttle = auth.LoginThrottle(max_failures=8, window_seconds=300)
SCADA_RESOURCES = {'state', 'screens', 'trainer-clones', 'workspace', 'ai',
                   'concepts', 'symbols', 'library', 'projects'}


def database():
    path = store.DB_PATH.parent / 'tool-access' / 'sessions.sqlite3'
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10)
    connection.execute('CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, tool TEXT NOT NULL, digest TEXT UNIQUE NOT NULL, expires INTEGER NOT NULL)')
    connection.execute('CREATE TABLE IF NOT EXISTS requests (id INTEGER PRIMARY KEY, actor TEXT NOT NULL, tool TEXT NOT NULL, route TEXT NOT NULL, requested_at INTEGER NOT NULL)')
    connection.commit()
    return connection


def issue(tool):
    token = secrets.token_hex(32)
    with closing(database()) as c, c:
        c.execute('DELETE FROM sessions WHERE expires <= ?', (time.time(),))
        number = c.execute('INSERT INTO sessions(tool,digest,expires) VALUES(?,?,?)',
                           (tool, hashlib.sha256(token.encode()).hexdigest(), time.time() + TTL)).lastrowid
    return {'token': token, 'actor': f'ToolGuest{number:06d}', 'maxAge': TTL, 'workspace': 'existing'}


def identify(tool, token):
    if not re.fullmatch('[a-f0-9]{64}', token):
        return None
    with closing(database()) as c:
        row = c.execute('SELECT id FROM sessions WHERE tool=? AND digest=? AND expires>?',
                        (tool, hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()
    return f'ToolGuest{row[0]:06d}' if row else None


def scada_request(h, route, actor):
    parts = route.split('/')
    if len(parts) < 2 or parts[0] != 'api' or parts[1] not in SCADA_RESOURCES:
        return h._send_json({'error': 'Tool route not found'}, 404)
    body = h._binary_body(32 * 1024 * 1024) if h.command == 'POST' else None
    # The privileged controller credential stays on the workstation.
    secret = json.loads(scada.ACCESS_FILE.read_text(encoding='utf-8-sig'))['dashboard']
    headers = {'Authorization': 'Bearer ' + secret, 'X-Scada-Actor': actor}
    if body is not None:
        headers['Content-Type'] = h.headers.get('Content-Type', 'application/json')
    query = urlsplit(h.path).query
    target = scada.BASE + '/' + route + (('?' + query) if query else '')
    try:
        response = urlopen(Request(target, data=body, headers=headers, method=h.command), timeout=60)
    except HTTPError as error:
        response = error
    with response:
        data = response.read()
        h.send_response(response.status)
        for key in ('Content-Type', 'Content-Disposition'):
            value = response.headers.get(key)
            if value and '\r' not in value and '\n' not in value:
                h.send_header(key, value)
        h.send_header('Cache-Control', 'private, no-store')
        h.send_header('X-Content-Type-Options', 'nosniff')
        h.send_header('Content-Length', str(len(data)))
        h.end_headers()
        h.wfile.write(data)


def handle(h):
    path = urlsplit(h.path).path
    if not path.startswith(PREFIX):
        return False
    if not h._is_operator_host() or h._is_public_checkin_host():
        h._send_json({'error': 'Not found'}, 404)
        return True
    tool, _, route = path[len(PREFIX):].partition('/')
    def fail(status, message):
        h._send_json({'error': message}, status)
    if tool not in TOOLS or not route or '%' in path or '..' in path or '\\' in path:
        fail(404, 'Not found')
        return True
    if h.command not in {'GET', 'POST'}:
        fail(405, 'Method unavailable')
        return True
    # Only the apex server proxy may forward writes; browser cookies never grant access.
    if h.headers.get('Origin') or h.headers.get('Transfer-Encoding'):
        fail(403, 'Use the tool entry page')
        return True
    try:
        if route == 'entry' and h.command == 'POST':
            ip = h.headers.get('CF-Connecting-IP') or h.client_address[0]
            if not throttle.check(ip)[0]:
                fail(429, 'Try again in a few minutes')
                return True
            payload = h._json_body(512)
            password = payload.get('passcode') if isinstance(payload, dict) else None
            expected = os.environ.get('NORTHSTAR_TOOL_PASSWORD_SHA256', '')
            if not expected:
                config = store.DB_PATH.parent / 'tool-access' / 'password.sha256'
                expected = config.read_text(encoding='ascii').strip() if config.is_file() else ''
            if not re.fullmatch('[a-f0-9]{64}', expected):
                fail(503, 'Tool password is not configured')
                return True
            if not isinstance(password, str) or not hmac.compare_digest(hashlib.sha256(password.encode()).hexdigest(), expected):
                throttle.record_failure(ip)
                fail(401, 'Incorrect password')
                return True
            throttle.reset(ip)
            h._send_json(issue(tool), 201)
            return True
        token = h.headers.get('Authorization', '').removeprefix('Bearer ')
        actor = identify(tool, token)
        if not actor:
            fail(401, 'Enter the tool password')
            return True
        if h.command == 'POST':
            with closing(database()) as c, c:
                c.execute('INSERT INTO requests(actor,tool,route,requested_at) VALUES(?,?,?,?)',
                          (actor, tool, route, time.time()))
        if route == 'identity' and h.command == 'GET':
            h._send_json({'actor': actor, 'workspace': 'existing', 'tool': tool})
        elif route == 'logout' and h.command == 'POST':
            with closing(database()) as c, c:
                c.execute('DELETE FROM sessions WHERE tool=? AND digest=?',
                          (tool, hashlib.sha256(token.encode()).hexdigest()))
            h._send_json({'signedOut': True})
        elif tool == 'scada':
            scada_request(h, route, actor)
        elif route == 'sites' and h.command == 'GET':
            import northstar_outage_manager as manager
            # Use the same existing-record site choices as the manager register.
            h._send_json({'options': [{'name': name} for name in manager.query_register({}).get('sites', [])]})
        elif route == 'api/uwpc/requests' or route.startswith('api/uwpc/requests/'):
            # No visitor DB context: the existing store and checkout/review rules apply.
            globals_ = h._uwpc_request_route.__func__.__globals__
            config = globals_.get('DEMO_AUTH') or {}
            accounts = config.get('accounts', [config])
            operators = sorted({actor} | {a['username'] for a in accounts
                               if a.get('username') and a.get('role', 'operator') == 'operator' and not a.get('disabled')})
            original = h.path
            h.path = '/' + route + (('?' + urlsplit(original).query) if urlsplit(original).query else '')
            try:
                h._uwpc_request_route('/' + route, visitor_identity=(actor, operators))
            finally:
                h.path = original
        else:
            fail(404, 'Tool route not found')
    except (ValueError, TypeError):
        fail(400, 'Invalid tool request')
    except (OSError, sqlite3.Error, URLError, KeyError):
        fail(503, 'Tool temporarily unavailable')
    except Exception as error:
        if 400 <= getattr(error, 'status', 0) <= 499:
            fail(error.status, 'Invalid tool request')
        else:
            raise
    return True
