"""Shared demo dashboard; red modules remain server-restricted."""
import http.client,unittest
from unittest.mock import patch
from pathlib import Path
import test_demo_auth as auth_tests
class DemoMenuTest(unittest.TestCase):
 tearDown=auth_tests.DemoAuthTest.tearDown
 call=auth_tests.DemoAuthTest.call
 sign_in=auth_tests.DemoAuthTest.sign_in
 session_cookie=auth_tests.DemoAuthTest.session_cookie
 def setUp(self):
  import sys
  sys.path.insert(0,str(Path(__file__).parent.resolve()))
  auth_tests.DemoAuthTest.setUp(self)
  self.backend.ROOT=Path(__file__).resolve().parents[1]
 def cookie(self):
  token,_=self.backend.DEMO_SESSIONS.create('demo',600,role=self.auth.ROLE_PLATFORM_DEMO)
  return f'{self.auth.COOKIE_NAME}={token}'
 def raw(self,method,route,cookie=''):
  c=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=8)
  try:
   c.request(method,route,headers={'Host':auth_tests.OPS_HOST,'Cookie':cookie});r=c.getresponse();return r.status,r.read()
  finally:c.close()
 def test_shared_shell_and_session(self):
  cookie=self.cookie()
  for route in self.backend.PLATFORM_DEMO_ENTRYPOINTS:
   status,body=self.raw('GET',route,cookie);self.assertEqual(status,200);self.assertIn(b'operator-session.js',body)
  self.assertEqual(self.call('GET','/api/auth/session',cookie=cookie)[1]['landingUrl'],'/northstar-clean.html')
  for route in ['/operator-session.js','/module-workspace.js','/demo-mode.js','/dashboard-layout-default.js']:
   self.assertEqual(self.raw('GET',route,cookie)[0],200)
 def test_red_endpoints_and_writes_denied(self):
  cookie=self.cookie()
  for route in ['/api/outages','/api/switching/drafts','/api/scada','/api/voice','/api/library','/api/service-requests','/api/unit-cycling','/api/daily-operations','/api/checkins/history','/api/new-company-data']:
   for method in ['GET','POST','DELETE','HEAD']:
    with self.subTest(route=route,method=method):self.assertEqual(self.raw(method,route,cookie)[0],403)
  self.assertEqual(self.raw('POST','/api/logbook',cookie)[0],403)
 def test_nonred_reads_and_synthetic_roster(self):
  cookie=self.cookie()
  with patch.object(self.store,'list_logbook',return_value=[{'subject':'allowed event'}]):
   self.assertEqual(self.call('GET','/api/logbook',cookie=cookie)[0],200)
  self.assertEqual(self.call('GET','/api/weather',cookie=cookie)[0],200)
  with patch.object(self.store,'list_checkins',side_effect=AssertionError('real roster accessed')):
   rows=self.call('GET','/api/checkins',cookie=cookie)[1];self.assertEqual(len(rows),33)
 def test_static_bypass_and_anonymous(self):
  cookie=self.cookie()
  for route in ['/docs/sop.html','/company.pdf','/budget.xlsx','/outputs/northstar-clean.html','/data/company.js','/northstar-v0.9.html','/%61pi/library','/api/%6cibrary','/platform-demo.html/../knowledge-library.html']:
   for method in ['GET','HEAD']:self.assertIn(self.raw(method,route,cookie)[0],(403,405))
  self.assertEqual(self.raw('GET','/operator-session.js')[0],404)
 def test_operator_access_unchanged(self):
  with patch.object(self.store,'list_logbook',return_value=[{'subject':'operator event'}]):
   self.assertEqual(self.call('GET','/api/logbook',cookie=self.session_cookie())[0],200)
 def test_site_viewer_unchanged(self):
  token,_=self.backend.DEMO_SESSIONS.create('limited',600,role=self.auth.ROLE_SITE_VIEWER)
  cookie=f'{self.auth.COOKIE_NAME}={token}'
  self.assertEqual(self.raw('GET','/operator-session.js',cookie)[0],403)
  self.assertEqual(self.raw('GET','/api/weather',cookie)[0],403)

