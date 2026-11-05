"""Binary voice intake exercises actual HTTP authentication and durable storage."""
import os
from pathlib import Path
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import json
import test_demo_auth as auth_fixture


class VoiceUploadTest(auth_fixture.DemoAuthTest):
    # Reuse the fixture, without rerunning its unrelated inherited tests.
    def setUp(self):
        super().setUp()
        self.voice_dir = Path(self.directory.name) / 'voice'
        self.voice_env = patch.dict(os.environ, {
            'NORTHSTAR_VOICE_STORE': str(self.voice_dir),
            'NORTHSTAR_VOICE_ENGINE': 'none',
        })
        self.voice_env.start()

    def tearDown(self):
        self.voice_env.stop()
        super().tearDown()

    def upload(self, cookie='', host=auth_fixture.OPS_HOST, name='test.webm', content=b'test-audio', source='pc-microphone', origin=''):
        from urllib.parse import urlencode
        request = Request(self.base + '/api/voice/upload?' + urlencode({'name': name, 'source': source}),
                          data=content, method='POST', headers={
                              'Host': host, 'Cookie': cookie, 'Content-Type': 'application/octet-stream',
                              **({'Origin': origin} if origin else {}),
                          })
        try:
            response = urlopen(request, timeout=5)
        except HTTPError as error:
            response = error
        return response.status, json.loads(response.read())

    def test_upload_requires_operator_and_refuses_public_host_and_cross_origin(self):
        self.assertIn(self.upload()[0], (401, 403))
        cookie = self.session_cookie()
        self.assertEqual(self.upload(cookie, host=auth_fixture.PUBLIC_HOST)[0], 403)
        self.assertEqual(self.upload(cookie, origin='https://untrusted.example')[0], 403)
        self.assertEqual(self.backend.voice.list_recordings(), [])

    def test_upload_persists_bytes_and_actor_deduplicates_and_keeps_transcript_empty(self):
        cookie = self.session_cookie()
        status, row = self.upload(cookie)
        self.assertEqual(status, 201)
        self.assertEqual((self.voice_dir / row['storedName']).read_bytes(), b'test-audio')
        self.assertEqual(row['source'], 'pc-microphone')
        detail = self.backend.voice.get_recording(row['recordingId'])
        self.assertEqual(detail['segments'], [])
        self.assertTrue(any(e['event'] == 'uploaded' and e['actor'] == 'ron' for e in detail['events']))
        status, duplicate = self.upload(cookie)
        self.assertEqual(status, 200)
        self.assertTrue(duplicate['duplicate'])
        self.assertEqual(len(list(self.voice_dir.iterdir())), 1)

    def test_upload_rejects_bad_names_sources_empty_and_oversized_audio(self):
        cookie = self.session_cookie()
        for name in ('../test.wav', 'x\\test.wav', 'test.html', 'x' * 181 + '.wav'):
            self.assertEqual(self.upload(cookie, name=name)[0], 400)
        self.assertEqual(self.upload(cookie, source='pbx')[0], 400)
        self.assertEqual(self.upload(cookie, content=b'')[0], 400)
        with patch.object(self.backend.voice, 'MAX_UPLOAD_BYTES', 3):
            self.assertEqual(self.upload(cookie, content=b'1234')[0], 413)
        self.assertEqual(self.backend.voice.list_recordings(), [])


for _name in dir(auth_fixture.DemoAuthTest):
    if _name.startswith('test_') and _name not in VoiceUploadTest.__dict__:
        setattr(VoiceUploadTest, _name, None)
