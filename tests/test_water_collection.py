"""Public provider parsing and real PostgreSQL collection; no operating DB writes."""
from datetime import datetime, timedelta, timezone
import json
from urllib.error import HTTPError
import pytest
import northstar_water_sources as providers
import northstar_water_collection as water
import northstar_data_workspace as db
from test_data_workspace import pg_settings

UTC=timezone.utc
START=datetime(2026,7,1,tzinfo=UTC)
END=START+timedelta(days=1)

def feature(properties):return dict(type='Feature',properties=properties)

def test_wsc_parser_preserves_missing_zero_quality_and_datums():
    station=providers.STATIONS[('wsc','04LF001')]
    body=json.dumps(dict(features=[feature(dict(STATION_NUMBER=station['id'],DATETIME='2026-07-01T12:00:00Z',LEVEL=0,DISCHARGE=None,LEVEL_SYMBOL_EN='Estimated'))]))
    points=providers.collect_station('wsc',station,START,END,fetch=lambda _:body)
    assert [(p['metric'],p['value']) for p in points]==[('water_level',0),('discharge',None)]
    assert points[0]['datum']=='Assumed datum' and points[0]['quality']['symbol']=='Estimated'

def test_usgs_elevation_conversion_and_series_identity():
    station=providers.STATIONS[('usgs','05127500')]
    p=dict(monitoring_location_id='USGS-05127500',parameter_code='63160',time='2026-07-01T12:00:00Z',
           value='1000',unit_of_measure='ft',time_series_id='test-series',approval_status='Provisional',qualifier=['Ice'])
    fetch=lambda _:json.dumps(dict(features=[feature(p)]))
    points=providers.collect_station('usgs',station,START,END,fetch=fetch)
    assert len(points)==1 and points[0]['value']==304.8 and points[0]['datum']=='NAVD88'
    assert points[0]['raw_value']=='1000' and points[0]['series']=='test-series'
    p['unit_of_measure']='m'
    with pytest.raises(providers.SourceError):providers.collect_station('usgs',station,START,END,fetch=fetch)

def test_cehq_uses_fixed_est_during_summer_and_keeps_report_points():
    station=providers.STATIONS[('cehq','050801')]
    body='Date\tHeure\tDébit\n2026-07-01\t10:00\t0,00\n2026-07-01\t10:15\t12,30\n'
    points=providers.collect_station('cehq',station,START,END,fetch=lambda _:body)
    assert points[0]['observed_at']==datetime(2026,7,1,15,tzinfo=UTC)
    assert [p['value'] for p in points]==[0,12.3]
    import northstar_flows
    legacy=northstar_flows.parse_cehq_report(body,northstar_flows.CEHQ_STATIONS[0])
    assert providers.timestamp(legacy['observedAt'])==datetime(2026,7,1,15,15,tzinfo=UTC)

@pytest.mark.parametrize('link',['http://api.weather.gc.ca/collections/a/items','https://untrusted.invalid/collections/a/items','https://api.weather.gc.ca/private','https://user@api.weather.gc.ca/collections/a/items'])
def test_pagination_refuses_unknown_destinations(link):
    with pytest.raises(providers.SourceError):providers.validate_url(link,'https://api.weather.gc.ca/collections/a/items')

def test_paginated_fetch_is_complete_or_fails():
    base='https://api.weather.gc.ca/collections/a/items'
    data={base:dict(features=[feature({'one':1})],links=[dict(rel='next',href='?offset=1')]),base+'?offset=1':dict(features=[feature({'two':2})])}
    assert len(providers.pages(base,lambda url:json.dumps(data[url]),float('inf')))==2
    data[base+'?offset=1']['links']=[dict(rel='next',href=base)]
    with pytest.raises(providers.SourceError):providers.pages(base,lambda url:json.dumps(data[url]),float('inf'))

def test_rate_limit_is_deferred_without_retries(monkeypatch):
    class Opener:
        calls=0
        def open(self,*args,**kwargs):
            self.calls+=1
            raise HTTPError('https://api.weather.gc.ca/',429,'limited',{'Retry-After':'900'},None)
    opener=Opener();monkeypatch.setattr(providers,'build_opener',lambda *_:opener)
    with pytest.raises(providers.SourceError) as error:providers.download('https://api.weather.gc.ca/')
    assert error.value.retry_seconds==900 and opener.calls==1

@pytest.fixture
def collected(pg_settings,monkeypatch):
    monkeypatch.setattr(db,'config',lambda:pg_settings)
    water.initialize(pg_settings)
    with db.connect() as c:
        c.execute('TRUNCATE ns_water.revisions,ns_water.observations,ns_water.runs,ns_water.settings_audit,ns_water.sources RESTART IDENTITY')
    water.initialize(pg_settings)
    water.configure('wsc',dict(version=1,stationIds=['04LF001']),'fixture-owner')
    return pg_settings

def sample_point(value=2,at=None):
    return providers.point(providers.STATIONS[('wsc','04LF001')],'water_level','water_level',at or datetime.now(UTC)-timedelta(minutes=15),
        value,value,'m',{'status':'Provisional'},providers.PROVIDERS['wsc']['endpoint'])

def execute(settings,points):
    job=water.claim('wsc','fixture-operator')
    water.run(job['id'],settings,fetch_station=lambda *args,**kwargs:points)
    with db.connect() as c:
        result=c.execute('SELECT * FROM ns_water.runs WHERE id=%s',(job['id'],)).fetchone()
        c.execute("UPDATE ns_water.sources SET last_finished_at=now()-interval '61 seconds' WHERE id='wsc'")
    return result

def test_collection_has_only_known_providers_and_empty_operating_tables(collected):
    meta=water.status()
    assert {s['id'] for s in meta['sources']}=={'wsc','cehq','usgs'}
    for s in meta['sources']:
        assert all(providers.STATIONS[(s['id'],station)]['active'] for station in s['station_ids'])
    with db.connect() as c:
        for name in db.DATASETS:assert c.execute(f'SELECT count(*) AS n FROM "{name}"').fetchone()['n']==0

def test_settings_are_versioned_and_audited(collected):
    row=water.configure('wsc',dict(version=2,enabled=False,intervalMinutes=60),'second-operator')
    assert row['version']==3 and row['next_run_at'] is None
    with pytest.raises(db.Conflict):water.configure('wsc',dict(version=2,intervalMinutes=15),'old-client')
    with pytest.raises(ValueError):water.configure('wsc',dict(version=3,intervalMinutes=1),'operator')
    with pytest.raises(ValueError):water.configure('wsc',dict(version=3,stationIds=['04MC001']),'operator')
    assert len(water.request('GET','/api/water-collection/settings-history',{},None,'operator')['items'])==2

def test_duplicate_collection_and_provider_correction_history(collected):
    point=sample_point();first=execute(collected,[point]);assert first['status']=='completed' and first['inserted']==1
    second=execute(collected,[point]);assert second['unchanged']==1 and second['inserted']==0
    changed={**point,'value':2.1,'raw_value':2.1};third=execute(collected,[changed]);assert third['revised']==1
    rows=water.observations({})['rows'];assert len(rows)==1 and rows[0]['revision']==2 and rows[0]['value']==2.1
    history=water.request('GET','/api/water-collection/history',{'id':str(rows[0]['id'])},None,'operator')['items']
    assert [h['record']['value'] for h in history]==[2.1,2]
    assert next(s for s in water.status()['sources'] if s['id']=='wsc')['total_observations']==1

def test_durable_active_run_dedupes_and_expired_lease_recovers(collected):
    first=water.claim('wsc','one');second=water.claim('wsc','two')
    assert first['id']==second['id'] and second['alreadyRunning']
    with db.connect() as c:c.execute("UPDATE ns_water.runs SET lease_until=now()-interval '1 second' WHERE id=%s",(first['id'],))
    fresh=water.claim('wsc','two')
    assert fresh['id']!=first['id']
    water.run(first['id'],collected,fetch_station=lambda *args,**kwargs:pytest.fail('Expired run fetched provider'))

def test_pause_schedule_does_not_block_on_demand(collected):
    water.configure('wsc',dict(version=2,enabled=False),'operator')
    assert water.claim('wsc','scheduler','scheduled') is None
    assert water.claim('wsc','operator')['status']=='queued'

def test_scheduler_claims_only_due_enabled_sources(collected,monkeypatch):
    queued=[];monkeypatch.setattr(water.EXECUTOR,'submit',lambda fn,*args:queued.append(args))
    with db.connect() as c:c.execute("UPDATE ns_water.sources SET next_run_at=now()+interval '1 hour' WHERE id='usgs'");c.execute("UPDATE ns_water.sources SET enabled=false WHERE id='cehq'")
    water.tick(collected);water.tick(collected)
    assert len(queued)==1
    water.run(queued[0][0],collected,fetch_station=lambda *args,**kwargs:[])
    assert water.claim('wsc','scheduler','scheduled') is None

def test_rate_limit_cooldown_survives_manual_and_scheduled_calls(collected):
    job=water.claim('wsc','operator')
    def limited(*args,**kwargs):raise providers.SourceError('Provider rate limit; collection deferred',900)
    water.run(job['id'],collected,fetch_station=limited)
    with pytest.raises(db.Conflict):water.claim('wsc','operator')
    assert water.claim('wsc','scheduler','scheduled') is None
    assert next(s for s in water.status()['sources'] if s['id']=='wsc')['last_state']=='failed'

def test_filtered_observation_pagination_is_bounded_and_bound_to_scope(collected):
    now=datetime.now(UTC)-timedelta(hours=1)
    execute(collected,[sample_point(i,now+timedelta(seconds=i)) for i in range(7)])
    first=water.observations({'source':'wsc','limit':'2'})
    second=water.observations({'source':'wsc','limit':'2','cursor':first['nextCursor']})
    assert not {r['id'] for r in first['rows']} & {r['id'] for r in second['rows']}
    with pytest.raises(ValueError):water.observations({'source':'usgs','cursor':first['nextCursor']})
    with pytest.raises(ValueError):water.observations({'start':'yesterday'})
    assert water.observations({'metric':'discharge'})['rows']==[]
