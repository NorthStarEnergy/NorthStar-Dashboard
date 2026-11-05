"""Shared classic identity: persistence, attribution and gate regressions."""
import unittest
import importlib
import json
import struct
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

import test_chat_workflows as workflows


class AvatarProfilesTest(unittest.TestCase):
    setUp = workflows.ChatWorkflowTest.setUp
    tearDown = workflows.ChatWorkflowTest.tearDown
    def test_catalog_and_persistence(self):
        import northstar_avatars as avatars
        self.assertEqual(len(avatars.CATALOG), 45)
        for item in avatars.CATALOG:
            blob = (Path(avatars.__file__).parent / item['url'].lstrip('/')).read_bytes()
            self.assertEqual(struct.unpack('>II', blob[16:24]), (34, 23))
        self.assertEqual(avatars.get_profile('alice')['avatarId'], 'classic-00')
        avatars.save_profile('alice', 'classic-44')
        importlib.reload(avatars)
        self.assertEqual(avatars.get_profile('alice')['avatarId'], 'classic-44')
        self.assertEqual(avatars.get_profile('bob')['avatarId'], 'classic-00')
        for invalid in ('classic-45', '../evil', None, [], 'https://evil.test/x.png'):
            with self.assertRaises(ValueError):
                avatars.save_profile('alice', invalid)
        self.assertEqual(avatars.get_profile('alice')['avatarId'], 'classic-44')

    def test_existing_messages_follow_author_profile(self):
        import northstar_avatars as avatars
        self.chat.post_message('general', 'Earlier message', author='alice')
        self.chat.post_message('general', 'Other user', author='bob')
        avatars.save_profile('alice', 'classic-12')
        messages = self.chat.list_messages('general')
        self.assertEqual([m['avatarId'] for m in messages], ['classic-12', 'classic-00'])
        self.assertEqual(self.chat.post_message('general', 'New', author='alice')['avatarId'], 'classic-12')


class AvatarHTTPTest(unittest.TestCase):
    setUp = workflows.ChatHTTPTest.setUp
    tearDown = workflows.ChatHTTPTest.tearDown
    def call(self, method, path, payload=None, **headers):
        req = Request(self.base + path, method=method,
                      data=json.dumps(payload).encode() if payload is not None else None,
                      headers={'Content-Type': 'application/json', **headers})
        try:
            response = urlopen(req, timeout=20)
        except HTTPError as error:
            response = error
        return response.status, json.loads(response.read())

    def test_profiles_and_messages_use_server_identity(self):
        status, saved = self.call('POST', '/api/profile/avatar', {'avatarId':'classic-08','actor':'victim'}, **{'X-Northstar-Operator':'alice'})
        self.assertEqual(status, 200)
        self.assertEqual(saved['actor'], 'alice')
        self.assertEqual(self.call('GET','/api/profile/avatar', **{'X-Northstar-Operator':'victim'})[1]['avatarId'], 'classic-00')
        status, message = self.call('POST','/api/chat/messages', {'body':'Hello','room':'general','actor':'victim'}, **{'X-Northstar-Operator':'alice'})
        self.assertEqual(status, 201)
        self.assertEqual((message['author'],message['avatarId']), ('alice','classic-08'))
        self.assertEqual(self.call('POST','/api/profile/avatar', {'avatarId':'classic-99'})[0], 400)

    def test_avatar_routes_remain_operator_only(self):
        self.backend.OPERATOR_GATE = 'access'
        self.backend.CHECKIN_ORIGIN = 'https://checkin.northstarenergy.ca'
        for method, path, payload in [('GET','/api/avatars',None),('GET','/api/profile/avatar',None),('POST','/api/profile/avatar',{'avatarId':'classic-02'})]:
            self.assertEqual(self.call(method,path,payload)[0], 403)
            self.assertEqual(self.call(method,path,payload, **{'Host':'checkin.northstarenergy.ca','Cf-Access-Jwt-Assertion':'forged'})[0], 403)

    def test_cross_origin_profile_write_rejected(self):
        self.backend.OPERATOR_GATE = 'access'
        status, _ = self.call('POST','/api/profile/avatar', {'avatarId':'classic-02'}, **{'Origin':'https://evil.example','Cf-Access-Jwt-Assertion':'test-local'})
        self.assertEqual(status, 403)
