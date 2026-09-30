from datetime import datetime, timezone
from urllib.parse import parse_qs, urlsplit
import pytest
import northstar_water_elevations as water

NOW = datetime(2026, 9, 22, 12, tzinfo=timezone.utc)

def wsc(value=322.1, stamp="2026-09-22T11:00:00Z", station="05PE006"):
    return {"properties": {"STATION_NUMBER":station,"LEVEL":value,"DATETIME":stamp}}

def store(fetch):
    return water.ElevationStore(fetch=fetch,now=lambda:NOW)

def query(**kw):
    return {k:[v] for k,v in kw.items()}

def test_default_current_and_cache_no_history_query():
    urls=[]
    def fetch(url):
        urls.append(url)
        return {"features":[wsc()]}
    s=store(fetch)
    a=s.get(query(station="05PE006"));b=s.get(query(station="05PE006"))
    assert a==b and len(urls)==1 and "datetime=" not in urls[0]
    assert a["mode"]=="current" and a["stations"][0]["readings"][0]["waterLevelM"]==322.1
    b["stations"][0]["readings"].clear()
    assert s.get(query(station="05PE006"))["stations"][0]["readings"]

@pytest.mark.parametrize('value,expected',[(0,0),(None,None),('NaN',None),('Infinity',None)])
def test_missing_and_zero(value,expected):
    result=store(lambda u:{"features":[wsc(value)]}).get(query(station="05PE006"))["stations"][0]
    assert result["readings"][0]["waterLevelM"]==expected
    assert result["state"]==('ok' if expected is not None else 'not_reported')

def test_usgs_navd88_conversion_without_workbook_offset():
    def fetch(url):
        assert 'parameter_code=63160' in url
        return {"features":[{"properties":{"monitoring_location_id":"USGS-05127500","parameter_code":"63160","value":"1300.40","unit_of_measure":"ft","time":"2026-09-22T11:00:00Z","approval_status":"Provisional"}}]}
    result=store(fetch).get(query(station="05127500"))["stations"][0]
    assert result["datum"]=='NAVD88'
    assert result["readings"][0]["waterLevelM"]==pytest.approx(1300.4*.3048)

def test_pagination_dedup_order_scope_and_inclusive_end_date():
    calls=[]
    def fetch(url):
        calls.append(url)
        if len(calls)==1:
            return {"features":[wsc(2,'2026-09-21T23:59:59Z'),wsc(1,'2026-09-21T00:00:00Z')],"links":[{"rel":"next","href":url+'&offset=2'}]}
        return {"features":[wsc(1,'2026-09-21T00:00:00Z'),wsc(3,'2026-09-22T00:00:00Z'),wsc(5,'2026-09-21T10:00:00Z','other')]}
    r=store(fetch).get(query(station='05PE006',start='2026-09-21',end='2026-09-21'))
    assert len(calls)==2
    assert [x['waterLevelM'] for x in r['stations'][0]['readings']]==[1,2]
    assert r['endExclusive']=='2026-09-22T00:00:00+00:00'

def test_stale_and_failure_do_not_create_current_values():
    r=store(lambda u:{'features':[wsc(stamp='2026-09-20T12:00:00Z')]}).get(query(station='05PE006'))
    assert r['stations'][0]['state']=='stale'
    def fail(u): raise OSError('private details')
    r=store(fail).get(query(station='05PE006'))
    assert r['partial'] and r['stations'][0]['readings']==[]
    assert 'private details' not in r['stations'][0]['message']

def test_old_wsc_range_uses_daily_archive_and_keeps_null():
    def fetch(u):
        assert 'hydrometric-daily-mean' in u
        return {'features':[{'properties':{'STATION_NUMBER':'05PE006','DATE':'2020-01-01','LEVEL':None}}]}
    r=store(fetch).get(query(station='05PE006',start='2020-01-01',end='2020-01-02'))['stations'][0]
    assert r['resolution']=='daily_mean' and r['coverage']['missingValues']==1

@pytest.mark.parametrize('args',[
    dict(station='bad'),dict(start='2026-09-01',end='2026-09-02'),
    dict(station='05PE006',start='2026-09-01'),
    dict(station='05PE006',start='2026-09-23',end='2026-09-24'),
    dict(station='05PE006',start='2026-09-22',end='2026-09-21'),
    dict(station='05PE006',start='2024-01-01',end='2026-09-21'),
    dict(station='05PE006',start='not-date',end='2026-09-21'),
])
def test_invalid_queries_rejected_before_network(args):
    def fetch(u): pytest.fail('Network must not run')
    with pytest.raises(ValueError):store(fetch).get(query(**args))

def test_untrusted_next_url_and_partial_page_failure_never_report_complete():
    calls=[]
    def fetch(url):
        calls.append(url)
        return {'features':[wsc()], 'links':[{'rel':'next','href':'http://127.0.0.1/secrets'}]}
    r=store(fetch).get(query(station='05PE006',start='2026-09-21',end='2026-09-22'))['stations'][0]
    assert len(calls)==1 and r['state']=='unavailable' and r['readings']==[]

def test_one_provider_failure_does_not_remove_other_stations():
    def fetch(url):
        q=parse_qs(urlsplit(url).query)
        if q.get('STATION_NUMBER')==['05PE006']:return {'features':[wsc()]}
        raise OSError('offline')
    r=store(fetch).get({})
    assert len(r['stations'])==13 and r['partial']
    assert next(s for s in r['stations'] if s['id']=='05PE006')['state']=='ok'

def test_routes_are_operator_only():
    import ieso_backend as backend
    for route in ['/api/water-elevations','/api/water-elevations/catalog']:
        assert backend.OPERATOR_ROUTES[route]==('GET',)
        assert route not in backend.CHECKIN_PUBLIC_ROUTES


def test_http_routes_authentication_range_validation_and_catalog():
    from test_demo_auth import DemoAuthTest, PUBLIC_HOST
    fixture=DemoAuthTest()
    fixture.setUp()
    try:
        fixture.backend.WATER_ELEVATIONS=store(lambda u:{'features':[wsc()]})
        cookie=fixture.session_cookie()
        for path in ['/api/water-elevations','/api/water-elevations/catalog']:
            assert fixture.call('GET',path)[0]==401
            assert fixture.call('GET',path,host=PUBLIC_HOST,cookie=cookie)[0]==403
            assert fixture.call('GET',path,cookie=cookie)[0]==200
        code,body,_=fixture.call('GET','/api/water-elevations?station=bad',cookie=cookie)
        assert code==400 and 'Unknown' in body['error']
        code,body,_=fixture.call('GET','/api/water-elevations?station=05PE006',cookie=cookie)
        assert code==200 and body['stations'][0]['readings'][0]['waterLevelM']==322.1
    finally:
        fixture.tearDown()
