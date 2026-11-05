"""Actual PostgreSQL tests. Fixtures create/drop their own ns_test_* database only."""
import json
import os
from pathlib import Path
import time
import uuid
import pytest
from northstar_data_expressions import Expression
from northstar_data_model import fields
import northstar_data_workspace as ws

class PrivateSettings(dict):
    def __repr__(self):return '<disposable PostgreSQL test connection>'

@pytest.fixture(scope='module')
def pg_settings():
    psycopg=pytest.importorskip('psycopg')
    from psycopg import sql
    admin_path=os.environ.get('NORTHSTAR_PG_TEST_ADMIN')
    dsn=os.environ.get('NORTHSTAR_PG_TEST_DSN')
    if not admin_path and not dsn:pytest.skip('Explicit disposable PostgreSQL test connection not supplied')
    if admin_path:admin=json.loads(Path(admin_path).read_text())
    else:
        from psycopg.conninfo import conninfo_to_dict
        admin=conninfo_to_dict(dsn)
    name='ns_test_'+uuid.uuid4().hex
    with psycopg.connect(**admin,autocommit=True) as c:c.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
    settings=PrivateSettings({**admin,'dbname':name})
    try:
        ws.initialize(settings)
        yield settings
    finally:
        assert name.startswith('ns_test_')
        with psycopg.connect(**admin,autocommit=True) as c:c.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))

@pytest.fixture
def pg(pg_settings,monkeypatch):
    monkeypatch.setattr(ws,'config',lambda:pg_settings)
    with ws.connect() as c:
        c.execute('TRUNCATE '+','.join('"'+k+'"' for k in ws.DATASETS)+',audit,configuration_audit,formulas,saved_items,previews,jobs RESTART IDENTITY')
    return pg_settings

def power(**values):
    return ws.edit_record('power',{'values':{**dict(site='Fixture station',equipment='Test G1',observed_at='2026-01-01T00:00:00Z',power_mw=2,interval_hours=3),**values}},'test-operator')

@pytest.mark.parametrize('source',["__import__('os')",'power_mw.__class__','[x for x in range(10)]','power_mw ** 999999','open(1)','power_mw; DROP TABLE power','unknown + 1'])
def test_expression_rejects_code(source):
    with pytest.raises(ValueError):Expression(fields('power')).compile(source)

def test_expression_parameterizes_constants():
    compiler=Expression(fields('power'));sql=compiler.compile('ROUND(power_mw / 0, 2)')
    assert 'NULLIF' in sql and compiler.parameters==[0.0]

def test_empty_database_and_safe_repeat_setup(pg):
    ws.initialize(pg)
    assert len(ws.metadata()['datasets'])==8
    for name in ws.DATASETS:assert ws.query_rows(name,{})['rows']==[]

def test_typed_edit_conflicts_and_history(pg):
    row=power();changed=ws.edit_record('power',dict(id=row['_id'],version=1,values={'power_mw':4}),'second-operator')
    assert changed['_version']==2 and changed['power_mw']==4
    with pytest.raises(ws.Conflict):ws.edit_record('power',dict(id=row['_id'],version=1,values={'power_mw':5}),'test-operator')
    history=ws.request('GET','/api/data-workspace/power/history',{'id':row['_id']},{},'test-operator')['items']
    assert [r['version'] for r in history]==[2,1]
    assert history[0]['before_row']['power_mw']==2

def test_reject_bad_values_and_unknown_fields(pg):
    for vals in [{'power_mw':'NaN'},{'observed_at':'2026-01-01'},{'site':''},{'_actor':'forged'}]:
        with pytest.raises(ValueError):power(**vals)

def test_filter_paging_nulls_sort_and_cursor_binding(pg):
    for i in range(7):power(power_mw=i if i<5 else None)
    cursor=None;found=[]
    while True:
        result=ws.query_rows('power',dict(sort='power_mw',direction='asc',limit=2,cursor=cursor))
        found.extend(r['_id'] for r in result['rows']);cursor=result['nextCursor']
        if not cursor:break
    assert len(found)==len(set(found))==7
    filtered=ws.query_rows('power',dict(filters=[dict(field='power_mw',op='gte',value=3)]))
    assert sorted(r['power_mw'] for r in filtered['rows'])==[3,4]
    first=ws.query_rows('power',dict(limit=1))
    with pytest.raises(ValueError):ws.query_rows('power',dict(cursor=first['nextCursor'],filters=[dict(field='site',op='eq',value='other')]))

def test_formulas_dependencies_nulls_and_revision_guard(pg):
    power()
    ws.save_formula('power',dict(name='calculated_energy',label='Calculated energy',expression='ROUND(power_mw * interval_hours, 3)',unit='MWh'),'test-operator')
    ws.save_formula('power',dict(name='double_energy',label='Double energy',expression='calculated_energy * 2'),'test-operator')
    assert ws.query_rows('power',{})['rows'][0]['double_energy']==12
    with pytest.raises(ws.Conflict):ws.save_formula('power',dict(name='double_energy',label='New',expression='1'),'other')
    with pytest.raises(ValueError):ws.save_formula('power',dict(name='calculated_energy',label='Circular',expression='double_energy',version=1),'test-operator')
    ws.save_formula('power',dict(name='zero_division',label='Zero division',expression='power_mw / 0'),'test-operator')
    assert ws.query_rows('power',{})['rows'][0]['zero_division'] is None

def test_water_forecasts_ecology_validation(pg):
    with pytest.raises(ValueError):ws.edit_record('water',dict(values=dict(site='Test',observed_at='2026-01-01T00:00:00Z',level_m=1)),'tester')
    with pytest.raises(ValueError):ws.edit_record('weather',dict(values=dict(site='Test',observed_at='2026-01-01T00:00:00Z',kind='forecast')),'tester')
    row=ws.edit_record('ecology',dict(values=dict(site='Test',observed_at='2026-01-01T00:00:00Z',species='Fixture',measure='presence',presence='unknown')),'tester')
    assert row['count'] is None

def test_chart_aggregates_ignore_missing(pg):
    power(power_mw=2);power(power_mw=4);power(power_mw=None)
    result=ws.chart('power',dict(group='observed_at',metric='power_mw',aggregate='avg',bucket='day'))
    assert result['points'][0]['y']==3 and result['points'][0]['n']==3 and result['points'][0]['valid']==2

def test_saved_views_are_private_and_versioned(pg):
    item=ws.save_item('power',dict(kind='view',name='My view',body={'filters':[]}),'one')
    assert ws.saved_items('power','two')==[]
    with pytest.raises(ws.Conflict):ws.save_item('power',dict(kind='view',name='My view',body={}), 'one')
    changed=ws.save_item('power',dict(kind='view',name='My view',body={},version=item['version']),'one')
    assert changed['version']==2

def wait_job(job_id):
    for _ in range(100):
        with ws.connect() as c:job=c.execute('SELECT * FROM jobs WHERE id=%s',(job_id,)).fetchone()
        if job['status'] not in ('running','queued'):return job
        time.sleep(.05)
    pytest.fail('Job did not finish')

def test_script_preview_is_scoped_single_use_and_audited(pg):
    power();power(site='Other fixture')
    plan=ws.preview_script('power',dict(source='SET energy_mwh = power_mw * interval_hours',filters=[dict(field='site',op='eq',value='Fixture station')]),'tester')
    assert plan['count']==1 and plan['sample'][0]['after_energy_mwh']==6
    with pytest.raises(ValueError):ws.start_job('power',dict(token=plan['token']),'other')
    job=ws.start_job('power',dict(token=plan['token']),'tester');done=wait_job(job['id'])
    assert done['status']=='completed' and done['processed']==1
    with pytest.raises(ValueError):ws.start_job('power',dict(token=plan['token']),'tester')
    rows=ws.query_rows('power',{})['rows'];assert sorted(r['energy_mwh'] is None for r in rows)==[False,True]
    with ws.connect() as c:assert c.execute('SELECT count(*) AS n FROM audit WHERE job_id=%s',(job['id'],)).fetchone()['n']==1

def test_script_excludes_records_changed_since_preview(pg):
    row=power();plan=ws.preview_script('power',dict(source='SET power_mw = power_mw * 2'),'tester')
    ws.edit_record('power',dict(id=row['_id'],version=1,values={'power_mw':8}),'other')
    job=ws.start_job('power',dict(token=plan['token']),'tester');done=wait_job(job['id'])
    assert done['processed']==0 and ws.query_rows('power',{})['rows'][0]['power_mw']==8

def test_cancel_keeps_history_without_applying_unstarted_batch(pg,monkeypatch):
    row=power();plan=ws.preview_script('power',dict(source='SET power_mw = 10'),'tester')
    captured=[];monkeypatch.setattr(ws.EXECUTOR,'submit',lambda fn,*args:captured.append((fn,args)))
    job=ws.start_job('power',dict(token=plan['token']),'tester')
    ws.request('POST','/api/data-workspace/power/cancel',{},dict(id=job['id']),'tester')
    captured[0][0](*captured[0][1]);done=wait_job(job['id'])
    assert done['status']=='cancelled' and done['processed']==0
    assert ws.query_rows('power',{})['rows'][0]['power_mw']==row['power_mw']
