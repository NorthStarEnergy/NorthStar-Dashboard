"""HTTP integration: knowledge routes retain operator/hostname/origin gates."""
import base64
import unittest
import test_demo_auth as demo

class KnowledgeRouteTest(unittest.TestCase):
    def setUp(self):
        self.fixture=demo.DemoAuthTest(); self.fixture.setUp()
    def tearDown(self): self.fixture.tearDown()
    def test_auth_host_viewer_and_write_origin(self):
        f=self.fixture
        for method,path in [('GET','/api/ai/knowledge'),('GET','/api/ai/knowledge/search?q=relay'),('GET','/api/ai/knowledge/sources/unknown'),('GET','/api/ai/knowledge/sources/unknown/file'),('POST','/api/ai/knowledge/upload'),('POST','/api/ai/knowledge/sources/unknown/review')]:
            self.assertIn(f.call(method,path)[0],(401,403)); self.assertEqual(f.call(method,path,host=demo.PUBLIC_HOST)[0],403)
        cookie=f.session_cookie()
        self.assertEqual(f.call('GET','/api/ai/knowledge',cookie=cookie)[0],200)
        self.assertEqual(f.call('POST','/api/ai/knowledge/upload',{},cookie=cookie,origin='https://evil.example')[0],403)
        viewer=f.site_viewer_cookie()
        self.assertEqual(f.call('GET','/api/ai/knowledge',cookie=viewer)[0],403)
    def test_authenticated_upload_review_search_file_and_query(self):
        f=self.fixture;cookie=f.session_cookie()
        payload={'title':'Fixture relay manual','revision':'1','sourceKey':'fixture','filename':'fixture.md','siteId':'site:kenora','contentBase64':base64.b64encode(b'Fixture relay inspection documentation').decode()}
        status,source,_=f.call('POST','/api/ai/knowledge/upload',payload,cookie=cookie);self.assertEqual(status,200)
        path='/api/ai/knowledge/sources/'+source['id']
        self.assertEqual(f.call('GET','/api/ai/knowledge/search?q=fixture',cookie=cookie)[1]['results'],[])
        review={'status':'CURRENT_CONTROLLED','owner':'Fixture owner','revision':'1','effective_from':'2020-01-01','review_due':'2099-01-01','reason':'Test-only human review','confirmed':True}
        self.assertEqual(f.call('POST',path+'/review',review,cookie=cookie)[0],200)
        result=f.call('GET','/api/ai/knowledge/search?q=fixture&siteId=site%3Akenora',cookie=cookie)[1]['results'];self.assertEqual(result[0]['sourceId'],source['id'])
        self.assertEqual(f.call('GET',path,cookie=cookie)[1]['passages'][0]['text'],'Fixture relay inspection documentation')
        f.backend.ai.engine_name=lambda:'summary'
        response=f.call('POST','/api/ai/query',{'question':'fixture relay','context_scope':'dashboard','siteId':'site:kenora'},cookie=cookie)
        self.assertEqual(response[0],200);self.assertEqual(response[1]['citations'][0]['siteId'],'site:kenora')
