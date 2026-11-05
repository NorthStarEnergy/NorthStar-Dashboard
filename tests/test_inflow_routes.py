from unittest.mock import patch
import unittest
import test_packet20_hostname_separation as host_tests
from test_packet20_hostname_separation import OPS_HOST,PUBLIC_HOST

class InflowRoutes(unittest.TestCase):
 setUp=host_tests.HostnameSeparationTest.setUp
 tearDown=host_tests.HostnameSeparationTest.tearDown
 use_gate=host_tests.HostnameSeparationTest.use_gate
 call=host_tests.HostnameSeparationTest.call
 status=host_tests.HostnameSeparationTest.status
 session_cookie=host_tests.HostnameSeparationTest.session_cookie
 def test_inflow_requires_operator(self):
  self.assertEqual(self.status('GET','/api/inflows/status',host=OPS_HOST),401)
  self.assertEqual(self.status('GET','/api/inflows/status',host=PUBLIC_HOST),403)
  self.assertEqual(self.status('POST','/api/inflows/refresh',{},host=PUBLIC_HOST),403)
 def test_authenticated_route_dispatch(self):
  cookie=self.session_cookie()
  with patch.object(self.backend.inflow,'request',return_value={'latest':None}) as request:
   status,body,_=self.call('GET','/api/inflows/status',host=OPS_HOST,cookie=cookie)
   self.assertEqual(status,200);self.assertEqual(body,{'latest':None})
   request.assert_called_once_with('GET','/api/inflows/status',{})
 def test_new_static_view_hidden_on_checkin(self):
  for p in ['/inflow-outlook.html','/inflow-outlook.js','/inflow-outlook.css']:
   self.assertEqual(self.status('GET',p,host=PUBLIC_HOST),404)
 def test_authenticated_refresh_dispatch(self):
  cookie=self.session_cookie()
  with patch.object(self.backend.inflow,'request',return_value={'state':'running'}) as request:
   status,body,_=self.call('POST','/api/inflows/refresh',{},host=OPS_HOST,cookie=cookie)
   self.assertEqual(status,202);request.assert_called_once_with('POST','/api/inflows/refresh',{})
 def test_cross_origin_refresh_refused(self):
  from urllib.request import Request,urlopen
  from urllib.error import HTTPError
  cookie=self.session_cookie()
  req=Request(self.base+'/api/inflows/refresh',data=b'{}',headers={'Host':OPS_HOST,'Cookie':cookie,'Content-Type':'application/json','Origin':'https://untrusted.invalid'},method='POST')
  with patch.object(self.backend.inflow,'request') as dispatch:
   try:response=urlopen(req,timeout=5)
   except HTTPError as e:response=e
   self.assertEqual(response.status,403);dispatch.assert_not_called()
