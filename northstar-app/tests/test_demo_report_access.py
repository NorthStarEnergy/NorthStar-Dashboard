import unittest,os,json,http.client
from pathlib import Path
from unittest.mock import patch
import test_demo_auth as auth_tests
class DemoReportAccess(unittest.TestCase):
 call=auth_tests.DemoAuthTest.call
 def setUp(self):
  auth_tests.DemoAuthTest.setUp(self)
  self.home=Path(self.directory.name)/'reports';self.home.mkdir();(self.home/'config.json').write_text(json.dumps({'template':'fixture.xlsm'}))
  self.env=patch.dict(os.environ,{'NORTHSTAR_DAILY_REPORT_HOME':str(self.home)});self.env.start()
  token,_=self.backend.DEMO_SESSIONS.create('demo',600,role=self.auth.ROLE_PLATFORM_DEMO);self.cookie=f'{self.auth.COOKIE_NAME}={token}'
 def tearDown(self):__import__("gc").collect();self.env.stop();auth_tests.DemoAuthTest.tearDown(self)
 def test_pull_status_review_and_deduplication(self):
  status,job,_=self.call('POST','/api/daily-report/refresh',{},cookie=self.cookie);self.assertEqual(status,200);self.assertEqual(job['actor'],'demo');self.assertEqual(job['state'],'queued')
  self.assertEqual(self.call('POST','/api/daily-report/refresh',{},cookie=self.cookie)[1]['id'],job['id'])
  self.assertEqual(self.call('GET','/api/daily-report/status',cookie=self.cookie)[0],200)
  self.assertEqual(self.call('GET','/api/daily-report/run?id='+job['id'],cookie=self.cookie)[0],200)
 def test_authorized_download_still_uses_file_allowlist(self):
  file=self.home/'inputs.csv';file.write_text('cell,value\nD5,415.19\n')
  with patch.object(self.backend.daily_report,'download',return_value=file) as download:
   c=http.client.HTTPConnection('127.0.0.1',self.server.server_port)
   c.request('GET','/api/daily-report/file?id=fixture&name=inputs.csv',headers={'Host':auth_tests.OPS_HOST,'Cookie':self.cookie});r=c.getresponse();self.assertEqual(r.status,200);self.assertIn(b'415.19',r.read());c.close();download.assert_called_once_with('fixture','inputs.csv')
  self.assertEqual(self.call('GET','/api/daily-report/file?id=invalid&name=../../secret',cookie=self.cookie)[0],404)
 def test_schedule_other_workspaces_and_cross_origin_stay_denied(self):
  for path in ['/api/daily-report/settings','/api/water-collection/collect','/api/data-workspace/import','/api/outages']:
   self.assertEqual(self.call('POST',path,{},cookie=self.cookie)[0],403)
  self.assertEqual(self.call('POST','/api/daily-report/refresh',{},cookie=self.cookie,origin='https://other.invalid')[0],403)
  self.assertEqual(self.call('POST','/api/daily-report/refresh',{})[0],401)
  token,_=self.backend.DEMO_SESSIONS.create('limited',600,role=self.auth.ROLE_SITE_VIEWER)
  self.assertEqual(self.call('POST','/api/daily-report/refresh',{},cookie=f'{self.auth.COOKIE_NAME}={token}')[0],403)

