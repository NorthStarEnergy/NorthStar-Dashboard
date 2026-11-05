import northstar_services as services
"""Operator-only inflow read model and automatic bounded worker. Standard library only."""
import json,os,re,sqlite3,subprocess,threading,time
from pathlib import Path
from northstar_paths import app_root

ROOT=app_root(__file__)
CONFIG=Path(os.environ.get('NORTHSTAR_INFLOW_CONFIG',ROOT/'data/.northstar-inflow.json'))
LOCK=threading.Lock()
PROCESS=None
STARTED=0
NEXT_CHECK=0
ERROR=None

def settings():
    return json.loads(CONFIG.read_text(encoding='utf-8'))

def enqueue(force=False):
    global PROCESS,STARTED,NEXT_CHECK,ERROR
    with LOCK:
        if not services.enabled("inflow"):return {"state":"paused"}
        if PROCESS and PROCESS.poll() is None:
            if time.monotonic()-STARTED>1800:
                PROCESS.kill();ERROR='Forecast worker timed out; previous run retained.'
            else:return {'state':'running'}
        if not force and time.time()<NEXT_CHECK:return {'state':'scheduled'}
        NEXT_CHECK=time.time()+services.interval("inflow",300)
        try:
            cfg=settings()
            if not cfg.get('enabled',True):return {'state':'paused'}
            data=Path(cfg['data']);data.mkdir(parents=True,exist_ok=True)
            args=[cfg['python'],str(Path(cfg['engine'])/'live_bridge.py'),str(CONFIG)]
            if force:args.append('--force')
            env=os.environ.copy();env['NORTHSTAR_INFLOW_DATA']=str(data)
            with (data/'worker.log').open('w',encoding='utf-8') as log:
                PROCESS=subprocess.Popen(args,cwd=cfg['engine'],env=env,stdout=log,stderr=log,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            STARTED=time.monotonic();ERROR=None
            services.LAST['inflow']={'monotonic':STARTED,'started_at':time.time()}
            return {'state':'running'}
        except (OSError,ValueError,KeyError):
            ERROR='Automatic inflow worker could not start. Check the local inflow installation.'
            return {'state':'failed','error':ERROR}

def scheduler_loop(stop=None):
    stop=stop or threading.Event()
    while not stop.is_set():
        enqueue()
        stop.wait(30)

def integration_status():
    error=ERROR
    if PROCESS and PROCESS.poll() not in (None,0):error='Last inflow worker failed; saved forecast retained. Check local worker log.'
    return {'running':bool(PROCESS and PROCESS.poll() is None),'next_check_at':NEXT_CHECK,'error':error,'enabled':services.enabled('inflow') and settings().get('enabled',True),'collection_interval_seconds':services.interval('inflow',300),'weather_interval_hours':settings().get('weather_interval_hours',6)}

def request(method,path,params):
    if method=='POST' and path=='/api/inflows/refresh':return enqueue(force=True)
    if method!='GET':raise LookupError()
    data=Path(settings()['data'])
    if path=='/api/inflows/status':
        file=data/'status.json'
        payload=json.loads(file.read_text(encoding='utf-8')) if file.exists() else {'latest':None,'scores':None,'validation':None,'refresh_status':None,'data_inventory':[]}
        payload['integration']=integration_status()
        return payload
    if path not in ('/api/inflows/runs','/api/inflows/run'):raise LookupError()
    with sqlite3.connect((data/'pilot.sqlite').as_uri()+'?mode=ro',uri=True,timeout=5) as c:
        c.row_factory=sqlite3.Row
        if path.endswith('/runs'):return [dict(r) for r in c.execute('SELECT id,issued_at,origin,model_version FROM runs ORDER BY issued_at DESC LIMIT 50')]
        rid=params.get('id','')
        if not re.fullmatch('[a-f0-9]{32}',rid):raise LookupError()
        row=c.execute('SELECT payload FROM runs WHERE id=?',(rid,)).fetchone()
        if not row:raise LookupError()
        return json.loads(row[0])
