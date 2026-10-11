from datetime import datetime, date, timezone
import threading
import json
from urllib.request import Request,urlopen
from urllib.error import HTTPError
import pytest
import northstar_store as store
import northstar_events as events
import northstar_console as console
import northstar_event_register as register

@pytest.fixture
def database(tmp_path,monkeypatch):
    monkeypatch.setattr(store,'DB_PATH',tmp_path/'console.db')
    with store._session() as db:
        db.executescript(store.SCHEMA);console.init_schema(db)


def spec(**extra):
    return {'title':'Review station readings','site':'Kenora','requestId':'create-1',**extra}


def test_task_retry_conflict_and_atomic_audit(database):
    first=console.create_task(spec(),'operator')
    assert console.create_task(spec(),'operator')['id']==first['id']
    with pytest.raises(console.Conflict):console.create_task(spec(title='Different'),'operator')
    assert console.tasks({})['total']==1
    assert register.register({'type':'task'})['total']==1
    with pytest.raises(LookupError):console.create_task(spec(requestId='missing',source_event_id='missing'),'operator')
    assert console.tasks({})['total']==1


def test_versioned_transitions_retries_and_audit(database):
    task=console.create_task(spec(),'operator')
    payload={'id':task['id'],'version':1,'status':'in_progress','requestId':'transition-1'}
    result=console.transition(payload,'operator')
    assert result['version']==2
    assert console.transition(payload,'operator')['version']==2
    with pytest.raises(console.Conflict):console.transition({**payload,'requestId':'other'},'operator')
    assert register.detail(task['event_id'],{})['history']['total']==2
    with pytest.raises(ValueError):console.transition({'id':task['id'],'version':2,'status':'cancelled','requestId':'cancel'},'operator')
    assert console.tasks({})['items'][0]['version']==2


def test_verified_completion_requires_evidence_and_decision(database):
    task=console.create_task(spec(mode='verified'),'operator')
    p={'id':task['id'],'version':1,'status':'completed','requestId':'decision'}
    with pytest.raises(ValueError):console.transition(p,'operator')
    with pytest.raises(ValueError):console.transition({**p,'status':'pending_verification'},'operator')
    submitted=console.transition({**p,'status':'pending_verification','evidence':'Reading sheet 42'},'operator')
    assert submitted['status']=='pending_verification'
    with pytest.raises(ValueError):console.transition({**p,'version':2,'requestId':'verify'},'reviewer')
    complete=console.transition({**p,'version':2,'requestId':'verify','notes':'Readings checked'},'reviewer')
    assert complete['status']=='completed' and complete['evidence']=='Reading sheet 42'
    assert console.tasks({})['total']==0
    assert console.tasks({'status':'completed'})['total']==1
    with pytest.raises(ValueError):console.create_task(spec(mode='automatic'),'operator')


def test_overdue_survives_schema_restart_and_feed(database):
    task=console.create_task(spec(due_at='2020-01-01T12:00:00Z'),'operator')
    with store._session() as db:console.init_schema(db)
    assert console.feed()['tasks'][0]['id']==task['id']
    assert console.feed()['tasks'][0]['overdue'] is True


def test_all_categories_and_manual_source_integrity(database):
    for c,s in [('communications','Telephone'),('events','Planned'),('feed','Weather')]:
        console.create_record({'category':c,'subtype':s,'title':c,'requestId':c},'operator')
        result=console.records({'category':c})
        assert result['total']==1 and result['items'][0]['consoleCategory']==c
        assert result['items'][0]['source']=='console' and result['items'][0]['payload']['manual']
    with store._session() as db:
        events.append_event(db,event_type='alarm.active',occurred_at='2026-01-01T00:00:00Z',actor_id='system',aggregate_type='price_alert',aggregate_id='1',source='market',summary='Actual alarm')
    assert console.records({'category':'alarms','subtype':'App alarms'})['total']==1
    with pytest.raises(ValueError):console.create_record({'category':'alarms','subtype':'SCADA','title':'Fake','requestId':'fake'},'operator')
    assert console.records({'category':'all'})['total']==4


def test_explicit_links_and_task_conversion(database):
    first=console.create_record({'category':'events','subtype':'Outages','title':'Unit outage','requestId':'one'},'operator')
    second=console.create_record({'category':'communications','subtype':'Telephone','title':'Call received','requestId':'two'},'operator')
    console.link({'left':first['eventId'],'right':second['eventId']},'operator')
    console.link({'left':second['eventId'],'right':first['eventId']},'operator')
    assert len(console.linked(first['eventId'])['items'])==1
    task=console.create_task(spec(source_event_id=first['eventId']),'operator')
    assert console.linked(first['eventId'])['tasks'][0]['id']==task['id']
    assert console.records({'category':'tasks'})['total']==1


def test_recurring_dst_and_restart_uniqueness(database):
    template=console.create_template(spec(kind='daily',localTime='02:30',startsOn='2026-03-07',timezone='America/Toronto'),'operator')
    instant=datetime(2026,3,9,12,tzinfo=timezone.utc)
    console.tick(instant);console.tick(instant)
    rows=console.tasks({'status':'all'})['items']
    assert len(rows)==3 and all(t['subtype']=='Recurring' for t in rows)
    assert len({t['occurrence_key'] for t in rows})==3
    assert console.local_due(date(2026,3,8),'02:30','America/Toronto').isoformat()=='2026-03-08T07:00:00+00:00'
    assert console.local_due(date(2026,11,1),'01:30','America/Toronto').isoformat()=='2026-11-01T05:30:00+00:00'
    console.set_template({'id':template['id'],'enabled':False},'operator')
    console.tick(datetime(2026,3,10,12,tzinfo=timezone.utc))
    assert console.tasks({'status':'all'})['total']==3


def test_triggered_exact_source_type_and_idempotency(database):
    console.create_template(spec(kind='triggered',eventSource='scada',eventType='scada.trip'),'operator')
    with store._session() as db:
        for source,event in [('market','scada.trip'),('scada','scada.import'),('scada','scada.trip')]:
            events.append_event(db,event_type=event,occurred_at='2026-01-01T00:00:00Z',actor_id='system',aggregate_type='scada',aggregate_id=source+event,source=source,summary='Recorded input')
    console.tick();console.tick()
    tasks=console.tasks({})
    assert tasks['total']==1 and tasks['items'][0]['subtype']=='Triggered'
    assert tasks['items'][0]['source_event_id']
    with pytest.raises(ValueError):console.create_template(spec(kind='triggered',eventSource='console',eventType='tasks.created'),'operator')


def test_category_pagination_filters_before_limit(database):
    for i in range(65):console.create_record({'category':'feed','subtype':'News','title':str(i),'requestId':str(i)},'operator')
    console.create_record({'category':'events','subtype':'Planned','title':'Other','requestId':'other'},'operator')
    result=console.records({'category':'feed','limit':'50'});seen={e['eventId'] for e in result['items']}
    nextpage=console.records({'category':'feed','limit':'50','cursor':result['nextCursor']})
    assert not seen.intersection(e['eventId'] for e in nextpage['items'])
    assert result['total']==nextpage['total']==65
    with pytest.raises(ValueError):console.records({'category':'events','cursor':result['nextCursor']})

@pytest.fixture
def service(database,monkeypatch):
    import ieso_backend as backend
    monkeypatch.setattr(backend,'OPERATOR_GATE','access');monkeypatch.setattr(backend,'OPERATOR_HOST','ops.example.test');monkeypatch.setattr(backend,'CHECKIN_ORIGIN','https://checkin.example.test')
    server=backend.NorthstarHTTPServer(('127.0.0.1',0),backend.Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    def call(path,payload=None,auth=False,public=False,origin=None):
        headers={'Host':'checkin.example.test' if public else 'ops.example.test'}
        if auth:headers.update({'Cf-Access-Jwt-Assertion':'test','Cf-Access-Authenticated-User-Email':'operator@example.test'})
        if origin:headers['Origin']=origin
        data=None
        if payload is not None:data=json.dumps(payload).encode();headers['Content-Type']='application/json'
        try:response=urlopen(Request(f'http://127.0.0.1:{server.server_port}'+path,data=data,headers=headers),timeout=5)
        except HTTPError as e:response=e
        return response.status,json.loads(response.read())
    yield call
    server.shutdown();server.server_close();thread.join()


def test_routes_public_host_gate_and_server_actor(service):
    for route in ['records','tasks','templates','links','feed','catalog']:
        assert service('/api/console/'+route)[0]==403
        assert service('/api/console/'+route,auth=True,public=True)[0]==403
    for route in ['records','tasks','transition','templates','template-state','links']:
        assert service('/api/console/'+route,payload={},auth=True,public=True)[0]==403
    assert service('/api/console/tasks',payload=spec(),auth=True,origin='https://evil.example.test')[0]==403
    code,task=service('/api/console/tasks',payload=spec(actor='forged'),auth=True)
    assert code==200
    record=service('/api/console/records?category=tasks',auth=True)[1]['items'][0]
    assert record['actorId']=='operator@example.test'
    assert service('/api/console/transition',payload={'id':task['id'],'version':999,'status':'completed','requestId':'wrong'},auth=True)[0]==409
    assert service('/api/console/tasks',auth=True)[1]['total']==1


def test_link_visible_in_existing_event_report(database):
    first=console.create_record({'category':'events','subtype':'Planned','title':'Work','requestId':'first'},'operator')
    second=console.create_record({'category':'feed','subtype':'Weather','title':'Weather note','requestId':'second'},'operator')
    console.link({'left':first['eventId'],'right':second['eventId']},'operator')
    assert second['eventId'] in {r['eventId'] for r in register.detail(first['eventId'],{'section':'related'})['history']['items']}


def test_concurrent_retry_creates_one_task(database):
    result=[];failures=[]
    def create():
        try: result.append(console.create_task(spec(),'operator')['id'])
        except Exception as e: failures.append(e)
    threads=[threading.Thread(target=create) for _ in range(4)]
    for t in threads:t.start()
    for t in threads:t.join()
    assert not failures and len(set(result))==1
    assert console.records({'category':'tasks'})['total']==1
