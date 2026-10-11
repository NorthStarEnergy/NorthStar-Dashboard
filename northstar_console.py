"""Five-category operations console over the existing append-only ledger.

Task mutations and their ledger entries commit together. There is no upstream
alarm control or external message ingestion on this API.
"""
from __future__ import annotations
import hashlib
import json
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo
import northstar_events as events
import northstar_event_register as register
import northstar_store as store

CATEGORIES = {
    'alarms': ['SCADA', 'App alarms'],
    'communications': ['Outlook', 'Telephone', 'Teams'],
    'tasks': ['Recurring', 'Created on demand', 'Triggered'],
    'events': ['Outages', 'Planned', 'Operator log'],
    'feed': ['IESO', 'Market', 'Weather', 'News'],
}
OPEN = ('open', 'in_progress', 'pending_verification')
TRANSITIONS = {'open': {'in_progress', 'completed', 'pending_verification', 'cancelled'},
               'in_progress': {'open', 'completed', 'pending_verification', 'cancelled'},
               'pending_verification': {'open', 'completed', 'cancelled'}}
GROUP = f"""CASE WHEN aggregate_type='console_task' THEN 'tasks'
 WHEN source='console' AND json_valid(payload) THEN COALESCE(json_extract(payload,'$.consoleCategory'),'events')
 WHEN ({register.CATEGORY})='alarm' THEN 'alarms'
 WHEN ({register.CATEGORY}) IN ('communication','voice','chat') THEN 'communications'
 WHEN source IN ('ieso','market','weather','news') THEN 'feed'
 ELSE 'events' END"""
SUBTYPE = f"""COALESCE(json_extract({register.PAYLOAD},'$.subtype'), CASE
 WHEN aggregate_type='console_task' THEN 'Created on demand'
 WHEN ({register.CATEGORY})='alarm' THEN CASE WHEN source='scada' THEN 'SCADA' ELSE 'App alarms' END
 WHEN source='outlook' THEN 'Outlook' WHEN source IN ('voice','telephone') THEN 'Telephone'
 WHEN source='teams' THEN 'Teams' WHEN source IN ('outage','outages') THEN 'Outages'
 WHEN source='market' THEN 'Market' WHEN source='ieso' THEN 'IESO'
 WHEN source='weather' THEN 'Weather' WHEN source='news' THEN 'News' ELSE 'Operator log' END)"""
SCHEMA = """
CREATE TABLE IF NOT EXISTS console_tasks (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, details TEXT NOT NULL, site TEXT NOT NULL,
 priority TEXT NOT NULL, status TEXT NOT NULL, mode TEXT NOT NULL, subtype TEXT NOT NULL,
 assignee TEXT NOT NULL, due_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1, source_event_id TEXT REFERENCES audit_events(event_id),
 template_id TEXT, occurrence_key TEXT UNIQUE, request_key TEXT UNIQUE NOT NULL,
 request_hash TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '', event_id TEXT REFERENCES audit_events(event_id)
);
CREATE INDEX IF NOT EXISTS idx_console_tasks_status_due ON console_tasks(status,due_at,id);
CREATE TABLE IF NOT EXISTS console_templates (
 id TEXT PRIMARY KEY, spec TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
 last_date TEXT, last_seq INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, request_key TEXT UNIQUE NOT NULL, request_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS console_links (
 left_id TEXT NOT NULL REFERENCES audit_events(event_id),
 right_id TEXT NOT NULL REFERENCES audit_events(event_id),
 actor TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(left_id,right_id), CHECK(left_id<right_id)
);
"""

class Conflict(ValueError):
    pass

def init_schema(connection):
    connection.executescript(SCHEMA)

def now():
    return datetime.now(timezone.utc)

def stamp(value):
    try:
        result = datetime.fromisoformat(str(value).replace('Z','+00:00'))
        if result.tzinfo is None:
            raise ValueError()
        return result.astimezone(timezone.utc).isoformat()
    except (ValueError, TypeError) as exc:
        raise ValueError('Timestamp must include a timezone') from exc

def text(value, maxlen=8000, required=False):
    if value is not None and not isinstance(value,str):
        raise ValueError('Text fields must be strings')
    result = (value or '').strip()
    if len(result)>maxlen or (required and not result):
        raise ValueError('Missing or oversized text field')
    return result

def key(payload, actor):
    return hashlib.sha256((actor+'\0'+text(payload.get('requestId'),128,True)).encode()).hexdigest()

def fingerprint(payload):
    return hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def task_record(row):
    result = dict(row)
    result['overdue'] = result['status'] in OPEN and bool(result['due_at']) and result['due_at']<now().isoformat()
    result.pop('request_hash',None);result.pop('request_key',None)
    return result

def _parent(connection, event_id):
    if not event_id:
        return None
    row = connection.execute('SELECT * FROM audit_events WHERE event_id=?',(event_id,)).fetchone()
    if not row:
        raise LookupError('Source event not found')
    return row

def _task_spec(payload):
    mode = payload.get('mode','manual')
    if mode not in ('manual','verified'):
        raise ValueError('Automatic completion requires a trusted evidence adapter; use manual or verified')
    priority = payload.get('priority','normal')
    if priority not in ('normal','high','critical'):
        raise ValueError('Invalid priority')
    return dict(title=text(payload.get('title'),300,True), details=text(payload.get('details')),
                site=text(payload.get('site'),200), priority=priority, mode=mode,
                assignee=text(payload.get('assignee'),200), due_at=stamp(payload['due_at']) if payload.get('due_at') else None)

def _insert_task(connection, spec, actor, request_key, request_hash, *, subtype='Created on demand',
                 source_event_id=None, template_id=None, occurrence_key=None, at=None):
    existing = connection.execute('SELECT * FROM console_tasks WHERE request_key=?',(request_key,)).fetchone()
    if existing:
        if existing['request_hash'] != request_hash:
            raise Conflict('Retry ID was already used for a different task')
        return task_record(existing)
    parent = _parent(connection,source_event_id)
    identity = events.new_id('task'); current = (at or now()).isoformat()
    event_id = events.append_event(connection, event_type='tasks.created',occurred_at=current,
        actor_id=actor,aggregate_type='console_task',aggregate_id=identity,source='console',summary=spec['title'],
        severity='critical' if spec['priority']=='critical' else 'info',
        causation_id=source_event_id,correlation_id=parent['correlation_id'] if parent else None,
        payload={**spec,'status':'open','subtype':subtype,'consoleCategory':'tasks','templateId':template_id})
    connection.execute('INSERT INTO console_tasks (id,title,details,site,priority,status,mode,subtype,assignee,due_at,created_at,updated_at,source_event_id,template_id,occurrence_key,request_key,request_hash,event_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        (identity,spec['title'],spec['details'],spec['site'],spec['priority'],'open',spec['mode'],subtype,spec['assignee'],spec['due_at'],current,current,source_event_id,template_id,occurrence_key,request_key,request_hash,event_id))
    return task_record(connection.execute('SELECT * FROM console_tasks WHERE id=?',(identity,)).fetchone())

def create_task(payload, actor):
    spec = _task_spec(payload)
    with store._LOCK, store._session() as connection:
        connection.execute('BEGIN IMMEDIATE')
        return _insert_task(connection,spec,actor,key(payload,actor),fingerprint(payload),source_event_id=text(payload.get('source_event_id'),200) or None)

def transition(payload, actor):
    target = text(payload.get('status'),30,True); task_id = text(payload.get('id'),200,True)
    notes = text(payload.get('notes')); evidence = text(payload.get('evidence'))
    request_key = key(payload,actor)
    event_id='evt_console_'+request_key
    with store._LOCK,store._session() as connection:
        connection.execute('BEGIN IMMEDIATE')
        prior=connection.execute('SELECT payload FROM audit_events WHERE event_id=?',(event_id,)).fetchone()
        if prior:
            if json.loads(prior['payload']).get('requestHash')!=fingerprint(payload):
                raise Conflict('Retry ID was already used for another transition')
            return task_record(connection.execute('SELECT * FROM console_tasks WHERE id=?',(task_id,)).fetchone())
        row=connection.execute('SELECT * FROM console_tasks WHERE id=?',(task_id,)).fetchone()
        if not row:
            raise LookupError('Task not found')
        if type(payload.get('version')) is not int or payload.get('version') != row['version']:
            raise Conflict('Task changed in another session. Refresh and try again.')
        if target not in TRANSITIONS.get(row['status'],set()):
            raise ValueError('Invalid task transition')
        if target=='cancelled' and not notes:
            raise ValueError('Cancellation requires a reason')
        if target=='pending_verification' and (row['mode']!='verified' or not evidence):
            raise ValueError('Verification requires a verified task and evidence')
        if target=='completed' and row['mode']=='verified' and row['status']!='pending_verification':
            raise ValueError('Submit evidence for verification first')
        if row['status']=='pending_verification' and target in {'open','completed'} and not notes:
            raise ValueError('Record verification decision notes')
        current=now().isoformat()
        events.append_event(connection,event_id=event_id,event_type='tasks.'+target,occurred_at=current,
            actor_id=actor,aggregate_type='console_task',aggregate_id=task_id,source='console',summary=row['title'],
            causation_id=row['event_id'],payload={'site':row['site'],'status':target,'priorStatus':row['status'],
                'subtype':row['subtype'],'details':notes,'evidence':evidence or row['evidence'],'requestHash':fingerprint(payload)})
        connection.execute('UPDATE console_tasks SET status=?,version=version+1,updated_at=?,evidence=? WHERE id=? AND version=?',
                           (target,current,evidence or row['evidence'],task_id,row['version']))
        return task_record(connection.execute('SELECT * FROM console_tasks WHERE id=?',(task_id,)).fetchone())

def tasks(params):
    clauses=[];values=[]
    status=register._one(params,'status','open')
    if status=='open':
        clauses.append("status IN ('open','in_progress','pending_verification')")
    elif status != 'all':
        if status not in {*OPEN,'completed','cancelled'}:
            raise ValueError('Unknown task status')
        clauses.append('status=?');values.append(status)
    for field in ('site','subtype'):
        value=register._one(params,field)
        if value:
            clauses.append(field+'=?');values.append(value)
    query=register._one(params,'q')
    if len(query)>500: raise ValueError('Search exceeds 500 characters')
    if query:
        clauses.append('(instr(lower(title),lower(?))>0 OR instr(lower(details),lower(?))>0)');values.extend([query,query])
    limit=int(register._one(params,'limit','50'));offset=int(register._one(params,'offset','0'))
    if not 1<=limit<=100 or offset<0: raise ValueError('Invalid task page')
    where=' AND '.join(clauses) or '1=1'
    with store._session() as connection:
        total=connection.execute('SELECT count(*) FROM console_tasks WHERE '+where,values).fetchone()[0]
        rows=connection.execute('SELECT * FROM console_tasks WHERE '+where+" ORDER BY CASE status WHEN 'completed' THEN 1 WHEN 'cancelled' THEN 1 ELSE 0 END, CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, due_at IS NULL,due_at,id LIMIT ? OFFSET ?",[*values,limit,offset]).fetchall()
    return {'items':[task_record(r) for r in rows],'total':total,'nextOffset':offset+len(rows) if offset+len(rows)<total else None}

def records(params):
    category=register._one(params,'category','all');subtype=register._one(params,'subtype')
    if category not in {'all',*CATEGORIES}:
        raise ValueError('Unknown console category')
    clauses=[];values=[]
    if category!='all': clauses.append(f'({GROUP})=?');values.append(category)
    if subtype: clauses.append(f'({SUBTYPE})=?');values.append(subtype)
    with store._session() as connection:
        result=register._query(connection,params,relation=(' AND '.join(clauses),values) if clauses else None)
        for item in result['items']:
            row=connection.execute(f'SELECT ({GROUP}),({SUBTYPE}) FROM audit_events WHERE event_id=?',(item['eventId'],)).fetchone()
            item['consoleCategory'],item['subtype']=row
    return result

def create_record(payload, actor):
    category=payload.get('category');subtype=payload.get('subtype')
    if category not in ('communications','events','feed') or subtype not in CATEGORIES[category]:
        raise ValueError('Choose a manual communication, event or feed note; alarms require an authentic source')
    title=text(payload.get('title'),300,True);details=text(payload.get('details'))
    planned_at=stamp(payload['due_at']) if payload.get('due_at') else None
    site=text(payload.get('site'),200); occurred=stamp(payload['occurredAt']) if payload.get('occurredAt') else now().isoformat()
    identity='evt_console_'+key(payload,actor);digest=fingerprint(payload)
    with store._LOCK,store._session() as connection:
        connection.execute('BEGIN IMMEDIATE')
        prior=connection.execute('SELECT payload FROM audit_events WHERE event_id=?',(identity,)).fetchone()
        if prior:
            if json.loads(prior['payload']).get('requestHash')!=digest: raise Conflict('Retry ID reused for a different record')
        else:
            source_id=text(payload.get('source_event_id'),200);parent=_parent(connection,source_id)
            events.append_event(connection,event_id=identity,event_type='console.'+category,occurred_at=occurred,
                actor_id=actor,aggregate_type='console_record',aggregate_id=identity,source='console',summary=title,
                causation_id=source_id or None,correlation_id=parent['correlation_id'] if parent else None,
                payload={'consoleCategory':category,'category':{'communications':'communication','events':'log','feed':'feed'}[category],
                         'subtype':subtype,'site':site,'plannedAt':planned_at,'details':details,'manual':True,'requestHash':digest})
    return {'eventId':identity,'href':events.report_href(identity)}

def link(payload, actor):
    left=text(payload.get('left'),200,True);right=text(payload.get('right'),200,True)
    if left==right: raise ValueError('Choose two different records')
    left,right=sorted([left,right])
    with store._LOCK,store._session() as connection:
        connection.execute('BEGIN IMMEDIATE')
        _parent(connection,left);_parent(connection,right)
        exists=connection.execute('SELECT 1 FROM console_links WHERE left_id=? AND right_id=?',(left,right)).fetchone()
        if not exists:
            connection.execute('INSERT INTO console_links VALUES (?,?,?,?)',(left,right,actor,now().isoformat()))
            events.append_event(connection,event_type='console.linked',occurred_at=now().isoformat(),actor_id=actor,
                aggregate_type='console_record',aggregate_id=left,source='console',summary='Records linked',
                causation_id=left,payload={'left':left,'right':right})
    return {'linked':True}

def linked(event_id):
    with store._session() as connection:
        _parent(connection,event_id)
        rows=connection.execute('SELECT e.* FROM audit_events e JOIN console_links l ON e.event_id=CASE WHEN l.left_id=? THEN l.right_id ELSE l.left_id END WHERE l.left_id=? OR l.right_id=?',(event_id,event_id,event_id)).fetchall()
        result=[events.record(r) for r in rows]
        task_rows=connection.execute('SELECT * FROM console_tasks WHERE source_event_id=?',(event_id,)).fetchall()
    return {'items':result,'tasks':[task_record(r) for r in task_rows]}

def templates():
    with store._session() as connection:
        rows=connection.execute('SELECT * FROM console_templates ORDER BY created_at DESC').fetchall()
    return {'items':[{'id':r['id'],'enabled':bool(r['enabled']),**json.loads(r['spec'])} for r in rows]}

def create_template(payload, actor):
    spec=_task_spec(payload);kind=payload.get('kind','daily')
    if kind=='daily':
        zone=text(payload.get('timezone') or 'America/Toronto',100)
        try: ZoneInfo(zone)
        except (KeyError,ValueError) as exc: raise ValueError('Unknown timezone') from exc
        try:
            local_time=time.fromisoformat(text(payload.get('localTime'),5,True));start=date.fromisoformat(payload['startsOn'])
            if len(payload['localTime'])!=5: raise ValueError()
        except (ValueError,TypeError,KeyError) as exc: raise ValueError('Specify HH:MM and start date') from exc
        spec.update(kind=kind,timezone=zone,localTime=local_time.isoformat(timespec='minutes'),startsOn=start.isoformat())
        spec.pop('due_at',None)
    elif kind=='triggered':
        spec.update(kind=kind,eventType=text(payload.get('eventType'),200,True),eventSource=text(payload.get('eventSource'),100,True))
        if spec['eventSource']=='console' or spec['eventType'].startswith(('console.','tasks.')):
            raise ValueError('Task rules cannot trigger on console/task writes')
    else: raise ValueError('Template kind must be daily or triggered')
    request_key=key(payload,actor);digest=fingerprint(payload)
    with store._LOCK,store._session() as connection:
        connection.execute('BEGIN IMMEDIATE')
        old=connection.execute('SELECT * FROM console_templates WHERE request_key=?',(request_key,)).fetchone()
        if old:
            if old['request_hash']!=digest: raise Conflict('Retry ID reused')
            return {'id':old['id']}
        identity=events.new_id('template');seq=connection.execute('SELECT COALESCE(MAX(seq),0) FROM audit_events').fetchone()[0]
        connection.execute('INSERT INTO console_templates (id,spec,last_seq,created_at,request_key,request_hash) VALUES (?,?,?,?,?,?)',
            (identity,json.dumps(spec),seq,now().isoformat(),request_key,digest))
        events.append_event(connection,event_type='tasks.template.created',occurred_at=now().isoformat(),actor_id=actor,
            aggregate_type='console_template',aggregate_id=identity,source='console',summary='Task template: '+spec['title'],payload=spec)
    return {'id':identity}

def set_template(payload, actor):
    if not isinstance(payload.get('enabled'),bool): raise ValueError('Enabled must be true or false')
    with store._LOCK,store._session() as connection:
        connection.execute('BEGIN IMMEDIATE')
        row=connection.execute('SELECT * FROM console_templates WHERE id=?',(payload.get('id'),)).fetchone()
        if not row: raise LookupError('Template not found')
        connection.execute('UPDATE console_templates SET enabled=? WHERE id=?',(int(payload['enabled']),row['id']))
        events.append_event(connection,event_type='tasks.template.enabled' if payload['enabled'] else 'tasks.template.disabled',
            occurred_at=now().isoformat(),actor_id=actor,aggregate_type='console_template',aggregate_id=row['id'],source='console',
            summary='Template enabled' if payload['enabled'] else 'Template disabled',payload={'enabled':payload['enabled']})
    return {'id':row['id'],'enabled':payload['enabled']}

def local_due(day, clock, zone):
    """One occurrence per local date: earliest fold; gaps advance to first valid minute."""
    naive=datetime.combine(day,time.fromisoformat(clock));tz=ZoneInfo(zone)
    for _ in range(181):
        aware=naive.replace(tzinfo=tz,fold=0)
        if aware.astimezone(timezone.utc).astimezone(tz).replace(tzinfo=None)==naive:
            return aware.astimezone(timezone.utc)
        naive+=timedelta(minutes=1)
    raise ValueError('Unsupported local time gap')

def tick(current=None):
    current=current or now()
    with store._LOCK,store._session() as connection:
        connection.execute('BEGIN IMMEDIATE')
        for row in connection.execute('SELECT * FROM console_templates WHERE enabled=1').fetchall():
            spec=json.loads(row['spec'])
            if spec['kind']=='daily':
                day=date.fromisoformat(row['last_date'])+timedelta(days=1) if row['last_date'] else date.fromisoformat(spec['startsOn'])
                today=current.astimezone(ZoneInfo(spec['timezone'])).date()
                for _ in range(31):
                    if day>today: break
                    due=local_due(day,spec['localTime'],spec['timezone'])
                    if due>current: break
                    occurrence=row['id']+':'+day.isoformat()
                    _insert_task(connection,{**{k:spec[k] for k in ('title','details','site','priority','mode','assignee')},'due_at':due.isoformat()},
                        'scheduler',occurrence,occurrence,subtype='Recurring',template_id=row['id'],occurrence_key=occurrence,at=current)
                    connection.execute('UPDATE console_templates SET last_date=? WHERE id=?',(day.isoformat(),row['id']))
                    day+=timedelta(days=1)
            else:
                # Exact source + type; starts at creation, no fabricated provider signals.
                matches=connection.execute('SELECT * FROM audit_events WHERE seq>? AND source=? AND event_type=? ORDER BY seq LIMIT 100',
                    (row['last_seq'],spec['eventSource'],spec['eventType'])).fetchall()
                for item in matches:
                    occurrence=row['id']+':'+item['event_id']
                    _insert_task(connection,{k:spec.get(k) for k in ('title','details','site','priority','mode','assignee','due_at')},'scheduler',
                        occurrence,occurrence,subtype='Triggered',source_event_id=item['event_id'],template_id=row['id'],occurrence_key=occurrence,at=current)
                    connection.execute('UPDATE console_templates SET last_seq=? WHERE id=?',(item['seq'],row['id']))

def feed():
    work=tasks({'limit':'100'})
    recent=records({'limit':'20'})
    return {'tasks':work['items'],'openTotal':work['total'],'alarms':store.list_alerts(limit=100),'recent':recent['items'],'fetchedAt':now().isoformat()}

def catalog():
    return {'categories':CATEGORIES,'timezone':'America/Toronto','sources':register.sources(),
            'note':'Manual records are labelled manual. Physical SCADA alarms, telephone intake and external feeds need approved adapters. No upstream alarm control.'}
