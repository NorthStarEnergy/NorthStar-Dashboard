import json
import sqlite3
import threading
from urllib.request import Request, urlopen
from urllib.error import HTTPError

import pytest

import northstar_events as events
import northstar_event_register as register
import northstar_store as store


@pytest.fixture
def database(tmp_path,monkeypatch):
    monkeypatch.setattr(store,'DB_PATH',tmp_path/'register.db')
    with store._session() as connection:
        connection.executescript(store.SCHEMA)
    return tmp_path


def add(index, *, kind='price_alert', aggregate='alarm-1', source='market', severity='info', at='2026-09-11T10:00:00Z', payload=None, correlation=None):
    with store._session() as connection:
        return events.append_event(connection,event_id='fixture-'+str(index),event_type=source+'.transition',occurred_at=at,
            actor_id='test operator',aggregate_type=kind,aggregate_id=aggregate,source=source,severity=severity,
            summary='Test '+str(index),payload=payload or {},correlation_id=correlation)


def test_snapshot_pagination_beyond_250_with_identical_times(database):
    for i in range(270): add(i)
    first=register.register({'limit':['50']});seen=[i['eventId'] for i in first['items']]
    add('new',at='2026-09-11T11:00:00Z')
    add('late',at='2026-09-11T09:00:00Z')
    cursor=first['nextCursor']
    while cursor:
        page=register.register({'limit':['50'],'cursor':[cursor]})
        assert page['total']==270
        seen.extend(i['eventId'] for i in page['items']);cursor=page['nextCursor']
    assert len(seen)==len(set(seen))==270
    assert 'fixture-new' not in seen and 'fixture-late' not in seen


def test_recurrence_counts_same_type_state_and_object_only(database):
    add('old',at='2026-09-10T10:00:00Z',payload={'newState':'open'})
    add('current',payload={'newState':'open'})
    add('closed',payload={'newState':'closed'})
    add('other-object',aggregate='alarm-2',payload={'newState':'open'})
    register.add_note('fixture-current','Context','operator','one')
    result=register.detail('fixture-current',{'section':'occurrences'})
    assert result['recurrence']['total']==2
    assert result['recurrence']['prior']==1
    assert result['recurrence']['firstOccurredAt'].startswith('2026-09-10')
    assert {e['eventId'] for e in result['history']['items']}=={'fixture-old','fixture-current'}


def test_related_uses_recorded_links_not_titles_or_cross_provider_threads(database):
    add('selected',correlation='thread')
    add('linked',aggregate='another',correlation='thread')
    add('unrelated',aggregate='another',source='teams',correlation='thread')
    note=register.add_note('fixture-selected','Context','operator','one')
    result=register.detail('fixture-selected',{'section':'related','limit':'1'})
    seen=[e['eventId'] for e in result['history']['items']]
    while result['history']['nextCursor']:
        result=register.detail('fixture-selected',{'section':'related','limit':'1','cursor':result['history']['nextCursor']})
        seen.extend(e['eventId'] for e in result['history']['items'])
    assert set(seen)=={'fixture-linked',note['eventId']}
    with pytest.raises(ValueError):register.detail('fixture-selected',{'section':'invalid'})


def test_filters_apply_before_paging_and_recoveries_remain_alarms(database):
    add('old',payload={'site':'North','newState':'resolved'},at='2020-01-01T00:00:00Z')
    for i in range(260):add(i,source='logbook',kind='logbook_entry',aggregate=str(i))
    result=register.register({'type':['alarm'],'status':['resolved'],'site':['North']})
    assert result['total']==1 and result['items'][0]['eventId']=='fixture-old'
    assert register.register({'source':['logbook','market']})['total']==261


def test_timezones_sort_by_instant_and_cursor_is_filter_specific(database):
    add(1,at='2026-09-11T08:00:00-04:00');add(2,at='2026-09-11T11:00:00Z')
    result=register.register({'limit':['1']})
    assert result['items'][0]['eventId']=='fixture-1'
    with pytest.raises(ValueError):register.register({'cursor':[result['nextCursor']],'source':['voice']})
    with pytest.raises(ValueError):register.register({'cursor':['malformed']})
    with pytest.raises(ValueError):register.register({'from':['2026-09-11T10:00:00']})


def test_detail_links_object_identity_not_title_or_request_correlation(database):
    add(1,aggregate='alarm-A',correlation='request-one');add(2,aggregate='alarm-A',correlation='request-two')
    add(3,aggregate='alarm-B',correlation='request-one')
    result=register.detail('fixture-1',{})
    assert {r['eventId'] for r in result['history']['items']}=={'fixture-1','fixture-2'}
    with pytest.raises(LookupError):register.detail('missing',{})


def test_communication_replies_link_only_same_source_thread(database):
    add(1,kind='communication',source='teams',aggregate='message-A',correlation='thread')
    add(2,kind='communication',source='teams',aggregate='message-B',correlation='thread')
    add(3,kind='communication',source='outlook',aggregate='message-C',correlation='thread')
    assert register.detail('fixture-1',{})['history']['total']==2


def test_system_history_respects_filters_and_cursor(database):
    add('system',kind='system',aggregate='system',source='system')
    register.add_note('fixture-system','First','operator','one')
    register.add_note('fixture-system','Second','operator','two')
    first=register.detail('fixture-system',{'limit':['1']})['history']
    second=register.detail('fixture-system',{'limit':['1'],'cursor':[first['nextCursor']]})['history']
    assert first['items'][0]['eventId']!=second['items'][0]['eventId']
    assert register.detail('fixture-system',{'source':['market']})['history']['total']==0


def test_notes_are_append_only_idempotent_and_do_not_change_alarm_state(database):
    add(1,payload={'newState':'open'})
    first=register.add_note('fixture-1','Checked source','operator','retry-1')
    second=register.add_note('fixture-1','Checked source','operator','retry-1')
    assert first['eventId']==second['eventId'] and second['duplicate']
    with pytest.raises(ValueError):register.add_note('fixture-1','Different note','operator','retry-1')
    detail=register.detail('fixture-1',{})
    assert detail['event']['status']=='open' and detail['history']['total']==2
    note=detail['history']['items'][0]
    assert note['category']=='alarm' and note['status']=='' and note['actorId']=='operator'


def test_chat_failure_and_answer_are_durable_linked_records(database):
    conversation,question=register.record_chat('What happened?','operator')
    register.record_chat('Unavailable','system',conversation,outcome='failed',causation_id=question)
    history=register.detail(question,{})['history']
    assert history['total']==2 and all(row['category']=='chat' for row in history['items'])
    assert history['items'][0]['causationId']==question
    assert next(s for s in register.sources()['sources'] if s['id']=='teams')['state']=='Setup pending'


@pytest.fixture
def service(database,monkeypatch):
    import ieso_backend as backend
    monkeypatch.setattr(backend,'OPERATOR_GATE','access')
    monkeypatch.setattr(backend,'OPERATOR_HOST','ops.northstarenergy.ca')
    monkeypatch.setattr(backend,'CHECKIN_ORIGIN','https://checkin.northstarenergy.ca')
    server=backend.NorthstarHTTPServer(('127.0.0.1',0),backend.Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    def call(path, *, public=False, authorized=False, payload=None):
        headers={'Host':'checkin.northstarenergy.ca' if public else 'ops.northstarenergy.ca'}
        if authorized:headers.update({'Cf-Access-Jwt-Assertion':'fixture','Cf-Access-Authenticated-User-Email':'operator@example.test'})
        data=None if payload is None else json.dumps(payload).encode()
        if data:headers['Content-Type']='application/json'
        try:response=urlopen(Request(f'http://127.0.0.1:{server.server_port}'+path,data=data,headers=headers),timeout=5)
        except HTTPError as error:response=error
        return response.status,json.loads(response.read())
    yield call
    server.shutdown();server.server_close();thread.join()


def test_new_routes_remain_operator_only_even_with_forged_public_header(service):
    for path in ['/api/client-release','/api/events/register','/api/events/detail?id=x','/api/events/sources']:
        assert service(path)[0]==403
        assert service(path,public=True,authorized=True)[0]==403
    assert service('/api/events/notes',public=True,authorized=True,payload={})[0]==403


def test_client_release_endpoint_records_one_operator_visible_update(service):
    code,first=service('/api/client-release',authorized=True)
    assert code==200 and first['recorded'] is True
    assert first['dashboard']['version'].startswith('v')
    code,second=service('/api/client-release',authorized=True)
    assert code==200 and second['recorded'] is False
    assert second['releaseId']==first['releaseId']
    events=service('/api/events?aggregateType=system',authorized=True)[1]
    assert events[0]['eventType']=='system.client_update.applied'


def test_register_and_notes_roundtrip_with_server_actor(service):
    add(1)
    listed=service('/api/events/register',authorized=True)[1]
    assert listed['total']==1
    assert listed['items'][0]['href']=='event-detail.html?id=fixture-1'
    code,result=service('/api/events/notes',authorized=True,payload={'eventId':'fixture-1','text':'Read back','actor':'forged','requestId':'note-1'})
    assert code==201
    assert result['href'].startswith('event-detail.html?id=')
    detail=service('/api/events/detail?id=fixture-1',authorized=True)[1]
    assert detail['history']['items'][0]['actorId']=='operator@example.test'
    assert service('/api/events/register?cursor=broken',authorized=True)[0]==400
    assert service('/api/events/detail?id=missing',authorized=True)[0]==404


def test_outage_events_are_register_outages_with_report_hrefs(database):
    outage=store.create_outage({"title":"Unit offline","site":"Kenora","asset":"U1"},actor="operator")
    result=register.register({"type":["outage"],"site":["Kenora"]})
    assert result["total"]==1
    assert result["items"][0]["category"]=="outage"
    assert result["items"][0]["href"]==outage["href"]
    assert outage["href"].startswith("event-detail.html?id=")
    assert outage["siteId"]=="site:kenora"


def test_ai_attempt_records_linked_question_and_outcome(service,monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY','')
    code,_=service('/api/ai',authorized=True,payload={'message':'Test question'})
    assert code in {200, 503}
    result=register.register({'type':['chat']})
    assert result['total']==2
    assert result['items'][1]['payload']['status']=='question'
    assert result['items'][0]['payload']['status'] in {'answer','failed'}
    assert len({r['aggregateId'] for r in result['items']})==1
