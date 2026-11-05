"""Operations Console: additive SQLite workflows and audit-ledger projections.

Trusted adapters call ingest_evidence in-process; browser callers cannot submit
trusted evidence or alarm states. All public queries receive a server identity.
"""
from __future__ import annotations
import northstar_services as services

import base64
import hashlib
import json
import math
import os
import re
import threading
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import northstar_store as store
import northstar_events as events
import northstar_event_register as register
import northstar_sites as sites

OPEN = ('open', 'in_progress', 'pending_verification')
FINAL = ('completed', 'cancelled', 'superseded')
PRIORITIES = ('info', 'low', 'medium', 'high', 'critical')
MODES = ('manual', 'automatic', 'verified')
SCHEMA = (
    'CREATE TABLE IF NOT EXISTS console_tasks (id TEXT PRIMARY KEY, station TEXT NOT NULL, status TEXT NOT NULL, due TEXT, updated TEXT NOT NULL, version INTEGER NOT NULL, request_key TEXT UNIQUE, template_id TEXT, occurrence_key TEXT, data TEXT NOT NULL, UNIQUE(template_id,occurrence_key))',
    'CREATE INDEX IF NOT EXISTS console_task_queue ON console_tasks(status,due,id)',
    'CREATE INDEX IF NOT EXISTS console_task_station ON console_tasks(station,status)',
    'CREATE TABLE IF NOT EXISTS console_templates (id TEXT PRIMARY KEY, station TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS console_imports (source TEXT NOT NULL, source_id TEXT NOT NULL, version TEXT NOT NULL, task_id TEXT NOT NULL, PRIMARY KEY(source,source_id,version,task_id))',
    'CREATE TABLE IF NOT EXISTS console_requests (actor TEXT NOT NULL, request_key TEXT NOT NULL, event_id TEXT NOT NULL, PRIMARY KEY(actor,request_key))',
)


class Conflict(ValueError):
    pass


def now():
    return datetime.now(timezone.utc).isoformat()


def station_id(value):
    value = str(value or '')
    found = sites.resolve(value)
    return found['id'] if found else value


def stamp(value):
    try:
        result = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if result.tzinfo is None:
            raise ValueError()
        return result.astimezone(timezone.utc).isoformat()
    except (ValueError, TypeError):
        raise ValueError('A valid timestamp with timezone is required') from None


def text(value, name, limit=2000, required=False):
    if not isinstance(value, str) or len(value.strip()) > limit or (required and not value.strip()):
        raise ValueError(f'Invalid {name} (maximum {limit} characters)')
    return value.strip()


def identity(actor, role='operator'):
    # Existing operator role is all-site. Optional deployment policy narrows it;
    # when configured, missing actors get no sites rather than an implicit wildcard.
    if role not in ('operator', 'platform_demo'):
        raise PermissionError('Console role not authorized')
    raw = os.environ.get('NORTHSTAR_CONSOLE_SITE_SCOPES', '').strip()
    scope = None
    if raw:
        try:
            policy = json.loads(raw)
            scope = policy.get(actor.casefold(), [])
            if not isinstance(scope, list) or any(not isinstance(x, str) for x in scope):
                raise ValueError()
            scope = [station_id(x) for x in scope]
        except (ValueError, AttributeError):
            raise PermissionError('Invalid console site policy') from None
    return {'actor': actor, 'write': role == 'operator', 'sites': scope}


def authorize(who, station, write=False):
    if write and not who['write']:
        raise PermissionError('Console is read-only for this role')
    if who['sites'] is not None and station not in who['sites']:
        raise PermissionError('Station access denied')


def init(connection):
    connection.create_function('console_station', 1, station_id, deterministic=True)
    for sql in SCHEMA:
        connection.execute(sql)


def begin(connection):
    init(connection)
    connection.execute('BEGIN IMMEDIATE')


def task_row(connection, task_id, who, write=False):
    row = connection.execute('SELECT data FROM console_tasks WHERE id=?', (task_id,)).fetchone()
    if row is None:
        raise LookupError('Task not found')
    task = json.loads(row['data'])
    authorize(who, task['stationId'], write)
    return task


def save_task(connection, task):
    connection.execute('UPDATE console_tasks SET status=?,due=?,updated=?,version=?,data=? WHERE id=?',
                       (task['status'], task['dueAt'], task['updatedAt'], task['version'], json.dumps(task), task['id']))


def audit(connection, task, actor, action, previous=None, notes='', evidence=None):
    events.append_event(connection, event_type='console.task.' + action, occurred_at=now(), actor_id=actor,
                        aggregate_type='console_task', aggregate_id=task['id'], source='operations-console',
                        summary=task['title'] + ' — ' + action.replace('_', ' '), severity=task['priority'],
                        payload={'siteId': task['stationId'], 'site': task['stationId'], 'taskId': task['id'],
                                 'previousStatus': previous, 'newStatus': task['status'], 'notes': notes,
                                 'evidence': evidence, 'version': task['version'], 'task': task})


def validate_task(data):
    result = {}
    for key, maximum, required in [('title', 240, True), ('description', 8000, False), ('stationId', 120, False),
                                    ('category', 80, False), ('assigneeUserId', 160, False), ('assigneeRoleId', 80, False)]:
        result[key] = text(data.get(key, ''), key, maximum, required)
    result['priority'] = data.get('priority', 'medium')
    result['completionMode'] = data.get('completionMode', 'manual')
    if result['priority'] not in PRIORITIES or result['completionMode'] not in MODES:
        raise ValueError('Invalid priority or completion mode')
    if result['assigneeRoleId'] not in ('', 'operator'):
        raise ValueError('Only the existing operator role can be assigned')
    result['dueAt'] = stamp(data['dueAt']) if data.get('dueAt') else None
    result['stationId'] = station_id(result['stationId'])
    # No fabricated shift assignment. An optional named assignee is a label;
    # permissions always come from the live authenticated role/site policy.
    result['completionRule'] = data.get('completionRule')
    if result['completionMode'] != 'manual':
        rule = result['completionRule']
        if not isinstance(rule, dict) or set(rule) != {'source', 'eventType'}:
            raise ValueError('Automatic/verified tasks require source and exact eventType rule')
        result['completionRule'] = {k: text(v, k, 120, True) for k, v in rule.items()}
    else:
        result['completionRule'] = None
    return result


def source_event(connection, event_id, who):
    row = connection.execute('SELECT * FROM audit_events WHERE event_id=?', (event_id,)).fetchone()
    if row is None:
        raise LookupError('Source event not found')
    item = events.record(row)
    payload = item.get('payload') if isinstance(item.get('payload'), dict) else {}
    station = station_id(payload.get('siteId') or payload.get('stationId') or payload.get('site') or payload.get('siteCode') or '')
    authorize(who, station)
    return item, station


def create_task(connection, data, who, template_id=None, occurrence_key=None):
    task = validate_task(data)
    authorize(who, task['stationId'], True)
    key = text(data.get('requestId', ''), 'request ID', 160)
    source_id = text(data.get('sourceEventId', ''), 'source event', 160)
    if source_id:
        source, station = source_event(connection, source_id, who)
        if task['stationId'] != station:
            raise ValueError('Task station must match the source event')
        task.update(sourceType=source['source'], sourceId=source_id)
        key = 'source:' + source_id
    else:
        task.update(sourceType='schedule' if template_id else 'manual', sourceId=template_id or '')
        if key:
            key = who['actor'] + ':' + key
    if key:
        row = connection.execute('SELECT data FROM console_tasks WHERE request_key=?', (key,)).fetchone()
        if row:
            existing = json.loads(row['data']); authorize(who, existing['stationId'])
            return existing
    task.update(id='task_' + uuid.uuid4().hex, status='open', createdBy=who['actor'], createdAt=now(), updatedAt=now(),
                completedAt=None, completedBy=None, evidenceRef=None, recurrenceTemplateId=template_id,
                occurrenceKey=occurrence_key, version=1)
    connection.execute('INSERT INTO console_tasks VALUES (?,?,?,?,?,?,?,?,?,?)',
                       (task['id'], task['stationId'], task['status'], task['dueAt'], task['updatedAt'], 1,
                        key or None, template_id, occurrence_key, json.dumps(task)))
    audit(connection, task, who['actor'], 'created')
    return task


def change_task(connection, task_id, action, data, who):
    task = task_row(connection, task_id, who, True)
    notes = text(data.get('notes', ''), 'notes', 8000)
    if action == 'complete' and task['status'] == 'completed':
        return task  # A retry must not append another completion event.
    if type(data.get('version')) is not int or data['version'] != task['version']:
        raise Conflict('Task changed in another session; reload before retrying')
    previous = task['status']
    if previous in FINAL:
        raise Conflict('This task is closed')
    if action == 'edit':
        changes = {key: data[key] for key in ('title', 'description', 'category', 'priority', 'assigneeUserId', 'assigneeRoleId', 'dueAt') if key in data}
        task.update(validate_task({**task, **changes}))
    elif action == 'start':
        if previous != 'open':
            raise Conflict('Only open tasks can be started')
        task['status'] = 'in_progress'
    elif action == 'complete':
        if task['completionMode'] != 'manual':
            raise ValueError('This task requires trusted source evidence')
        task['status'] = 'completed'
    elif action == 'verify':
        if previous != 'pending_verification' or task['completionMode'] != 'verified':
            raise Conflict('No evidence awaiting verification')
        if not isinstance(data.get('accept'), bool) or not notes:
            raise ValueError('Verification decision and notes required')
        task['status'] = 'completed' if data['accept'] else 'in_progress'
    elif action in ('cancel', 'supersede'):
        if not notes:
            raise ValueError('A reason is required')
        task['status'] = 'cancelled' if action == 'cancel' else 'superseded'
    else:
        raise ValueError('Unknown task action')
    task.update(updatedAt=now(), version=task['version'] + 1)
    if task['status'] == 'completed':
        task.update(completedAt=now(), completedBy=who['actor'])
    save_task(connection, task)
    audit(connection, task, who['actor'], action, previous, notes, task['evidenceRef'])
    return task


def scheduled_due(day, local_time, zone):
    """DST: first occurrence at a fold; move a nonexistent time forward by gap."""
    local = datetime.fromisoformat(day + 'T' + local_time).replace(tzinfo=ZoneInfo(zone), fold=0)
    return local.astimezone(timezone.utc).isoformat()


def template_write(connection, template_id, data, who):
    previous = None
    if template_id:
        row = connection.execute('SELECT data FROM console_templates WHERE id=?', (template_id,)).fetchone()
        if not row:
            raise LookupError('Schedule not found')
        previous = json.loads(row['data']); authorize(who, previous['stationId'], True)
        if type(data.get('version')) is not int or data['version'] != previous['version']:
            raise Conflict('Schedule changed; reload before retrying')
        data = {**previous, **data}
    template = validate_task(data)
    authorize(who, template['stationId'], True)
    if previous and template['stationId'] != previous['stationId']:
        raise ValueError('Create a new schedule to change station')
    local_time = str(data.get('localTime', ''))
    if not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', local_time):
        raise ValueError('Local time must be HH:MM')
    zone = str(data.get('timezone', 'America/Toronto'))
    try:
        ZoneInfo(zone)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError('Unknown schedule timezone') from None
    starts = str(data.get('startsOn') or datetime.now(ZoneInfo(zone)).date().isoformat())
    ends = data.get('endsOn') or None
    date.fromisoformat(starts)
    if ends and date.fromisoformat(ends) < date.fromisoformat(starts):
        raise ValueError('End date precedes start')
    if data.get('recurrenceRule', 'daily') != 'daily' or not isinstance(data.get('enabled', True), bool):
        raise ValueError('Only daily schedules are supported; enabled must be boolean')
    template.update(id=template_id or 'schedule_' + uuid.uuid4().hex, version=(previous['version'] + 1 if previous else 1),
                    localTime=local_time, timezone=zone, startsOn=starts, endsOn=ends, enabled=data.get('enabled', True),
                    recurrenceRule='daily', generatedThrough=previous.get('generatedThrough') if previous else None,
                    createdBy=previous['createdBy'] if previous else who['actor'])
    connection.execute('INSERT INTO console_templates VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,data=excluded.data',
                       (template['id'], template['stationId'], template['version'], json.dumps(template)))
    events.append_event(connection, event_type='console.schedule.updated' if previous else 'console.schedule.created',
                        occurred_at=now(), actor_id=who['actor'], aggregate_type='console_template', aggregate_id=template['id'],
                        source='operations-console', summary=template['title'] + ' — daily schedule', payload=template)
    return template


def tick(at=None):
    """Durable daily catch-up cursor, bounded work per tick, restart-safe keys."""
    current = datetime.fromisoformat(stamp(at or now()))
    with store._session() as connection:
        begin(connection)
        for row in connection.execute('SELECT data FROM console_templates').fetchall():
            template = json.loads(row['data'])
            if not template['enabled']:
                continue
            day = date.fromisoformat(template['generatedThrough']) + timedelta(days=1) if template['generatedThrough'] else date.fromisoformat(template['startsOn'])
            day = max(day, date.fromisoformat(template['startsOn']))
            last = current.astimezone(ZoneInfo(template['timezone'])).date() + timedelta(days=1)
            if template['endsOn']:
                last = min(last, date.fromisoformat(template['endsOn']))
            count = 0
            while day <= last and count < 366:
                due = scheduled_due(day.isoformat(), template['localTime'], template['timezone'])
                existing = connection.execute('SELECT 1 FROM console_tasks WHERE template_id=? AND occurrence_key=?', (template['id'], due)).fetchone()
                if not existing:
                    create_task(connection, {**template, 'dueAt': due}, {'actor': 'scheduler', 'write': True, 'sites': None}, template['id'], due)
                template['generatedThrough'] = day.isoformat()
                day += timedelta(days=1); count += 1
            connection.execute('UPDATE console_templates SET data=? WHERE id=?', (json.dumps(template), template['id']))


def ingest_evidence(task_id, *, source, source_event_id, source_version, event_type, occurred_at, station_id, occurrence_key=None):
    """Trusted adapter contract, deliberately NOT exposed over HTTP.

    Match exact task ID, station, rule and scheduled occurrence. The referenced
    real ledger event must match source/type/station and follow task creation.
    Duplicate deliveries are ignored; rejected verification needs fresh evidence.
    """
    with store._session() as connection:
        begin(connection)
        who = {'actor': source, 'write': True, 'sites': [station_id]}
        task = task_row(connection, task_id, who)
        event, station = source_event(connection, source_event_id, who)
        rule = task['completionRule']
        if not rule or task['completionMode'] == 'manual' or task['status'] in FINAL:
            return False
        if rule != {'source': source, 'eventType': event_type} or event['source'] != source or event['eventType'] != event_type:
            raise ValueError('Evidence does not match the task rule')
        if station != task['stationId'] or task['occurrenceKey'] != occurrence_key:
            raise ValueError('Evidence does not match station/occurrence')
        if stamp(occurred_at) != stamp(event['occurredAt']) or stamp(occurred_at) < task['createdAt']:
            raise ValueError('Evidence predates the task or timestamp differs')
        if connection.execute('SELECT 1 FROM console_imports WHERE source=? AND source_id=? AND task_id=?', (source, source_event_id, task_id)).fetchone():
            return False
        inserted = connection.execute('INSERT OR IGNORE INTO console_imports VALUES (?,?,?,?)', (source, source_event_id, str(source_version), task_id)).rowcount
        if not inserted:
            return False
        previous = task['status']
        task.update(status='completed' if task['completionMode'] == 'automatic' else 'pending_verification',
                    evidenceRef={'source': source, 'eventId': source_event_id, 'version': str(source_version)}, updatedAt=now(), version=task['version'] + 1)
        if task['status'] == 'completed':
            task.update(completedAt=now(), completedBy=source)
        save_task(connection, task); audit(connection, task, source, 'evidence', previous, evidence=task['evidenceRef'])
        return True


def apply_event_rule(source_event_id, rule):
    """Trusted adapter entry point for configured event-to-task rules.

    The adapter supplies the exact source, eventType and stationId plus task
    fields. An existing ledger event is required; repeat delivery returns the
    same task. No HTTP caller can install rules or pretend to be a source.
    """
    who = {'actor': 'event-rule', 'write': True, 'sites': [station_id(rule['stationId'])]}
    with store._session() as connection:
        begin(connection)
        item, station = source_event(connection, source_event_id, who)
        if item['source'] != rule['source'] or item['eventType'] != rule['eventType']:
            raise ValueError('Event does not match rule source/type')
        return create_task(connection, {**rule, 'stationId': station, 'sourceEventId': source_event_id}, who)


def scoped(who, column, station=''):
    clauses, values = [], []
    if who['sites'] is not None:
        clauses.append(column + ' IN (' + ','.join('?' for _ in who['sites']) + ')')
        values.extend(who['sites'])
    if station:
        authorize(who, station); clauses.append(column + '=?'); values.append(station)
    return clauses, values


def page_options(params):
    try:
        limit = max(1, min(100, int(params.get('limit', '50'))))
        if len(params.get('cursor', '')) > 2000:
            raise ValueError()
        cursor = json.loads(base64.urlsafe_b64decode(params['cursor']).decode()) if params.get('cursor') else None
        if cursor is not None:
            if not isinstance(cursor, dict) or not all(k in cursor for k in ('filter', 'time', 'id')):
                raise ValueError()
            if not isinstance(cursor['filter'], str) or not isinstance(cursor['id'], str):
                raise ValueError()
            if 'snapshot' in cursor:
                if type(cursor['snapshot']) is not int or cursor['snapshot'] < 0 or not math.isfinite(float(cursor['time'])):
                    raise ValueError()
            else:
                stamp(cursor['time'])
        return limit, cursor
    except (ValueError, TypeError, UnicodeError):
        raise ValueError('Invalid pagination') from None


def encode(data):
    return base64.urlsafe_b64encode(json.dumps(data).encode()).decode()


def task_list(connection, params, who, all_open=False):
    clauses, values = scoped(who, 'station', params.get('station', ''))
    status = params.get('status', 'open')
    if status != 'all':
        selected = OPEN if status == 'open' else FINAL if status == 'history' else (status,)
        if any(s not in OPEN + FINAL for s in selected):
            raise ValueError('Unknown task status')
        clauses.append('status IN (' + ','.join('?' for _ in selected) + ')'); values.extend(selected)
    limit, cursor = page_options(params)
    signature = hashlib.sha256(json.dumps([clauses, values]).encode()).hexdigest()
    if cursor:
        if cursor.get('filter') != signature:
            raise ValueError('Cursor does not match filters')
        clauses.append('(updated<? OR (updated=? AND id<?))'); values.extend([cursor['time'], cursor['time'], cursor['id']])
    rows = connection.execute('SELECT * FROM console_tasks WHERE ' + (' AND '.join(clauses) or '1') + ' ORDER BY updated DESC,id DESC' + ('' if all_open else ' LIMIT ?'), values if all_open else [*values, limit + 1]).fetchall()
    more = not all_open and len(rows) > limit
    if more:
        rows = rows[:limit]
    return {'items': [json.loads(r['data']) for r in rows], 'nextCursor': encode({'filter': signature, 'time': rows[-1]['updated'], 'id': rows[-1]['id']}) if more else None}


STATION = f"console_station(COALESCE(json_extract({register.PAYLOAD},'$.siteId'),json_extract({register.PAYLOAD},'$.stationId'),json_extract({register.PAYLOAD},'$.site'),json_extract({register.PAYLOAD},'$.siteCode'),''))"
KIND = f"CASE WHEN event_type LIKE 'console.task.%' THEN 'task_activity' WHEN event_type='console.log' OR ({register.CATEGORY})='log' THEN 'log' WHEN ({register.CATEGORY}) IN ('communication','chat','voice') THEN 'communication' WHEN aggregate_type='alarm' OR ({register.CATEGORY})='alarm' OR event_type LIKE 'scada.alarm%' THEN 'alarm' ELSE 'event' END"


def records(connection, params, who):
    clauses, values = scoped(who, STATION, params.get('station', ''))
    kind = params.get('kind', 'all')
    if kind == 'events':
        clauses.append(f"({KIND}) IN ('event','log','communication')")
    elif kind != 'all':
        if kind not in ('alarm', 'event', 'log', 'communication', 'task_activity'):
            raise ValueError('Unknown record kind')
        clauses.append(f'({KIND})=?'); values.append(kind)
    limit, cursor = page_options(params)
    signature = hashlib.sha256(json.dumps([clauses, values]).encode()).hexdigest()
    snapshot = connection.execute('SELECT COALESCE(MAX(seq),0) FROM audit_events').fetchone()[0]
    if cursor:
        if cursor.get('filter') != signature:
            raise ValueError('Cursor does not match filters')
        if 'snapshot' not in cursor:
            raise ValueError('Invalid record cursor')
        snapshot = cursor['snapshot']
        clauses.append(f'(({register.SORT})<? OR (({register.SORT})=? AND event_id<?))'); values.extend([cursor['time'], cursor['time'], cursor['id']])
    clauses.append('seq<=?'); values.append(snapshot)
    rows = connection.execute(f'SELECT *,({STATION}) AS station,({KIND}) AS kind,({register.STATE}) AS source_status,({register.SORT}) AS sort_time FROM audit_events WHERE ' + ' AND '.join(clauses) + f' ORDER BY ({register.SORT}) DESC,event_id DESC LIMIT ?', [*values, limit + 1]).fetchall()
    more = len(rows) > limit; rows = rows[:limit]
    items = []
    for row in rows:
        item = events.record(row)
        item.update(id=item['eventId'], kind=row['kind'], stationId=row['station'], sourceStatus=row['source_status'])
        items.append(item)
    return {'items': items, 'nextCursor': encode({'filter': signature, 'snapshot': snapshot, 'time': rows[-1]['sort_time'], 'id': rows[-1]['event_id']}) if more else None}


def feed(connection, who):
    tasks = task_list(connection, {}, who, all_open=True)['items']
    current = now()
    def rank(task):
        due = task['dueAt'] or '9999'
        return (0 if due < current and task['priority'] in ('critical', 'high') else 1, due, -PRIORITIES.index(task['priority']), task['id'])
    tasks.sort(key=rank)
    # Resolve each alarm aggregate across ALL history, not just the recent page.
    clauses, values = scoped(who, STATION)
    clauses.append(f"({KIND})='alarm'")
    rows = connection.execute(f'SELECT *,({STATION}) AS station,({register.STATE}) AS source_status FROM audit_events WHERE ' + ' AND '.join(clauses) + ' ORDER BY seq DESC', values).fetchall()
    seen, alarms = set(), []
    for row in rows:
        key = (row['source'], row['aggregate_type'], row['aggregate_id'])
        if key in seen:
            continue
        seen.add(key)
        state = str(row['source_status']).lower()
        if state in ('cleared', 'resolved', 'normal', 'closed', 'inactive') or any(x in row['event_type'] for x in ('.cleared', '.resolved')):
            continue
        alarms.append({**events.record(row), 'id': row['event_id'], 'kind': 'alarm', 'stationId': row['station'], 'sourceStatus': row['source_status']})
    try:
        hours = max(1, min(168, int(os.environ.get('NORTHSTAR_CONSOLE_RECENT_HOURS', '24'))))
    except ValueError:
        hours = 24
    threshold = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    clauses, values = scoped(who, STATION)
    clauses.extend([f"({KIND}) IN ('event','log','communication')", f"({register.SORT})>=julianday(?)", f"(severity IN ('high','critical','warning','error') OR ({KIND})='communication')"])
    values.append(threshold)
    recent = [dict(events.record(r), id=r['event_id'], kind=r['kind'], stationId=r['station'], sourceStatus=r['source_status']) for r in connection.execute(
        f'SELECT *,({STATION}) AS station,({KIND}) AS kind,({register.STATE}) AS source_status FROM audit_events WHERE ' + ' AND '.join(clauses) + f' ORDER BY ({register.SORT}) DESC,event_id DESC LIMIT 30', values)]
    related = {t['sourceId'] for t in tasks if t['sourceId']}
    alarms = [a for a in alarms if a['id'] not in related]
    recent = [a for a in recent if a['id'] not in related]
    return {'tasks': tasks, 'alarms': alarms, 'recent': recent}


def request(method, path, params, data, who):
    route_parts = path.removeprefix('/api/console').strip('/').split('/')
    if method == 'POST' and len(route_parts) == 3 and route_parts[0] == 'records' and route_parts[2] == 'acknowledge':
        with store._session() as connection:
            item, station = source_event(connection, route_parts[1], who)
            authorize(who, station, True)
            if item['source'] != 'market' or item['aggregateType'] != 'price_alert':
                raise ValueError('Acknowledgement is not supported by this source')
        result = store.acknowledge_alert(item['aggregateId'], who['actor'])
        if result is None:
            raise LookupError('Source alarm not found')
        return result
    with store._session() as connection:
        if method == 'GET':
            init(connection)
            connection.execute('BEGIN')
        else:
            begin(connection)
        parts = path.removeprefix('/api/console').strip('/').split('/')
        resource = parts[0]
        if method == 'GET':
            if resource == 'status':
                source_info = register.sources()
                clauses, values = scoped(who, STATION)
                observed = {r['source']: r for r in connection.execute('SELECT source,count(*) AS count,MAX(recorded_at) AS last FROM audit_events WHERE ' + (' AND '.join(clauses) or '1') + ' GROUP BY source', values)}
                for item in source_info['sources']:
                    r = observed.get(item['id'])
                    item.update(count=r['count'] if r else 0, lastRecordedAt=r['last'] if r else None)
                source_info.pop('statuses', None)
                return {'actor': who['actor'], 'canWrite': who['write'], 'sites': who['sites'], 'timezone': 'America/Toronto',
                        'stations': [s for s in sites.known() if who['sites'] is None or s['id'] in who['sites']],
                        'sources': source_info, 'evidenceAdapter': 'pending: trusted in-process adapter required', 'fetchedAt': now()}
            if resource == 'records':
                if len(parts) == 2:
                    item, station = source_event(connection, parts[1], who)
                    row = connection.execute(f'SELECT ({KIND}) AS kind,({register.STATE}) AS state FROM audit_events WHERE event_id=?', (parts[1],)).fetchone()
                    item.update(id=item['eventId'], kind=row['kind'], stationId=station, sourceStatus=row['state'])
                    if item['source'] == 'market' and item['aggregateType'] == 'price_alert':
                        alarm = connection.execute('SELECT state FROM alerts WHERE id=?', (item['aggregateId'],)).fetchone()
                        item['currentSourceStatus'] = alarm['state'] if alarm else None
                        item['canAcknowledge'] = bool(who['write'] and alarm and alarm['state'] == store.ALERT_ACTIVE)
                    clauses, values = scoped(who, STATION)
                    clauses.extend(['source=?', 'aggregate_type=?', 'aggregate_id=?'])
                    values.extend([item['source'], item['aggregateType'], item['aggregateId']])
                    history = connection.execute('SELECT * FROM audit_events WHERE ' + ' AND '.join(clauses) + ' ORDER BY seq DESC LIMIT 100', values).fetchall()
                    return {'record': item, 'audit': [events.record(r) for r in history]}
                return records(connection, params, who)
            if resource == 'feed':
                return feed(connection, who)
            if resource == 'tasks':
                if len(parts) == 1:
                    return task_list(connection, params, who)
                task = task_row(connection, parts[1], who)
                history = connection.execute("SELECT * FROM audit_events WHERE aggregate_type='console_task' AND aggregate_id=? ORDER BY seq", (parts[1],)).fetchall()
                return {'task': task, 'audit': [events.record(r) for r in history]}
            if resource == 'task-templates':
                clauses, values = scoped(who, 'station')
                rows = connection.execute('SELECT data FROM console_templates WHERE ' + (' AND '.join(clauses) or '1'), values).fetchall()
                return {'items': [json.loads(r['data']) for r in rows]}
        elif method == 'POST':
            if not who['write']:
                raise PermissionError('Console is read-only')
            if resource == 'tasks':
                return create_task(connection, data, who) if len(parts) == 1 else change_task(connection, parts[1], parts[2] if len(parts) > 2 else 'edit', data, who)
            if resource == 'task-templates':
                return template_write(connection, parts[1] if len(parts) > 1 else None, data, who)
            if resource == 'records':
                kind = data.get('kind')
                if kind not in ('event', 'log'):
                    raise ValueError('Manual creation supports events/logs only, never source alarms')
                station = station_id(text(data.get('stationId', ''), 'station', 120)); authorize(who, station, True)
                summary = text(data.get('summary', ''), 'summary', 240, True)
                details = text(data.get('details', ''), 'details', 8000)
                key = text(data.get('requestId', ''), 'request ID', 160, True)
                existing = connection.execute('SELECT event_id FROM console_requests WHERE actor=? AND request_key=?', (who['actor'], key)).fetchone()
                if existing:
                    source_event(connection, existing[0], who)
                    return {'eventId': existing[0]}
                event_id = events.append_event(connection, event_type='console.' + kind, occurred_at=now(), actor_id=who['actor'], aggregate_type='console_record', aggregate_id=uuid.uuid4().hex, source='operator', summary=summary, payload={'siteId': station, 'site': station, 'details': details})
                connection.execute('INSERT INTO console_requests VALUES (?,?,?)', (who['actor'], key, event_id))
                return {'eventId': event_id}
        raise LookupError('Console route not found')


def scheduler_loop():
    while True:
        services.wait_turn('console',30)
        try:
            tick()
        except Exception as exc:
            print('console scheduler failed:', type(exc).__name__)
        time.sleep(0.1)
