"""All authenticated roles can read exact research snapshots, without other access."""
import base64
import hashlib
import http.client
import json
import unittest
from unittest.mock import patch
import test_demo_auth as auth_tests


class ResearchAccessTest(unittest.TestCase):
    setUp = auth_tests.DemoAuthTest.setUp
    tearDown = auth_tests.DemoAuthTest.tearDown

    def cookie(self, role):
        token, _ = self.backend.DEMO_SESSIONS.create('research-test', 600, role=role)
        return f'{self.auth.COOKIE_NAME}={token}'

    def raw(self, method, route, cookie='', host=auth_tests.OPS_HOST):
        client=http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        try:
            client.request(method, route, headers={'Host':host,'Cookie':cookie})
            response=client.getresponse()
            return response.status, response.read()
        finally:
            client.close()

    def test_every_role_reads_all_original_files(self):
        for role in ('operator','site_viewer','platform_demo'):
            cookie=self.cookie(role)
            for route in self.backend.SHARED_RESEARCH_ROUTES:
                for method in ('GET','HEAD'):
                    with self.subTest(role=role,route=route,method=method):
                        status,body=self.raw(method,route+'?v=shared',cookie)
                        self.assertEqual(status,200)
                        if method=='HEAD':self.assertEqual(body,b'')
            status,body=self.raw('GET','/research/catalog.js',cookie)
            catalog=json.loads(body.decode().removeprefix('window.NorthstarResearchCatalog = ').strip().removesuffix(';'))
            self.assertEqual(len(catalog['projects']),7)
            files=[f for p in catalog['projects'] for f in p['files']]
            self.assertEqual(len(files),14)
            for file in files:
                self.assertEqual(hashlib.sha256(base64.b64decode(file['base64'])).hexdigest(),file['sourceSha256'])

    def test_anonymous_expired_and_public_host_stay_blocked(self):
        expired,_=self.backend.DEMO_SESSIONS.create('expired',-1,role='operator')
        for route in self.backend.SHARED_RESEARCH_ROUTES:
            for method in ('GET','HEAD'):
                for cookie in ('',f'{self.auth.COOKIE_NAME}={expired}'):
                    self.assertEqual(self.raw(method,route,cookie)[0],401)
                self.assertEqual(self.raw(method,route,self.cookie('operator'),auth_tests.PUBLIC_HOST)[0],403)

    def test_research_does_not_grant_other_documents_or_writes(self):
        for role in ('site_viewer','platform_demo'):
            cookie=self.cookie(role)
            for route in ('/research/private.html','/research/projects/private.md',
                          '/research/../knowledge-library.html','/research/%2e%2e/device-library.js',
                          '/research\\..\\device-library.js',
                          '/api/library','/data/private.json'):
                for method in ('GET','HEAD'):
                    self.assertIn(self.raw(method,route,cookie)[0],(403,405))
            for route in self.backend.SHARED_RESEARCH_ROUTES:
                self.assertEqual(self.raw('POST',route,cookie)[0],403)
            # The newer platform demo explicitly serves the shared shell's boot
            # asset and read-only report status. The site-only role still cannot.
            for method in ('GET','HEAD'):
                self.assertEqual(self.raw(method,'/operator-session.js',cookie)[0],
                                 200 if role=='platform_demo' else 403)
            with patch.object(self.backend.daily_report,'request',return_value={'configured':False}) as report:
                self.assertEqual(self.raw('GET','/api/daily-report/status',cookie)[0],
                                 200 if role=='platform_demo' else 403)
                self.assertEqual(report.call_count,1 if role=='platform_demo' else 0)
            for method in ('HEAD','POST','DELETE'):
                self.assertEqual(self.raw(method,'/api/daily-report/status',cookie)[0],403)

    def test_demo_entrypoints_and_research_remain_available(self):
        for role,route in [('site_viewer','/demo-sites.html'),('platform_demo','/platform-demo.html')]:
            status,body=self.raw('GET',route,self.cookie(role))
            self.assertEqual(status,200)
            if role=='site_viewer':
                self.assertTrue(b'href="research.html"' in body)
            else:
                # platform-demo now serves the role-filtered shared dashboard,
                # rather than the historical standalone demo page.
                self.assertTrue(b'operator-session.js' in body and b'demo-mode.js' in body)
            self.assertEqual(self.raw('GET','/research.html',self.cookie(role))[0],200)


if __name__=='__main__':unittest.main()
