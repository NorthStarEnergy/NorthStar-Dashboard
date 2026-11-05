import northstar_services as services
"""Durable scheduled/on-demand public water collection, separate from operating records."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import base64
import hashlib
import json
import threading
import time
import uuid
import northstar_data_workspace as db
from northstar_water_sources import PROVIDERS, STATIONS, SourceError, collect_station, timestamp
from northstar_water_elevations import PENDING

UTC=timezone.utc
EXECUTOR=ThreadPoolExecutor(max_workers=3,thread_name_prefix='public-water')
INIT_LOCK=threading.Lock()
READY=set()
DEFAULT_INTERVAL=15
METRICS=('water_level','discharge','water_surface_elevation')

def initialize(settings=None):
    settings=settings or db.config()
    identity=tuple(settings.get(k) for k in ('host','port','dbname','user'))
    with INIT_LOCK:
        with db.connect(settings) as c:
            c.execute('SELECT pg_advisory_xact_lock(76101720)')
            c.execute('CREATE SCHEMA IF NOT EXISTS ns_water')
            c.execute("""CREATE TABLE IF NOT EXISTS ns_water.sources(
                id text PRIMARY KEY,enabled boolean NOT NULL DEFAULT true,
                interval_minutes integer NOT NULL CHECK(interval_minutes BETWEEN 5 AND 10080),
                lookback_hours integer NOT NULL DEFAULT 24 CHECK(lookback_hours BETWEEN 1 AND 168),
                station_ids text[] NOT NULL,version integer NOT NULL DEFAULT 1,
                next_run_at timestamptz DEFAULT now(),backoff_until timestamptz,
                last_success_at timestamptz,last_observation_at timestamptz,last_finished_at timestamptz,
                last_state text NOT NULL DEFAULT 'awaiting_first_run',last_error text NOT NULL DEFAULT '',
                failures integer NOT NULL DEFAULT 0,total_observations bigint NOT NULL DEFAULT 0,
                updated_at timestamptz NOT NULL DEFAULT now(),actor text NOT NULL DEFAULT 'setup')""")
            c.execute("""CREATE TABLE IF NOT EXISTS ns_water.runs(
                id uuid PRIMARY KEY,source_id text NOT NULL REFERENCES ns_water.sources(id),
                mode text NOT NULL,actor text NOT NULL,config jsonb NOT NULL,
                status text NOT NULL DEFAULT 'queued',created_at timestamptz NOT NULL DEFAULT now(),
                started_at timestamptz,finished_at timestamptz,lease_until timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
                inserted bigint NOT NULL DEFAULT 0,revised bigint NOT NULL DEFAULT 0,unchanged bigint NOT NULL DEFAULT 0,
                stations_done integer NOT NULL DEFAULT 0,details jsonb NOT NULL DEFAULT '[]',error text NOT NULL DEFAULT '')""")
            c.execute("CREATE UNIQUE INDEX IF NOT EXISTS water_one_active_run ON ns_water.runs(source_id) WHERE status IN ('queued','running')")
            c.execute('CREATE INDEX IF NOT EXISTS water_runs_created ON ns_water.runs(created_at DESC,id)')
            c.execute("""CREATE TABLE IF NOT EXISTS ns_water.observations(
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                source_id text NOT NULL REFERENCES ns_water.sources(id),station_id text NOT NULL,series text NOT NULL,
                metric text NOT NULL CHECK(metric IN ('water_level','discharge','water_surface_elevation')),
                observed_at timestamptz NOT NULL,value double precision,unit text NOT NULL,datum text NOT NULL,
                raw_value jsonb,raw_unit text NOT NULL,quality jsonb NOT NULL,source_url text NOT NULL,
                fingerprint text NOT NULL,revision integer NOT NULL DEFAULT 1,
                collected_at timestamptz NOT NULL DEFAULT now(),last_checked_at timestamptz NOT NULL DEFAULT now(),
                run_id uuid NOT NULL REFERENCES ns_water.runs(id),
                UNIQUE(source_id,station_id,series,observed_at),
                CHECK(value IS NULL OR value NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)))""")
            for suffix,cols in [('time','observed_at DESC,id DESC'),('station','source_id,station_id,observed_at DESC,id DESC'),('metric','metric,observed_at DESC,id DESC')]:
                c.execute('CREATE INDEX IF NOT EXISTS water_obs_'+suffix+' ON ns_water.observations('+cols+')')
            c.execute("""CREATE TABLE IF NOT EXISTS ns_water.revisions(
                observation_id bigint NOT NULL REFERENCES ns_water.observations(id),
                revision integer NOT NULL,run_id uuid NOT NULL,at timestamptz NOT NULL DEFAULT now(),
                record jsonb NOT NULL,PRIMARY KEY(observation_id,revision))""")
            c.execute("""CREATE TABLE IF NOT EXISTS ns_water.settings_audit(
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,source_id text NOT NULL,actor text NOT NULL,
                at timestamptz NOT NULL DEFAULT now(),before_row jsonb NOT NULL,after_row jsonb NOT NULL)""")
            for source in PROVIDERS:
                ids=[s['id'] for s in STATIONS.values() if s['source']==source and s['active']]
                c.execute('INSERT INTO ns_water.sources(id,interval_minutes,station_ids) VALUES(%s,%s,%s) ON CONFLICT DO NOTHING',(source,DEFAULT_INTERVAL,ids))
        READY.add(identity)

def ensure(settings=None):
    settings=settings or db.config()
    if tuple(settings.get(k) for k in ('host','port','dbname','user')) not in READY:initialize(settings)
    return settings

def status():
    settings=ensure()
    with db.connect(settings) as c:
        rows=c.execute("""SELECT s.*,r.id AS active_run_id,r.status AS active_run_status
              FROM ns_water.sources s LEFT JOIN ns_water.runs r ON r.source_id=s.id AND r.status IN ('queued','running') ORDER BY s.id""").fetchall()
    sources=[]
    rows.sort(key=lambda row:tuple(PROVIDERS).index(row['id']))
    for row in rows:
        row.update(PROVIDERS[row['id']])
        row['stations']=[s for s in STATIONS.values() if s['source']==row['id']]
        sources.append(row)
    return db.serial(dict(sources=sources,unconfigured=PENDING,storage='PostgreSQL · ns_water',timezone='UTC',
        scheduler='Runs in the NorthStar backend while it is running',minimumIntervalMinutes=5,
        notice='Public provider observations are stored separately from plant/manual operating records.'))

def configure(source,payload,actor):
    if source not in PROVIDERS:raise ValueError('Unknown public provider')
    if set(payload)-{'enabled','intervalMinutes','lookbackHours','stationIds','version'}:raise ValueError('Unknown source setting')
    settings=ensure()
    with db.connect(settings) as c:
        before=c.execute('SELECT * FROM ns_water.sources WHERE id=%s FOR UPDATE',(source,)).fetchone()
        if type(payload.get('version')) is not int or payload['version']!=before['version']:raise db.Conflict('Collection settings changed. Refresh before saving.')
        enabled=payload.get('enabled',before['enabled']);interval=payload.get('intervalMinutes',before['interval_minutes'])
        lookback=payload.get('lookbackHours',before['lookback_hours']);ids=payload.get('stationIds',before['station_ids'])
        if type(enabled) is not bool or type(interval) is not int or not 5<=interval<=10080 or type(lookback) is not int or not 1<=lookback<=168:raise ValueError('Use an interval of 5–10,080 minutes and a lookback of 1–168 hours')
        allowed={s['id'] for s in STATIONS.values() if s['source']==source and s['active']}
        if not isinstance(ids,list) or not ids or any(type(i) is not str for i in ids) or len(set(ids))!=len(ids) or not set(ids)<=allowed:raise ValueError('Choose existing active gauges; historical-only gauges cannot be scheduled')
        after=c.execute("""UPDATE ns_water.sources SET enabled=%s,interval_minutes=%s,lookback_hours=%s,station_ids=%s,
            version=version+1,actor=%s,updated_at=now(),
            next_run_at=CASE WHEN %s THEN GREATEST(now(),backoff_until) ELSE NULL END WHERE id=%s RETURNING *""",
            (enabled,interval,lookback,ids,actor,enabled,source)).fetchone()
        c.execute('INSERT INTO ns_water.settings_audit(source_id,actor,before_row,after_row) VALUES(%s,%s,%s::jsonb,%s::jsonb)',(source,actor,db.j(before),db.j(after)))
    return db.serial(after)

def claim(source,actor,mode='manual',settings=None):
    if source not in PROVIDERS:raise ValueError('Unknown public provider')
    settings=ensure(settings)
    with db.connect(settings) as c:
        config=c.execute('SELECT *,now() AS server_now FROM ns_water.sources WHERE id=%s FOR UPDATE',(source,)).fetchone()
        now=config.pop('server_now')
        c.execute("""UPDATE ns_water.runs SET status='interrupted',finished_at=now(),
            error='Previous collector lease expired; committed station data retained'
            WHERE source_id=%s AND status IN ('queued','running') AND lease_until<now()""",(source,))
        active=c.execute("SELECT id,status FROM ns_water.runs WHERE source_id=%s AND status IN ('queued','running')",(source,)).fetchone()
        if active:return db.serial(dict(**active,alreadyRunning=True))
        if config['backoff_until'] and config['backoff_until']>now:
            if mode=='scheduled':return None
            raise db.Conflict('Provider cooldown is active; see the next collection time')
        if mode=='scheduled':
            if not config['enabled'] or not config['next_run_at'] or config['next_run_at']>now:return None
        elif config['last_finished_at'] and now-config['last_finished_at']<timedelta(seconds=60):
            raise db.Conflict('Wait sixty seconds between on-demand collections for a provider')
        run_id=str(uuid.uuid4())
        c.execute('INSERT INTO ns_water.runs(id,source_id,mode,actor,config) VALUES(%s,%s,%s,%s,%s::jsonb)',(run_id,source,mode,actor,db.j(config)))
        c.execute('UPDATE ns_water.sources SET next_run_at=now()+interval_minutes*interval \'1 minute\' WHERE id=%s',(source,))
    return dict(id=run_id,status='queued',alreadyRunning=False)

def persist_station(c,run_id,points):
    run=c.execute("SELECT * FROM ns_water.runs WHERE id=%s AND status='running' AND lease_until>now() FOR UPDATE",(run_id,)).fetchone()
    if not run:raise SourceError('Collection lease expired; station data was not committed')
    inserted=revised=unchanged=0;checked=[]
    unique={(p['series'],p['observed_at']):p for p in points}
    if not unique:return inserted,revised,unchanged
    station=points[0]['station'];source=run['source_id']
    existing={(r['series'],r['observed_at']):r for r in c.execute('SELECT id,series,observed_at,fingerprint FROM ns_water.observations WHERE source_id=%s AND station_id=%s AND observed_at BETWEEN %s AND %s',
        (source,station,min(p['observed_at'] for p in points),max(p['observed_at'] for p in points))).fetchall()}
    values=[]
    for key,p in unique.items():
        fingerprint=hashlib.sha256(db.j({k:p[k] for k in ('value','unit','datum','raw_value','raw_unit','quality')}).encode()).hexdigest()
        before=existing.get(key)
        if before and before['fingerprint']==fingerprint:unchanged+=1;checked.append(before['id']);continue
        if before:revised+=1
        else:inserted+=1
        values.append((source,station,p['series'],p['metric'],p['observed_at'],p['value'],p['unit'],p['datum'],db.j(p['raw_value']),p['raw_unit'],db.j(p['quality']),p['source_url'],fingerprint,run_id))
    query="""WITH changed AS (
        INSERT INTO ns_water.observations(source_id,station_id,series,metric,observed_at,value,unit,datum,raw_value,raw_unit,quality,source_url,fingerprint,run_id)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s::jsonb,%s,%s,%s)
        ON CONFLICT(source_id,station_id,series,observed_at) DO UPDATE SET value=excluded.value,unit=excluded.unit,
            datum=excluded.datum,raw_value=excluded.raw_value,raw_unit=excluded.raw_unit,quality=excluded.quality,
            source_url=excluded.source_url,fingerprint=excluded.fingerprint,revision=observations.revision+1,
            last_checked_at=now(),run_id=excluded.run_id
        WHERE observations.fingerprint<>excluded.fingerprint RETURNING *)
        INSERT INTO ns_water.revisions(observation_id,revision,run_id,record)
        SELECT id,revision,run_id,to_jsonb(changed) FROM changed"""
    if values:c.cursor().executemany(query,values)
    if checked:c.execute('UPDATE ns_water.observations SET last_checked_at=now() WHERE id=ANY(%s)',(checked,))
    latest=max(p['observed_at'] for p in points)
    c.execute("""UPDATE ns_water.sources SET total_observations=total_observations+%s,
        last_observation_at=GREATEST(last_observation_at,%s) WHERE id=%s""",(inserted,latest,source))
    return inserted,revised,unchanged

def run(run_id,settings,fetch_station=None):
    fetch_station=fetch_station or collect_station
    details=[];counts=[0,0,0];retry_seconds=0;failures=0
    try:
        with db.connect(settings) as c:
            job=c.execute("UPDATE ns_water.runs SET status='running',started_at=now() WHERE id=%s AND status='queued' AND lease_until>now() RETURNING *",(run_id,)).fetchone()
        if not job:return
        config=job['config'];source=job['source_id'];end=datetime.now(UTC);start=end-timedelta(hours=config['lookback_hours']);deadline=time.monotonic()+300
        for station_id in config['station_ids']:
            if time.monotonic()>deadline or retry_seconds:
                details.append(dict(station=station_id,state='deferred',message='Provider cooldown or collection time limit reached'));failures+=1;continue
            try:
                station=STATIONS[(source,station_id)]
                points=fetch_station(source,station,start,end,deadline=deadline)
                with db.connect(settings) as c:
                    added,changed,same=persist_station(c,run_id,points)
                    current=dict(station=station_id,state='collected' if points else 'no_data',inserted=added,revised=changed,unchanged=same)
                    c.execute("""UPDATE ns_water.runs SET inserted=inserted+%s,revised=revised+%s,unchanged=unchanged+%s,
                        stations_done=stations_done+1,details=%s::jsonb WHERE id=%s""",(added,changed,same,db.j(details+[current]),run_id))
                counts=[a+b for a,b in zip(counts,(added,changed,same))];details.append(current)
            except Exception as exc:
                failures+=1
                message=str(exc)[:220] if isinstance(exc,SourceError) else 'Station collection failed; committed observations retained'
                retry_seconds=max(retry_seconds,exc.retry_seconds if isinstance(exc,SourceError) else 300)
                details.append(dict(station=station_id,state='failed',message=message))
        state='completed' if not failures else 'partial' if any(d['state'] in ('collected','no_data') for d in details) else 'failed'
        error='' if not failures else next((d.get('message') for d in details if d['state']=='failed'),'Collection time limit reached')
        with db.connect(settings) as c:
            alive=c.execute("SELECT id FROM ns_water.runs WHERE id=%s AND status='running' AND lease_until>now() FOR UPDATE",(run_id,)).fetchone()
            if not alive:return
            c.execute('UPDATE ns_water.runs SET status=%s,finished_at=now(),details=%s::jsonb,error=%s WHERE id=%s',(state,db.j(details),error,run_id))
            c.execute("""UPDATE ns_water.sources SET last_finished_at=now(),last_state=%s,last_error=%s,
                last_success_at=CASE WHEN %s='completed' THEN now() ELSE last_success_at END,
                failures=CASE WHEN %s='completed' THEN 0 ELSE failures+1 END,
                backoff_until=CASE WHEN %s>0 THEN now()+%s*interval '1 second' ELSE NULL END,
                next_run_at=CASE WHEN enabled THEN now()+GREATEST(interval_minutes*60,%s)*interval '1 second' ELSE NULL END WHERE id=%s""",
                (state,error,state,state,retry_seconds,retry_seconds,retry_seconds,source))
    except Exception:
        try:
            with db.connect(settings) as c:
                failed=c.execute("UPDATE ns_water.runs SET status='failed',finished_at=now(),error='Collector failed; committed station data retained' WHERE id=%s AND status IN ('queued','running') RETURNING source_id",(run_id,)).fetchone()
                if failed:
                    c.execute("""UPDATE ns_water.sources SET last_state='failed',last_error='Collector failed; committed station data retained',
                        last_finished_at=now(),failures=failures+1,backoff_until=now()+interval '5 minutes',
                        next_run_at=CASE WHEN enabled THEN now()+GREATEST(interval_minutes,5)*interval '1 minute' ELSE NULL END WHERE id=%s""",(failed['source_id'],))
        except Exception:pass

def enqueue(source,actor,mode='manual',settings=None):
    settings=ensure(settings);job=claim(source,actor,mode,settings)
    if job and not job['alreadyRunning']:
        try:EXECUTOR.submit(run,job['id'],settings)
        except Exception:
            with db.connect(settings) as c:c.execute("UPDATE ns_water.runs SET status='failed',finished_at=now(),error='Worker could not start' WHERE id=%s",(job['id'],))
            raise db.Unavailable('Collection worker could not start') from None
    return job

def tick(settings=None):
    settings=ensure(settings)
    for source in PROVIDERS:enqueue(source,'scheduler','scheduled',settings)

def scheduler_loop(stop=None):
    stop=stop or threading.Event()
    while not stop.is_set():
        services.wait_turn('water',10)
        try:tick()
        except Exception:pass  # Status APIs expose configuration/DB failures; retry without stopping NorthStar.
        stop.wait(0.1)

def observations(params):
    ensure();where=[];values=[];scope=[]
    def query_time(value):
        try:return timestamp(value)
        except SourceError:raise ValueError('Use a timezone-aware ISO observation date') from None
    for key,column in [('source','source_id'),('station','station_id'),('metric','metric')]:
        value=params.get(key,'')
        if value:
            if key=='source' and value not in PROVIDERS:raise ValueError('Unknown provider')
            if key=='station' and not any(s['id']==value for s in STATIONS.values()):raise ValueError('Unknown gauge')
            if key=='metric' and value not in METRICS:raise ValueError('Unknown metric')
            where.append(column+'=%s');values.append(value)
        scope.append(value)
    for key,op in [('start','>='),('end','<=')]:
        value=query_time(params[key]) if params.get(key) else None
        if value:where.append('observed_at'+op+'%s');values.append(value)
        scope.append(value.isoformat() if value else None)
    if params.get('start') and params.get('end') and query_time(params['start'])>query_time(params['end']):raise ValueError('Start must precede end')
    fingerprint=hashlib.sha256(db.j(scope).encode()).hexdigest()
    if params.get('cursor'):
        try:
            if len(params['cursor'])>2048:raise ValueError()
            cursor=json.loads(base64.urlsafe_b64decode(params['cursor']))
            if cursor['scope']!=fingerprint:raise ValueError()
            at=timestamp(cursor['at']);rid=int(cursor['id'])
        except Exception:raise ValueError('Invalid cursor or filters changed; return to the first page') from None
        where.append('(observed_at,id)<(%s,%s)');values.extend([at,rid])
    limit=max(1,min(200,int(params.get('limit',100))));values.append(limit+1)
    with db.connect() as c:rows=c.execute('SELECT * FROM ns_water.observations'+(' WHERE '+' AND '.join(where) if where else '')+' ORDER BY observed_at DESC,id DESC LIMIT %s',values).fetchall()
    more=len(rows)>limit;rows=rows[:limit];cursor=None
    if more:cursor=base64.urlsafe_b64encode(db.j(dict(scope=fingerprint,at=rows[-1]['observed_at'],id=rows[-1]['id'])).encode()).decode()
    return db.serial(dict(rows=rows,nextCursor=cursor))

def request(method,path,params,payload,actor):
    prefix='/api/water-collection/'
    action=path[len(prefix):]
    if method=='GET':
        if action=='status':return status()
        if action=='observations':return observations(params)
        ensure()
        if action=='runs':
            source=params.get('source')
            if source and source not in PROVIDERS:raise ValueError('Unknown provider')
            with db.connect() as c:return dict(items=db.serial(c.execute('SELECT * FROM ns_water.runs'+(' WHERE source_id=%s' if source else '')+' ORDER BY created_at DESC LIMIT 30',[source] if source else []).fetchall()))
        if action=='history':
            rid=int(params.get('id',0))
            with db.connect() as c:return dict(items=db.serial(c.execute('SELECT * FROM ns_water.revisions WHERE observation_id=%s ORDER BY revision DESC LIMIT 50',(rid,)).fetchall()))
        if action=='settings-history':
            with db.connect() as c:return dict(items=db.serial(c.execute('SELECT * FROM ns_water.settings_audit ORDER BY id DESC LIMIT 50').fetchall()))
    if method=='POST':
        if action=='collect':return enqueue(payload.get('source'),actor)
        if action.startswith('sources/'):return configure(action.split('/')[-1],payload,actor)
    raise LookupError('Collection route not found')
