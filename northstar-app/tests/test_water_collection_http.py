"""New collection endpoints keep the existing operator and hostname boundaries."""
import pytest
import test_demo_auth as support
import northstar_water_collection as water
from test_data_workspace_http import server

def test_collection_requires_operator_and_same_origin(server,monkeypatch):
    monkeypatch.setattr(water,'request',lambda *args:dict(actor=args[-1]))
    assert server.call('GET','/api/water-collection/status')[0]==401
    cookie=server.session_cookie()
    status,result,_=server.call('POST','/api/water-collection/collect',{'source':'wsc','actor':'forged'},cookie=cookie)
    assert status==202 and result['actor']=='ron'
    assert server.call('GET','/api/water-collection/status',host=support.PUBLIC_HOST,cookie=cookie)[0]==403
    assert server.call('POST','/api/water-collection/collect',{'source':'wsc'},cookie=cookie,origin='https://untrusted.invalid')[0]==403
    assert server.call('GET','/api/water-collection/status',cookie=server.site_viewer_cookie())[0]==403

def test_collection_page_serves_sign_in_before_boot(server):
    code,html=server.page('/water-collection.html')
    assert code==200 and 'id="operatorSignIn"' in html
