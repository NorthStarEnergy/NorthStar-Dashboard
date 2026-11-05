"""Shared layout ownership and complete checkpoint persistence, using a temporary server/store."""
import json
import unittest
from pathlib import Path
import test_demo_auth as auth_tests

class LayoutOwnershipTest(unittest.TestCase):
    setUp = auth_tests.DemoAuthTest.setUp
    tearDown = auth_tests.DemoAuthTest.tearDown
    call = auth_tests.DemoAuthTest.call
    sign_in = auth_tests.DemoAuthTest.sign_in
    session_cookie = auth_tests.DemoAuthTest.session_cookie

    def test_other_operator_cannot_publish_any_layout_field(self):
        cookie = self.session_cookie()
        for payload in ({'layout': {}}, {'statusLayout': {'profiles': {}}}, {'preferences': {}},
                        {'layoutStorage': {}}, {'moduleWorkspaceOwner': 'ron', 'moduleWorkspace': {}}):
            status, body, _ = self.call('POST', '/api/dashboard-layout-default', payload, cookie=cookie)
            self.assertEqual(status, 403, body)

    def test_ryan_checkpoint_roundtrip_and_validation(self):
        self.backend.DEMO_AUTH = self.auth.build_config('Ryan', auth_tests.TEST_PASSWORD)
        status, _, headers = self.sign_in('Ryan')
        self.assertEqual(status, 200)
        cookie = headers['Set-Cookie'].split(';', 1)[0]
        original_path, original_script = self.backend.DASHBOARD_LAYOUT_PATH, self.backend.DASHBOARD_LAYOUT_SCRIPT
        try:
            self.backend.DASHBOARD_LAYOUT_PATH = Path(self.directory.name) / 'layout.json'
            self.backend.DASHBOARD_LAYOUT_SCRIPT = Path(self.directory.name) / 'layout.js'
            snapshot = {'northstarStatusLayoutV1': json.dumps({'profiles': {}}),
                        'northstarAssetEditorV1': json.dumps({'version': 1, 'roots': {'test': {'x': 42}}}),
                        'northstarCanvasLayoutV1': None}
            payload = {'layout': {}, 'layoutStorage': snapshot, 'moduleWorkspace': {'sections': {}, 'modules': {}}}
            status, body, _ = self.call('POST', '/api/dashboard-layout-default', payload, cookie=cookie)
            self.assertEqual(status, 200, body)
            saved = json.loads(self.backend.DASHBOARD_LAYOUT_PATH.read_text())
            self.assertEqual(saved['layoutStorage'], snapshot)
            self.assertEqual(saved['moduleWorkspaceOwner'], 'Ryan')
            self.assertIn('NorthstarLayoutPersistence.bootstrap', self.backend.DASHBOARD_LAYOUT_SCRIPT.read_text())
            payload['layoutStorage'] = {'unexpectedSecretKey': 'no'}
            status, _, _ = self.call('POST', '/api/dashboard-layout-default', payload, cookie=cookie)
            self.assertEqual(status, 400)
            self.assertEqual(json.loads(self.backend.DASHBOARD_LAYOUT_PATH.read_text()), saved)
        finally:
            self.backend.DASHBOARD_LAYOUT_PATH, self.backend.DASHBOARD_LAYOUT_SCRIPT = original_path, original_script
