from datetime import date, datetime, timedelta, timezone
import json
import struct
import zipfile
from concurrent.futures import ThreadPoolExecutor
import pytest
import northstar_daily_report as report
import northstar_report_sources as sources
import northstar_report_workbook as workbook
from test_data_workspace_http import server
from test_demo_auth import PUBLIC_HOST

UTC=timezone.utc

def test_07_water_sample_never_uses_future_stale_or_ambiguous_series():
    at=datetime(2026,10,17,12,tzinfo=UTC)
    def point(minutes,series='one',value=0):return dict(at=at+timedelta(minutes=minutes),series=series,value=value)
    assert sources.nearest([point(1),point(-16)],at) is None
    assert sources.nearest([point(-15)],at)['value']==0
    assert sources.nearest([point(0,value=None)],at) is None
    with pytest.raises(ValueError):sources.nearest([point(0),point(-1,'two')],at)

def test_precipitation_exact_date_station_zero_and_trace():
    day=date(2026,10,16)
    rows=[dict(properties=dict(CLIMATE_IDENTIFIER='station',LOCAL_DATE='2026-10-16 00:00:00',TOTAL_PRECIPITATION=0,TOTAL_PRECIPITATION_FLAG='T'))]
    assert sources.climate_value(rows,'station',day)==(0,'T')
    assert sources.climate_value(rows,'another',day)==(None,None)
    assert sources.climate_value(rows,'station',day+timedelta(days=1))==(None,None)
    with pytest.raises(ValueError):sources.climate_value(rows*2,'station',day)

def test_timmins_zero_based_month_and_unit_validation():
    data=dict(p=dict(metric_name='precipitation',period_name='daily'),cols=[{},dict(p=dict(units='mm'))],rows=[dict(c=[dict(v=[2026,9,16]),dict(v=0)])])
    assert sources.timmins_value(data,date(2026,10,16))==(0,None)
    assert sources.timmins_value(data,date(2026,9,16))==(None,None)
    data['cols'][1]['p']['units']='in'
    with pytest.raises(ValueError):sources.timmins_value(data,date(2026,10,16))

def test_qc_parser_rejects_other_month_and_shifted_columns():
    cells=['16']+['']*23;cells[12]='0,0';cells[13]='T'
    page='<table><tr><td>7011190 octobre 2026 Total (mm)</td></tr><tr>'+''.join('<td>'+c+'</td>' for c in cells)+'</tr></table>'
    assert sources.qc_value(page,'7011190',date(2026,10,16))==(0,'T')
    with pytest.raises(ValueError):sources.qc_value(page,'7011190',date(2026,9,16))
    with pytest.raises(ValueError):sources.qc_value(page.replace('<td>16</td>','<td>16</td><td>shift</td>'),'7011190',date(2026,10,16))

def test_latest_collection_has_no_0700_pending_gate():
    result=sources.collect('2026-10-17',fetch=lambda _:json.dumps(dict(features=[])),now=datetime(2026,10,17,10,30,tzinfo=UTC))
    assert all(f['status']!='pending' for f in result['fields'])
    assert result['collectionMode']=='latest'
    assert len(result['fields'])==24
    assert len([f for f in result['fields'] if f['status']=='blocked'])==2
    assert all(f['value'] is None for f in result['fields'])

@pytest.fixture
def home(tmp_path,monkeypatch):
    monkeypatch.setenv('NORTHSTAR_DAILY_REPORT_HOME',str(tmp_path))
    (tmp_path/'config.json').write_text(json.dumps(dict(template='fixture.xlsm')))
    return tmp_path

def test_schedule_eastern_dst_and_retry_cutoff():
    value={**report.DEFAULTS,'enabled':True}
    assert report.schedule_slot(value,datetime(2026,7,1,10,29,tzinfo=UTC)) is None
    assert report.schedule_slot(value,datetime(2026,7,1,10,30,tzinfo=UTC))=='2026-07-01:0'
    assert report.schedule_slot(value,datetime(2026,1,1,11,30,tzinfo=UTC))=='2026-01-01:0'
    assert report.schedule_slot(value,datetime(2026,7,1,11,30,tzinfo=UTC))=='2026-07-01:1'
    assert report.schedule_slot(value,datetime(2026,7,1,16,30,tzinfo=UTC))=='2026-07-01:0'

def test_concurrent_refresh_and_daily_slot_are_idempotent(home):
    # Initialize schema before the concurrent requests (as backend startup does).
    with report.connect():pass
    with ThreadPoolExecutor(max_workers=4) as pool:rows=list(pool.map(lambda _:report.enqueue('test','2026-10-17:0'),range(4)))
    assert len({r['id'] for r in rows})==1
    with report.connect() as c:c.execute("UPDATE runs SET state='ready'")
    assert report.enqueue('test','2026-10-17:0')['id']==rows[0]['id']

def test_worker_records_failure_without_publishing_output(home,monkeypatch):
    row=report.enqueue('operator')
    monkeypatch.setattr(report,'prepare',lambda _:(_ for _ in ()).throw(ValueError('private path details')))
    assert report.work_once()
    detail=report.detail(row['id'])
    assert detail['state']=='failed' and detail['files']==[] and 'private path' not in detail['error']
    assert not report.work_once()

def test_report_configuration_and_download_boundaries(home):
    for payload in [dict(time='25:00'),dict(retryMinutes=True),dict(enabled='true'),dict(template='C:/private')]:
        with pytest.raises(ValueError):report.save_settings(payload,'test')
    row=report.enqueue('test');directory=report.run_dir(row['id']);directory.mkdir(parents=True)
    (directory/'template.private.xlsm').write_bytes(b'private')
    for filename in ['template.private.xlsm','../config.json','report-images-only.xlsm']:
        with pytest.raises(LookupError):report.download(row['id'],filename)
    with pytest.raises(LookupError):report.run_dir('../data')

def test_provider_retry_after_persists_across_fields(home,monkeypatch):
    calls=[]
    def limited(url):
        calls.append(url);raise sources.water.SourceError('rate limited',86400)
    monkeypatch.setattr(sources.water,'download',limited)
    for url in ['https://api.weather.gc.ca/a','https://api.weather.gc.ca/b']:
        with pytest.raises(sources.water.SourceError):report.cooldown_fetch(url)
    assert len(calls)==1
    assert (home/'provider-cooldowns.json').exists()

def test_auth_public_host_viewer_and_cross_origin(server,monkeypatch):
    monkeypatch.setattr(report,'request',lambda *args:dict(actor=args[-1]))
    assert server.call('GET','/api/daily-report/status')[0]==401
    cookie=server.session_cookie()
    assert server.call('GET','/api/daily-report/status',cookie=cookie)[1]['actor']=='ron'
    assert server.call('GET','/api/daily-report/file?id=bad&name=x',cookie=cookie,host=PUBLIC_HOST)[0]==403
    assert server.call('GET','/api/daily-report/status',cookie=server.site_viewer_cookie())[0]==403
    assert server.call('POST','/api/daily-report/refresh',{},cookie=cookie,origin='https://untrusted.invalid')[0]==403
    assert 'id="operatorSignIn"' in server.page('/daily-report-automation.html')[1]

def test_media_only_refresh_preserves_every_other_part(tmp_path,monkeypatch):
    template=tmp_path/'template.xlsm';out=tmp_path/'new.xlsm';img=tmp_path/'new.png'
    img.write_bytes(b'\x89PNG\r\n\x1a\n'+b'\x00'*8+struct.pack('>II',300,100)+b'fixture')
    originals={'xl/media/image1.png':b'old','xl/vbaProject.bin':b'macro-bytes','xl/worksheets/sheet2.xml':b'formulas-and-cells','xl/externalLinks/externalLink1.xml':b'links'}
    with zipfile.ZipFile(template,'w') as z:
        for name,raw in originals.items():z.writestr(name,raw)
    monkeypatch.setattr(workbook,'inspect_template',lambda _: [dict(id='fixture',parts=['xl/media/image1.png'])])
    proof=workbook.refresh(template,out,dict(fixture=img));assert proof['replacedMediaParts']==1
    with zipfile.ZipFile(out) as z:
        assert z.read('xl/media/image1.png')==img.read_bytes()
        for name,raw in originals.items():
            if '/media/' not in name:assert z.read(name)==raw
    with pytest.raises(ValueError):workbook.refresh(template,template,dict(fixture=img))
    with pytest.raises(ValueError):workbook.refresh(template,out,dict(fixture=img))
