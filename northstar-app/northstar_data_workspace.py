"""PostgreSQL-backed operator data workspace. No operational import paths."""
from __future__ import annotations
import base64
from contextlib import contextmanager
from datetime import date, datetime, timezone, timedelta
import hashlib
import json
import math
import os
from pathlib import Path
import re
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

from northstar_paths import app_root
from northstar_data_model import DATASETS, SQL_TYPES, dataset, fields
from northstar_data_expressions import Expression, script_lines

ROOT=app_root(__file__)
EXECUTOR=ThreadPoolExecutor(max_workers=2,thread_name_prefix='northstar-data')
SLOTS=threading.BoundedSemaphore(8)

class Unavailable(RuntimeError):pass
class Conflict(RuntimeError):pass

def config():
    path=Path(os.environ.get('NORTHSTAR_DATA_CONFIG',ROOT/'data/.northstar-data-postgres.json'))
    try:
        data=json.loads(path.read_text(encoding='utf-8'))
        return {k:data[k] for k in ('host','port','dbname','user','password')}
    except (OSError,ValueError,KeyError) as exc:
        raise Unavailable('PostgreSQL is not configured. Run the data-workspace setup.') from exc

@contextmanager
def connect(settings=None):
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError as exc:raise Unavailable('PostgreSQL driver is not installed') from exc
    try:
        con=psycopg.connect(**(settings or config()),connect_timeout=4,row_factory=dict_row)
    except psycopg.Error as exc:raise Unavailable('PostgreSQL is unavailable. Check the local database service.') from exc
    try:
        with con:
            con.execute("SET LOCAL search_path TO ns_data,pg_catalog")
            con.execute("SET LOCAL statement_timeout TO '8s'")
            con.execute("SET LOCAL lock_timeout TO '2s'")
            yield con
    except (psycopg.errors.QueryCanceled,psycopg.errors.LockNotAvailable) as exc:
        raise ValueError('Query timed out. Narrow the filters or retry after another edit completes.') from exc
    except (psycopg.DataError,psycopg.IntegrityError,psycopg.errors.DatatypeMismatch,psycopg.errors.UndefinedFunction) as exc:
        raise ValueError('The values or calculation are incompatible with this dataset. Check types and ranges.') from exc

def serial(value):
    if isinstance(value,dict):return {k:serial(v) for k,v in value.items()}
    if isinstance(value,(list,tuple)):return [serial(v) for v in value]
    if isinstance(value,(datetime,date,uuid.UUID)):return value.isoformat() if hasattr(value,'isoformat') else str(value)
    if isinstance(value,float) and not math.isfinite(value):return None
    return value

def j(value):return json.dumps(serial(value),allow_nan=False,separators=(',',':'))

def initialize(settings=None):
    """Add schema/empty tables only. Never seed or migrate operational records."""
    with connect(settings) as c:
        c.execute('CREATE SCHEMA IF NOT EXISTS ns_data')
        c.execute('SET LOCAL search_path TO ns_data,pg_catalog')
        c.execute('SELECT pg_advisory_xact_lock(76101701)')
        c.execute('CREATE TABLE IF NOT EXISTS schema_version(version integer PRIMARY KEY, installed_at timestamptz NOT NULL DEFAULT now())')
        for key,model in DATASETS.items():
            definitions=['_id uuid PRIMARY KEY','_version bigint NOT NULL DEFAULT 1','_created_at timestamptz NOT NULL DEFAULT now()','_updated_at timestamptz NOT NULL DEFAULT now()','_actor text NOT NULL']
            for f in model['fields']:
                part='"'+f['key']+'" '+SQL_TYPES[f['type']]
                if f['required']:part+=' NOT NULL'
                if f['type']=='number':part+=f''' CHECK ("{f['key']}" NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8))'''
                if f['type']=='text':part+=f''' CHECK(length("{f['key']}")<=10000)'''
                definitions.append(part)
            if key=='runtime':definitions.append('CHECK(ended_at IS NULL OR ended_at>=started_at)')
            if key=='water':definitions.append("CHECK(level_m IS NULL OR NULLIF(trim(datum),'') IS NOT NULL)")
            if key=='weather':definitions.extend(["CHECK(kind IN ('observed','forecast'))","CHECK((kind='observed' AND issued_at IS NULL) OR (kind='forecast' AND issued_at IS NOT NULL))"])
            if key=='ecology':definitions.extend(["CHECK(measure IN ('fish','redd','egg','presence'))","CHECK(count IS NULL OR count>=0)","CHECK((measure='presence' AND count IS NULL AND presence IN ('present','absent','unknown')) OR (measure<>'presence' AND count IS NOT NULL AND presence IS NULL))"])
            c.execute(f'CREATE TABLE IF NOT EXISTS "{key}"('+','.join(definitions)+')')
            for f in model['fields']:
                if f['type'] in ('datetime','date') or f['key'] in ('site','equipment'):
                    c.execute(f'CREATE INDEX IF NOT EXISTS "{key}_{f["key"]}" ON "{key}"("{f["key"]}",_id)')
            c.execute(f'CREATE INDEX IF NOT EXISTS "{key}_updated" ON "{key}"(_updated_at,_id)')
        c.execute('''CREATE TABLE IF NOT EXISTS audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,dataset text NOT NULL,record_id uuid NOT NULL,version bigint NOT NULL,actor text NOT NULL,at timestamptz NOT NULL DEFAULT now(),before_row jsonb,after_row jsonb NOT NULL,job_id uuid,UNIQUE(dataset,record_id,version))''')
        c.execute('CREATE INDEX IF NOT EXISTS audit_record ON audit(dataset,record_id,id DESC)')
        c.execute('''CREATE TABLE IF NOT EXISTS configuration_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,dataset text NOT NULL,kind text NOT NULL,name text NOT NULL,version integer NOT NULL,actor text NOT NULL,at timestamptz NOT NULL DEFAULT now(),before_row jsonb,after_row jsonb NOT NULL)''')
        c.execute('''CREATE TABLE IF NOT EXISTS formulas(dataset text NOT NULL,name text NOT NULL,label text NOT NULL,expression text NOT NULL,unit text NOT NULL DEFAULT '',version integer NOT NULL DEFAULT 1,actor text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(dataset,name))''')
        c.execute('''CREATE TABLE IF NOT EXISTS saved_items(id uuid PRIMARY KEY,owner text NOT NULL,dataset text NOT NULL,kind text NOT NULL CHECK(kind IN ('view','script','chart')),name text NOT NULL,body jsonb NOT NULL,version integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(owner,dataset,kind,name))''')
        c.execute('''CREATE TABLE IF NOT EXISTS previews(id uuid PRIMARY KEY,owner text NOT NULL,dataset text NOT NULL,body jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT(now()+interval '10 minutes'),used boolean NOT NULL DEFAULT false)''')
        c.execute('''CREATE TABLE IF NOT EXISTS jobs(id uuid PRIMARY KEY,owner text NOT NULL,dataset text NOT NULL,plan jsonb NOT NULL,status text NOT NULL,processed bigint NOT NULL DEFAULT 0,error text NOT NULL DEFAULT '',cancel_requested boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())''')
        c.execute('CREATE INDEX IF NOT EXISTS jobs_owner ON jobs(owner,created_at DESC)')
        c.execute('INSERT INTO schema_version(version) VALUES(1) ON CONFLICT DO NOTHING')

def formula_rows(c,name):
    return c.execute('SELECT * FROM formulas WHERE dataset=%s ORDER BY name',(name,)).fetchall()

def expressions(c,name):return {r['name']:r['expression'] for r in formula_rows(c,name)}

def column_sql(name,key,formulas):
    if key in fields(name):return '"'+key+'"',[]
    if key not in formulas:raise ValueError('Unknown column')
    compiler=Expression(fields(name),formulas)
    return compiler.compile(formulas[key]),compiler.parameters

def value_for(f,value):
    if value is None or value=='':
        if f.get('required'):raise ValueError(f['label']+' is required')
        return None
    if f['type']=='text':
        if not isinstance(value,str) or len(value)>10000:raise ValueError(f['label']+' must be text of at most 10,000 characters')
        value=value.strip()
        if f.get('required') and not value:raise ValueError(f['label']+' is required')
        return value or None
    if f['type'] in ('number','integer'):
        if isinstance(value,bool):raise ValueError('A number is required')
        try:n=float(value)
        except (ValueError,TypeError,OverflowError) as exc:raise ValueError(f['label']+' must be numeric') from exc
        if not math.isfinite(n) or abs(n)>1e15:raise ValueError('Number is outside the supported range')
        if f['type']=='integer':
            if not n.is_integer():raise ValueError('A whole number is required')
            return int(n)
        return n
    try:
        if f['type']=='date':return date.fromisoformat(str(value))
        dt=datetime.fromisoformat(str(value).replace('Z','+00:00'))
        if dt.tzinfo is None:raise ValueError()
        return dt.astimezone(timezone.utc)
    except (ValueError,TypeError) as exc:raise ValueError(f['label']+' requires a valid date or timezone-aware timestamp') from exc

def validate_record(name,row):
    model=dataset(name)
    for f in model['fields']:value_for(f,row.get(f['key']))
    if name=='runtime' and row.get('ended_at') and row['ended_at']<row['started_at']:raise ValueError('End must follow start')
    if name=='water' and row.get('level_m') is not None and not row.get('datum'):raise ValueError('Water levels require a datum')
    if name=='weather':
        if row.get('kind') not in ('observed','forecast'):raise ValueError('Kind must be observed or forecast')
        if bool(row.get('issued_at'))!=(row.get('kind')=='forecast'):raise ValueError('Only forecasts require an issue timestamp')
    if name=='ecology':
        if row.get('measure') not in ('fish','redd','egg','presence'):raise ValueError('Measure must be fish, redd, egg or presence')
        if row.get('measure')=='presence':
            if row.get('count') is not None or row.get('presence') not in ('present','absent','unknown'):raise ValueError('Presence needs present, absent or unknown, with no count')
        elif row.get('count') is None or row['count']<0 or row.get('presence') is not None:raise ValueError('Counts must be nonnegative; leave presence empty')

def filters_sql(name,payload,formulas):
    clauses=[];params=[];columns=fields(name)
    fs=payload.get('filters',[])
    if not isinstance(fs,list) or len(fs)>12:raise ValueError('Use at most twelve filters')
    for item in fs:
        if not isinstance(item,dict):raise ValueError('Invalid filter')
        key=item.get('field');op=item.get('op');value=item.get('value')
        expr,ps=column_sql(name,key,formulas)
        if op in ('empty','not_empty'):
            clauses.append(f'({expr} IS '+('NOT ' if op=='not_empty' else '')+'NULL)');params.extend(ps);continue
        f=columns.get(key,dict(type='number',label=key))
        if op in ('contains','starts'):
            if f['type']!='text':raise ValueError('Text filter requires a text column')
            val=value_for(f,value)
            if val is None:raise ValueError('Enter a filter value')
            clauses.append(f'{expr} ILIKE %s');params.extend(ps);params.append(('%' if op=='contains' else '')+val.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%');continue
        operator={'eq':'=','ne':'<>','gt':'>','gte':'>=','lt':'<','lte':'<='}.get(op)
        if not operator:raise ValueError('Unknown filter operator')
        val=value_for(f,value)
        if val is None:raise ValueError('Use the empty filter for missing values')
        clauses.append(f'({expr} {operator} %s)');params.extend(ps);params.append(val)
    return ' AND '.join(clauses) or 'TRUE',params

def query_rows(name,payload,settings=None):
    dataset(name)
    with connect(settings) as c:
        fm=expressions(c,name); where,params=filters_sql(name,payload,fm)
        select=['*'];sp=[]
        for key in fm:
            expr,ps=column_sql(name,key,fm);select.append(f'{expr} AS "{key}"');sp.extend(ps)
        sort=payload.get('sort','_updated_at');direction=payload.get('direction','desc')
        if sort not in fields(name):raise ValueError('Sort by a stored column; calculated columns remain filterable')
        if direction not in ('asc','desc'):raise ValueError('Invalid sort direction')
        fingerprint=hashlib.sha256(j([name,payload.get('filters',[]),sort,direction,fm]).encode()).hexdigest()
        if payload.get('cursor'):
            try:cursor=json.loads(base64.urlsafe_b64decode(payload['cursor']))
            except Exception as exc:raise ValueError('Invalid page cursor') from exc
            if cursor.get('key')!=fingerprint:raise ValueError('Filters changed; return to the first page')
            last=cursor.get('value');rid=str(uuid.UUID(cursor['id']))
            if last is None:where+=f' AND ("{sort}" IS NULL AND _id>%s)';params.append(rid)
            else:
                last=value_for(fields(name)[sort],last)
                where+=f' AND ("{sort}" IS NULL OR "{sort}" '+('>' if direction=='asc' else '<')+f' %s OR ("{sort}"=%s AND _id>%s))';params.extend([last,last,rid])
        limit=max(1,min(200,int(payload.get('limit',100))))
        rows=c.execute(f'SELECT '+','.join(select)+f' FROM "{name}" WHERE {where} ORDER BY "{sort}" {direction} NULLS LAST,_id ASC LIMIT %s',sp+params+[limit+1]).fetchall()
        more=len(rows)>limit;rows=rows[:limit];cursor=None
        if more:
            last=rows[-1];cursor=base64.urlsafe_b64encode(j(dict(key=fingerprint,value=last[sort],id=last['_id'])).encode()).decode()
        return dict(rows=serial(rows),nextCursor=cursor,hasMore=more,limit=limit)

def audit(c,name,before,after,actor,job=None):
    c.execute('INSERT INTO audit(dataset,record_id,version,actor,before_row,after_row,job_id) VALUES(%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s)',(name,after['_id'],after['_version'],actor,j(before) if before else None,j(after),job))

def edit_record(name,payload,actor):
    model=dataset(name);changes=payload.get('values')
    if not isinstance(changes,dict) or not changes:raise ValueError('Record values are required')
    allowed={f['key']:f for f in model['fields']}
    if set(changes)-set(allowed):raise ValueError('Unknown or read-only column')
    clean={k:value_for(allowed[k],v) for k,v in changes.items()}
    with connect() as c:
        if payload.get('id'):
            rid=str(uuid.UUID(payload['id']))
            before=c.execute(f'SELECT * FROM "{name}" WHERE _id=%s FOR UPDATE',(rid,)).fetchone()
            if before is None:raise LookupError('Record not found')
            if type(payload.get('version')) is not int or before['_version']!=payload['version']:raise Conflict('This record changed. Reload it before saving.')
            validate_record(name,{**before,**clean})
            sets=','.join('"'+k+'"=%s' for k in clean)
            after=c.execute(f'UPDATE "{name}" SET {sets},_version=_version+1,_updated_at=clock_timestamp(),_actor=%s WHERE _id=%s RETURNING *',list(clean.values())+[actor,rid]).fetchone()
        else:
            validate_record(name,clean)
            cols=list(clean)+['_id','_actor'];vals=list(clean.values())+[str(uuid.uuid4()),actor]
            after=c.execute(f'INSERT INTO "{name}"('+','.join('"'+k+'"' for k in cols)+') VALUES('+','.join('%s' for _ in vals)+') RETURNING *',vals).fetchone();before=None
        audit(c,name,before,after,actor)
        return serial(after)

def save_formula(name,payload,actor):
    key=payload.get('name','');label=str(payload.get('label','')).strip();unit=str(payload.get('unit',''))[:30]
    if not re.fullmatch('[a-z][a-z0-9_]{0,39}',key) or key in fields(name):raise ValueError('Use a unique lowercase column name')
    if not 1<=len(label)<=80:raise ValueError('Enter a column label of 1–80 characters')
    with connect() as c:
        c.execute('SELECT pg_advisory_xact_lock(%s)',(76101702,))
        existing=c.execute('SELECT * FROM formulas WHERE dataset=%s AND name=%s',(name,key)).fetchone()
        if existing and existing['version']!=payload.get('version'):raise Conflict('Formula changed. Reload before editing.')
        fm=expressions(c,name)
        if not existing and len(fm)>=20:raise ValueError('At most twenty calculated columns per dataset')
        fm[key]=payload.get('expression')
        for expr in fm.values():
            compiler=Expression(fields(name),fm);compiled=compiler.compile(expr)
            # Parse/type-check without scanning rows; numeric result required even for empty datasets.
            c.execute(f'SELECT ({compiled})::double precision FROM "{name}" LIMIT 0',compiler.parameters)
        c.execute('INSERT INTO formulas(dataset,name,label,expression,unit,actor) VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT(dataset,name) DO UPDATE SET label=excluded.label,expression=excluded.expression,unit=excluded.unit,actor=excluded.actor,version=formulas.version+1,updated_at=now()', (name,key,label,fm[key],unit,actor))
        after=c.execute('SELECT * FROM formulas WHERE dataset=%s AND name=%s',(name,key)).fetchone()
        c.execute('INSERT INTO configuration_audit(dataset,kind,name,version,actor,before_row,after_row) VALUES(%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb)',(name,'formula',key,after['version'],actor,j(existing) if existing else None,j(after)))
        return dict(formulas=serial(formula_rows(c,name)))

def saved_items(name,actor,kind=None):
    with connect() as c:return serial(c.execute('SELECT * FROM saved_items WHERE owner=%s AND dataset=%s'+(' AND kind=%s' if kind else '')+' ORDER BY name',[actor,name]+([kind] if kind else [])).fetchall())

def save_item(name,payload,actor):
    kind=payload.get('kind');title=str(payload.get('name','')).strip();body=payload.get('body')
    if kind not in ('view','chart','script') or not 1<=len(title)<=80 or not isinstance(body,dict) or len(j(body))>16000:raise ValueError('Invalid saved item')
    with connect() as c:
        c.execute('SELECT pg_advisory_xact_lock(%s)',(76101703,))
        fm=expressions(c,name)
        if kind=='script':script_lines(body.get('source'),fields(name),fm)
        else:filters_sql(name,body,fm)
        existing=c.execute('SELECT * FROM saved_items WHERE owner=%s AND dataset=%s AND kind=%s AND name=%s FOR UPDATE',(actor,name,kind,title)).fetchone()
        if existing and existing['version']!=payload.get('version'):raise Conflict('A saved item with this name already exists or changed. Load it before replacing it.')
        row=c.execute('INSERT INTO saved_items(id,owner,dataset,kind,name,body) VALUES(%s,%s,%s,%s,%s,%s::jsonb) ON CONFLICT(owner,dataset,kind,name) DO UPDATE SET body=excluded.body,version=saved_items.version+1,updated_at=now() RETURNING *',(str(uuid.uuid4()),actor,name,kind,title,j(body))).fetchone()
        c.execute('INSERT INTO configuration_audit(dataset,kind,name,version,actor,before_row,after_row) VALUES(%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb)',(name,kind,title,row['version'],actor,j(existing) if existing else None,j(row)))
        return serial(row)

def chart(name,payload):
    with connect() as c:
        fm=expressions(c,name);where,params=filters_sql(name,payload,fm)
        metric=payload.get('metric');col=fields(name).get(metric)
        if metric not in fm and (not col or col['type'] not in ('number','integer')):raise ValueError('Select a numeric chart value')
        expr,ep=column_sql(name,metric,fm)
        agg=payload.get('aggregate','avg')
        if agg not in ('avg','sum','min','max'):raise ValueError('Invalid aggregate')
        group=payload.get('group');g=fields(name).get(group)
        if not g:raise ValueError('Select a grouping column')
        if g['type'] in ('datetime','date'):
            bucket=payload.get('bucket','day')
            if bucket not in ('hour','day','week','month','year'):raise ValueError('Invalid time interval')
            gx=f"date_trunc('{bucket}',\"{group}\" AT TIME ZONE 'UTC')"
        elif g['type']=='text':gx='"'+group+'"'
        else:raise ValueError('Group by a date or category')
        rows=c.execute(f'SELECT {gx} AS x,{agg}({expr}) AS y,count(*) AS n,count({expr}) AS valid FROM "{name}" WHERE {where} GROUP BY 1 ORDER BY 1 NULLS LAST LIMIT 501',ep+ep+params).fetchall()
        return dict(points=serial(rows[:500]),truncated=len(rows)>500,timezone='UTC')

def preview_script(name,payload,actor):
    with connect() as c:
        fm=expressions(c,name);lines=script_lines(payload.get('source'),fields(name),fm)
        where,params=filters_sql(name,payload,fm)
        cutoff=c.execute('SELECT clock_timestamp() AS at').fetchone()['at']
        count=c.execute(f'SELECT count(*) AS n FROM "{name}" WHERE {where}',params).fetchone()['n']
        select=['_id','_version'];ep=[]
        for key,expr in lines:
            compiler=Expression(fields(name),fm);sql=compiler.compile(expr)
            select.extend(['"'+key+'" AS "before_'+key+'"',sql+' AS "after_'+key+'"']);ep+=compiler.parameters
        rows=c.execute('SELECT '+','.join(select)+f' FROM "{name}" WHERE {where} ORDER BY _id LIMIT 10',ep+params).fetchall()
        plan=dict(source=payload['source'],filters=payload.get('filters',[]),formulas=fm,cutoff=cutoff,count=count)
        token=str(uuid.uuid4())
        c.execute('DELETE FROM previews WHERE expires_at<now()')
        c.execute('INSERT INTO previews(id,owner,dataset,body) VALUES(%s,%s,%s,%s::jsonb)',(token,actor,name,j(plan)))
        return dict(token=token,count=count,sample=serial(rows),expiresInSeconds=600,notice='Only records unchanged since this preview are eligible. Batches commit as they complete; cancellation retains completed batches.')

def run_job(job_id,settings):
    try:
        with connect(settings) as c:
            job=c.execute("UPDATE jobs SET status='running',updated_at=now() WHERE id=%s RETURNING *",(job_id,)).fetchone()
        name=job['dataset'];plan=job['plan'];actor=job['owner'];last=None;processed=0
        deadline=datetime.now(timezone.utc)+timedelta(minutes=10)
        lines=script_lines(plan['source'],fields(name),plan['formulas'])
        while True:
            with connect(settings) as c:
                state=c.execute('SELECT cancel_requested FROM jobs WHERE id=%s',(job_id,)).fetchone()
                if state['cancel_requested']:
                    c.execute("UPDATE jobs SET status='cancelled',updated_at=now() WHERE id=%s",(job_id,));return
                if datetime.now(timezone.utc)>deadline:raise ValueError('Ten-minute job limit reached; completed batches remain in history')
                where,params=filters_sql(name,plan,plan['formulas']);where+=' AND _updated_at<=%s';params.append(plan['cutoff'])
                if last:where+=' AND _id>%s';params.append(last)
                rows=c.execute(f'SELECT * FROM "{name}" WHERE {where} ORDER BY _id LIMIT 250 FOR UPDATE',params).fetchall()
                if not rows:
                    c.execute("UPDATE jobs SET status='completed',updated_at=now() WHERE id=%s",(job_id,));return
                assignments=[];ep=[]
                for key,expr in lines:
                    compiler=Expression(fields(name),plan['formulas']);sql=compiler.compile(expr)
                    assignments.append('"'+key+'"='+sql);ep+=compiler.parameters
                ids=[r['_id'] for r in rows]
                updates=c.execute(f'UPDATE "{name}" SET '+','.join(assignments)+',_version=_version+1,_updated_at=clock_timestamp(),_actor=%s WHERE _id=ANY(%s) RETURNING *',ep+[actor,ids]).fetchall()
                old={r['_id']:r for r in rows}
                for after in updates:audit(c,name,old[after['_id']],after,actor,job_id)
                processed+=len(updates);last=rows[-1]['_id']
                c.execute('UPDATE jobs SET processed=%s,updated_at=now() WHERE id=%s',(processed,job_id))
    except Exception as exc:
        try:
            with connect(settings) as c:c.execute("UPDATE jobs SET status='failed',error=%s,updated_at=now() WHERE id=%s",(str(exc)[:300] if isinstance(exc,ValueError) else 'Execution failed; completed batches remain in history',job_id))
        except Exception:pass
    finally:SLOTS.release()

def start_job(name,payload,actor):
    if not SLOTS.acquire(blocking=False):raise ValueError('Job queue is full; wait for an existing job')
    try:
        settings=config()
        with connect(settings) as c:
            preview=c.execute('SELECT * FROM previews WHERE id=%s AND owner=%s AND dataset=%s AND expires_at>now() AND NOT used FOR UPDATE',(str(uuid.UUID(payload.get('token',''))),actor,name)).fetchone()
            if preview is None:raise ValueError('Preview expired or was already used. Preview again.')
            if preview['body']['count']==0:raise ValueError('No records match this preview')
            c.execute('UPDATE previews SET used=true WHERE id=%s',(preview['id'],))
            job_id=str(uuid.uuid4())
            c.execute("INSERT INTO jobs(id,owner,dataset,plan,status) VALUES(%s,%s,%s,%s::jsonb,'queued')",(job_id,actor,name,j(preview['body'])))
        EXECUTOR.submit(run_job,job_id,settings)
        return dict(id=job_id,status='queued')
    except Exception:SLOTS.release();raise

def metadata():
    with connect() as c:
        version=c.execute('SELECT max(version) AS v FROM schema_version').fetchone()['v']
        return dict(engine='PostgreSQL',connected=True,schemaVersion=version,datasets=[dict(id=k,**v,formulas=serial(formula_rows(c,k))) for k,v in DATASETS.items()],expressionHelp='Use numeric field names, + - * /, comparisons, AND/OR (lowercase), ABS, ROUND, SQRT, FLOOR, CEIL, MIN, MAX, COALESCE, IFELSE. Division by zero returns missing. SET expressions use original row values; no VBA or arbitrary Python/SQL execution.')

def request(method,path,params,payload,actor):
    if path=='/api/data-workspace/status' and method=='GET':return metadata()
    match=re.fullmatch(r'/api/data-workspace/([a-z]+)/([a-z]+)',path)
    if not match:raise LookupError('Route not found')
    name,action=match.groups();dataset(name)
    if method=='POST':
        if action=='query':return query_rows(name,payload)
        if action=='edit':return edit_record(name,payload,actor)
        if action=='formula':return save_formula(name,payload,actor)
        if action=='save':return save_item(name,payload,actor)
        if action=='chart':return chart(name,payload)
        if action=='preview':return preview_script(name,payload,actor)
        if action=='run':return start_job(name,payload,actor)
        if action=='cancel':
            with connect() as c:
                row=c.execute("UPDATE jobs SET cancel_requested=true WHERE id=%s AND owner=%s AND dataset=%s AND status IN ('queued','running') RETURNING id",(str(uuid.UUID(payload['id'])),actor,name)).fetchone()
                if not row:raise LookupError('Active job not found')
            return dict(cancelRequested=True)
    if method=='GET':
        if action=='activity':
            with connect() as c:
                rows=c.execute("SELECT 'record' AS kind,record_id::text AS name,version,actor,at FROM audit WHERE dataset=%s UNION ALL SELECT kind,name,version,actor,at FROM configuration_audit WHERE dataset=%s AND (kind='formula' OR actor=%s) ORDER BY at DESC LIMIT 50",(name,name,actor)).fetchall()
                return dict(items=serial(rows))
        if action=='saved':return dict(items=saved_items(name,actor))
        if action=='history':
            with connect() as c:return dict(items=serial(c.execute('SELECT version,actor,at,before_row,after_row,job_id FROM audit WHERE dataset=%s AND record_id=%s ORDER BY id DESC LIMIT 50',(name,str(uuid.UUID(params['id'])))).fetchall()))
        if action=='jobs':
            with connect() as c:
                c.execute("UPDATE jobs SET status='interrupted',error='Worker stopped; completed batches remain in history' WHERE status IN ('running','queued') AND updated_at<now()-interval '15 minutes'")
                return dict(items=serial(c.execute('SELECT id,status,processed,error,cancel_requested,created_at,updated_at FROM jobs WHERE owner=%s AND dataset=%s ORDER BY created_at DESC LIMIT 30',(actor,name)).fetchall()))
    raise LookupError('Route not found')
