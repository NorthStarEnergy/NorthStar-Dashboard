import base64
import json
from concurrent.futures import ThreadPoolExecutor

import pytest

import northstar_console as console
import northstar_events as events
import northstar_store as store


@pytest.fixture(autouse=True)
def database(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DB_PATH', tmp_path / 'console.db')
    monkeypatch.delenv('NORTHSTAR_CONSOLE_SITE_SCOPES', raising=False)
    with store._session() as db:
        db.executescript(store.SCHEMA)


def call(resource, data=None, who=None, params=None):
    return console.request('GET' if data is None else 'POST', '/api/console/' + resource,
                           params or {}, data or {}, who or console.identity('operator-one'))


def task(**changes):
    return call('tasks', dict(title='Check report', stationId='site:A', **changes))


def event(id, *, source='trusted', kind='report.received', station='site:A', aggregate='report', severity='info', at=None, payload=None):
    with store._session() as db:
        return events.append_event(db, event_id=id, event_type=kind, source=source,
            actor_id='adapter', aggregate_type=aggregate, aggregate_id=id,
            summary='Report ' + id, occurred_at=at or console.now(), severity=severity,
            payload=payload or {'stationId': station})


def test_manual_lifecycle_reload_and_retry():
    t = task(requestId='one')
    assert task(requestId='one')['id'] == t['id']
    edited = call('tasks/' + t['id'] + '/edit', {'version': 1, 'description': 'Updated evidence', 'dueAt': '2026-11-01T09:00:00-05:00'})
    assert edited['version'] == 2
    with pytest.raises(console.Conflict):
        call('tasks/' + t['id'] + '/complete', {'version': 1})
    done = call('tasks/' + t['id'] + '/complete', {'version': 2, 'notes': 'Checked'})
    assert done['status'] == 'completed'
    assert call('tasks/' + t['id'] + '/complete', {'version': 2}) == done
    detail = call('tasks/' + t['id'])
    assert len(detail['audit']) == 3
    assert detail['audit'][1]['payload']['task']['description'] == 'Updated evidence'
    assert call('tasks')['items'] == []
    assert len(call('tasks', params={'status': 'history'})['items']) == 1


def test_concurrent_versioned_edits_have_one_winner():
    t = task()
    def edit(title):
        try:
            call('tasks/' + t['id'] + '/edit', {'version': 1, 'title': title})
            return 'saved'
        except console.Conflict:
            return 'conflict'
    with ThreadPoolExecutor(2) as pool:
        assert sorted(pool.map(edit, ['A', 'B'])) == ['conflict', 'saved']


def test_roles_and_station_scopes_cover_reads_writes_and_sources(monkeypatch):
    t = task()
    event('source')
    monkeypatch.setenv('NORTHSTAR_CONSOLE_SITE_SCOPES', json.dumps({'limited': ['site:B']}))
    who = console.identity('limited')
    assert call('tasks', who=who)['items'] == []
    assert call('records', who=who)['items'] == []
    assert call('feed', who=who)['tasks'] == []
    for resource in ('tasks/' + t['id'], 'records/source'):
        with pytest.raises(PermissionError):
            call(resource, who=who)
    with pytest.raises(PermissionError):
        call('tasks', {'title': 'x', 'stationId': 'site:B', 'sourceEventId': 'source'}, who)
    with pytest.raises(PermissionError):
        console.identity('x', 'site_viewer')
    with pytest.raises(PermissionError):
        call('tasks', {'title': 'x'}, console.identity('demo', 'platform_demo'))
    assert console.identity('unknown')['sites'] == []


def test_manual_records_cannot_impersonate_alarms_and_conversion_is_idempotent():
    with pytest.raises(ValueError):
        call('records', {'kind': 'alarm', 'summary': 'Fake', 'requestId': 'fake'})
    r = call('records', {'kind': 'log', 'summary': 'Operator observation', 'stationId': 'site:A', 'requestId': 'log1', 'actor': 'forged'})
    detail = call('records/' + r['eventId'])['record']
    assert detail['actorId'] == 'operator-one' and detail['kind'] == 'log'
    one = task(sourceEventId=r['eventId'])
    assert task(sourceEventId=r['eventId'])['id'] == one['id']
    assert len(call('tasks')['items']) == 1


def test_snapshot_pagination_and_stationid_source_conversion():
    for i in range(120):
        event('e%03d' % i, at='2026-10-10T00:00:00Z')
    page = call('records', params={'limit': '17'})
    ids = [i['id'] for i in page['items']]
    event('late', at='2026-10-09T00:00:00Z')
    while page['nextCursor']:
        page = call('records', params={'limit': '17', 'cursor': page['nextCursor']})
        ids.extend(i['id'] for i in page['items'])
    assert len(ids) == len(set(ids)) == 120
    assert task(sourceEventId='e001')['stationId'] == 'site:A'


@pytest.mark.parametrize('value', ['garbage', 'e30=', base64.urlsafe_b64encode(json.dumps({'filter':'x','time':[],'id':'x'}).encode()).decode()])
def test_invalid_cursors(value):
    with pytest.raises(ValueError):
        call('records', params={'cursor': value})


def test_feed_keeps_old_open_work_and_prioritizes_significant_recent_records():
    t = task(dueAt='2020-01-01T00:00:00Z', priority='critical')
    event('old-alarm', aggregate='price_alert', source='market', at='2020-01-01T00:00:00Z', payload={'siteId':'site:A','newState':'active'})
    event('important', aggregate='communication')
    for i in range(40):
        event('noise' + str(i))
    feed = call('feed')
    assert feed['tasks'][0]['id'] == t['id']
    assert feed['alarms'][0]['id'] == 'old-alarm'
    assert [r['id'] for r in feed['recent']] == ['important']


def test_trusted_evidence_requires_exact_task_station_and_rule():
    t = task(completionMode='verified', completionRule={'source':'trusted','eventType':'report.received'})
    event('proof')
    with store._session() as db:
        at = console.source_event(db, 'proof', console.identity('operator-one'))[0]['occurredAt']
    args = dict(source='trusted', source_event_id='proof', source_version='1', event_type='report.received', occurred_at=at, station_id='site:A')
    assert console.ingest_evidence(t['id'], **args)
    assert not console.ingest_evidence(t['id'], **args)
    pending = call('tasks/' + t['id'])['task']
    assert pending['status'] == 'pending_verification'
    with pytest.raises(ValueError):
        call('tasks/' + t['id'] + '/complete', {'version':pending['version']})
    done = call('tasks/' + t['id'] + '/verify', {'version':pending['version'], 'accept':True, 'notes':'Evidence checked'})
    assert done['status'] == 'completed'


def test_daily_restart_catchup_dst_and_future_start_edit():
    schedule = call('task-templates', {'title':'Daily report','stationId':'site:A','startsOn':'2026-03-07','localTime':'02:30','timezone':'America/Toronto'})
    console.tick('2026-03-08T12:00:00Z')
    first = call('tasks')['items']
    assert len(first) == 3
    console.tick('2026-03-08T12:00:00Z')
    assert len(call('tasks')['items']) == 3
    assert console.scheduled_due('2026-03-08','02:30','America/Toronto') == '2026-03-08T07:30:00+00:00'
    assert console.scheduled_due('2026-11-01','01:30','America/Toronto') == '2026-11-01T05:30:00+00:00'
    call('task-templates/' + schedule['id'], {'version':1,'startsOn':'2026-04-01'})
    console.tick('2026-03-15T12:00:00Z')
    assert len(call('tasks')['items']) == 3


def test_event_rule_adapter_and_alarm_acknowledgement_are_distinct_from_clear():
    event('incoming')
    rule = {'source':'trusted','eventType':'report.received','stationId':'site:A','title':'Review incoming report'}
    t = console.apply_event_rule('incoming', rule)
    assert console.apply_event_rule('incoming', rule)['id'] == t['id']
    store.set_alert_setting({'node':'APIROQ','low':10,'high':100,'enabled':True,'actions':['in-app']})
    alert = store.evaluate_price_alerts({'APIROQ':140})['raised'][0]
    record = call('records', params={'kind':'alarm'})['items'][0]
    assert call('records/' + record['id'])['record']['canAcknowledge']
    ack = call('records/' + record['id'] + '/acknowledge', {'actor':'forged'})
    assert ack['state'] == store.ALERT_ACKNOWLEDGED
    assert ack['acknowledgedBy'] == 'operator-one'
    assert call('feed')['alarms']
    store.evaluate_price_alerts({'APIROQ':50})
    assert call('feed')['alarms'] == []


def test_http_gate_blocks_unauthenticated_and_public_host(monkeypatch):
    import threading
    from urllib.request import Request, urlopen
    from urllib.error import HTTPError
    import ieso_backend as backend
    monkeypatch.setattr(backend, 'OPERATOR_GATE', 'access')
    monkeypatch.setattr(backend, 'CHECKIN_ORIGIN', 'https://checkin.northstarenergy.ca')
    server = backend.NorthstarHTTPServer(('127.0.0.1', 0), backend.Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    try:
        for method in ('GET','POST','PATCH'):
            for host, forged in [('ops.northstarenergy.ca', False),('checkin.northstarenergy.ca', True)]:
                headers = {'Host':host, 'Content-Type':'application/json'}
                if forged: headers['Cf-Access-Jwt-Assertion'] = 'forged'
                request = Request(f'http://127.0.0.1:{server.server_port}/api/console/tasks', method=method, headers=headers, data=None if method=='GET' else b'{}')
                with pytest.raises(HTTPError) as error:
                    urlopen(request, timeout=5)
                assert error.value.code == 403
    finally:
        server.shutdown(); server.server_close(); thread.join()
