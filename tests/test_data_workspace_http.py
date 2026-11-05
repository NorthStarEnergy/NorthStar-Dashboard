"""Exercise new routes through the real operator authentication boundary."""
import pytest
import test_demo_auth as support
import northstar_data_workspace as ws

@pytest.fixture
def server():
    case=support.DemoAuthTest()
    case.setUp()
    try:yield case
    finally:case.tearDown()

def test_workspace_requires_authenticated_operator(server,monkeypatch):
    monkeypatch.setattr(ws,'request',lambda *args:dict(actor=args[-1]))
    assert server.call('GET','/api/data-workspace/status')[0]==401
    cookie=server.session_cookie()
    status,result,_=server.call('POST','/api/data-workspace/power/query',{'actor':'forged'},cookie=cookie)
    assert status==200 and result['actor']=='ron'
    assert server.call('GET','/api/data-workspace/status',cookie=cookie,host=support.PUBLIC_HOST)[0]==403
    assert server.call('POST','/api/data-workspace/power/edit',{},cookie=cookie,origin='https://untrusted.invalid')[0]==403
    viewer=server.site_viewer_cookie()
    assert server.call('GET','/api/data-workspace/status',cookie=viewer)[0]==403

def test_workspace_page_requires_sign_in(server):
    status,html=server.page('/data-workspace.html')
    assert status==200 and 'id="operatorSignIn"' in html

def test_workspace_conflicts_and_unavailable_are_safe(server,monkeypatch):
    cookie=server.session_cookie()
    for exception,status in [(ws.Conflict('Reload record'),409),(ws.Unavailable('Database unavailable'),503),(ValueError('Invalid expression'),400)]:
        def fail(*args):raise exception
        monkeypatch.setattr(ws,'request',fail)
        actual,body,_=server.call('POST','/api/data-workspace/power/edit',{},cookie=cookie)
        assert actual==status and body['error']==str(exception)

