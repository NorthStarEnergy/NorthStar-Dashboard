import io
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import uuid
from contextlib import closing
from unittest.mock import patch

sys.path.insert(0, os.environ.get('NORTHSTAR_TEST_SOURCE', str(Path(__file__).resolve().parents[1])))
import ieso_backend as backend
import northstar_store as store
import northstar_outage_manager as manager
sys.path.insert(0, str(Path(__file__).parent))
import northstar_tool_access as access


class Handler:
    _uwpc_request_route = backend.Handler._uwpc_request_route
    _json_body = backend.Handler._json_body
    _binary_body = backend.Handler._binary_body
    def __init__(self, tool='outages', route='identity', token='', method='GET', body=None, host=True):
        self.path = access.PREFIX + tool + '/' + route
        self.command = method
        data = json.dumps(body).encode() if body is not None else b''
        self.headers = {'Content-Length': str(len(data)), 'Authorization': 'Bearer ' + token}
        self.rfile = io.BytesIO(data)
        self.wfile = io.BytesIO()
        self.client_address = ('fixture', 1)
        self.host = host
        self.status = None
    def _is_operator_host(self): return self.host
    def _is_public_checkin_host(self): return not self.host
    def _cross_origin_write(self): return False
    def _send_json(self, payload, status=200): self.payload, self.status = payload, status
    def send_response(self, status): self.status = status
    def send_header(self, *args): pass
    def end_headers(self): pass


class AccessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = patch.object(store, 'DB_PATH', Path(self.temp.name)/'existing.sqlite')
        self.db.start()
        self.password = patch.dict(os.environ, {'NORTHSTAR_TOOL_PASSWORD_SHA256':hashlib.sha256(b'demo').hexdigest()})
        self.password.start()
        store.init_db()
        access.throttle = access.auth.LoginThrottle(max_failures=3, window_seconds=60)
    def tearDown(self): self.password.stop(); self.db.stop(); self.temp.cleanup()
    def call(self, **kwargs):
        h = Handler(**kwargs)
        self.assertTrue(access.handle(h))
        return h
    def login(self, tool='outages'):
        result = self.call(tool=tool, route='entry', method='POST', body={'passcode':'demo'})
        self.assertEqual(result.status, 201)
        return result.payload['token']
    def test_password_and_rate_limit(self):
        for _ in range(3):
            self.assertEqual(self.call(route='entry', method='POST', body={'passcode':'bad'}).status, 401)
        self.assertEqual(self.call(route='entry', method='POST', body={'passcode':'demo'}).status, 429)
    def test_sessions_are_scoped_expire_and_revoke(self):
        token = self.login()
        self.assertEqual(self.call(token=token).status, 200)
        self.assertEqual(self.call(tool='scada', token=token).status, 401)
        self.assertEqual(self.call(token=token, route='logout', method='POST', body={}).status, 200)
        self.assertEqual(self.call(token=token).status, 401)
        token = self.login()
        with closing(access.database()) as c, c: c.execute('UPDATE sessions SET expires=0')
        self.assertEqual(self.call(token=token).status, 401)
    def test_existing_records_and_audit_identity(self):
        row = store.create_outage({'title':'Existing fixture outage','site':'North','type':'Planned'},'existing-operator')
        token = self.login()
        result = self.call(token=token, route='api/uwpc/requests/manager/register')
        self.assertEqual(result.status, 200)
        self.assertIn(row['id'], [r['id'] for r in result.payload['rows']])
        result = self.call(token=token, route='api/uwpc/requests/manager/session')
        self.assertRegex(result.payload['actor'], r'^ToolGuest\d+$')
        self.assertFalse((Path(self.temp.name)/'outage-visitors').exists())
        created = self.call(token=token, route='api/uwpc/requests/manager/create', method='POST', body={
            'requestKey':str(uuid.uuid4()),'title':'Guest fixture outage','site':'North',
            'asset':'Unit A','scope':'Fixture inspection','severity':'Monitor','reviewTrigger':'routine',
            'start':'2030-09-08T12:00:00Z','end':'2030-09-08T15:00:00Z'})
        self.assertEqual(created.status, 201, created.payload)
        self.assertIn(created.payload['id'], [r['id'] for r in manager.query_register({})['rows']])
        with closing(access.database()) as c:
            self.assertRegex(c.execute('SELECT actor FROM requests').fetchone()[0], r'^ToolGuest\d+$')
    def test_northstar_and_worker_routes_are_not_exposed(self):
        token = self.login('scada')
        for route in ['api/worker','api/result','api/manager','api/auth/session','api/checkins','api/../state']:
            with patch.object(access, 'urlopen') as upstream:
                self.assertEqual(self.call(tool='scada', token=token, route=route).status, 404)
                upstream.assert_not_called()
        self.assertEqual(self.call(token=token, route='api/checkins').status, 401)
        self.assertEqual(self.call(token=self.login(), route='api/checkins').status, 404)
    def test_host_origin_and_no_operator_cookie_authorization(self):
        self.assertEqual(self.call(host=False).status, 404)
        self.assertEqual(self.call().status, 401)
        h = Handler(route='entry',method='POST',body={'passcode':'demo'})
        h.headers['Origin'] = 'https://evil.invalid'
        access.handle(h)
        self.assertEqual(h.status, 403)
        h = Handler(route='entry',method='POST',body={'passcode':'demo'})
        h.headers['Content-Length'] = '9999'
        access.handle(h)
        self.assertEqual(h.status, 413)

if __name__ == '__main__': unittest.main()
