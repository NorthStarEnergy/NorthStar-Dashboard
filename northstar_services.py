"""Persistent operator service controls. No shell commands or credential editing."""
import json
import os
import threading
import time
from pathlib import Path
from northstar_paths import app_root

ROOT=app_root(__file__)
PATH=Path(os.environ.get('NORTHSTAR_SERVICES_CONFIG', ROOT/'data/.northstar-services.json'))
LOCK=threading.RLock()
WAKE=threading.Event()
LAST={}

def spec(name,seconds,description,link=None,safety=False):
    return dict(name=name,interval_seconds=seconds,description=description,settings_url=link,safety=safety)

CATALOG={
 'inflow':spec('Inflow forecasts',300,'Tracking imports, gauge inputs and forecast archive. Weather and LWCB refresh have a separate interval.','inflow-outlook.html'),
 'market':spec('Market prices and price alerts',300,'Refresh market data and evaluate price alerts.'),
 'advisories':spec('IESO advisories',300,'Refresh system advisories.'),
 'safety':spec('Worker overdue monitoring, backup and retention',30,'Stopping suspends overdue detection, daily database backup and coordinate-retention cleanup.',safety=True),
 'scada':spec('SCADA report intake',60,'Scan the configured read-only report drop after files stabilize.'),
 'flows':spec('Public flow snapshots',300,'Refresh the legacy public hydrometric snapshot.'),
 'water':spec('Public water collection',10,'Dispatch provider jobs. Each provider also has its own enabled state, interval, lookback and stations.','water-collection.html'),
 'daily-report':spec('Daily report preparation',20,'Dispatch and prepare report jobs. The report schedule has a separate enabled state and daily time.','daily-report-automation.html'),
 'dispatch':spec('Dispatch simulation',5,'Advance the dashboard simulation; this does not control physical generation.'),
 'voice':spec('Voice intake and transcription',45,'Scan audio inbox, transcribe queued audio and enforce audio retention.'),
 'console':spec('Operations console tasks',30,'Evaluate scheduled console tasks. Individual task schedules remain in Operations.'),
 'weather-api':spec('Weather API',None,'On-demand weather requests; adjust cache lifetime below.'),
 'water-api':spec('Water elevation API',None,'On-demand public elevation queries. Durable water collection is controlled separately.','water-elevations.html'),
 'reports-api':spec('IESO reports and market history API',None,'On-demand report retrieval and market-history requests.'),
 'ai-api':spec('AI assistant API',None,'Assistant inference and related API requests. Stopping leaves stored conversations intact.'),
 'chat-api':spec('Chat integration API',None,'Chat provider requests and synchronization.'),
}

def read():
    if not PATH.exists():return {'version':0,'services':{}}
    value=json.loads(PATH.read_text(encoding='utf-8'))
    if not isinstance(value.get('services'),dict):raise ValueError('Invalid service configuration')
    return value

def config(key):
    if key not in CATALOG:raise ValueError('Unknown service')
    with LOCK:
        value=read()['services'].get(key,{})
        return dict(enabled=True,**{k:v for k,v in value.items() if k!='enabled'}) | {'enabled':value.get('enabled',True)}

def enabled(key):
    try:return config(key)['enabled']
    except (OSError,ValueError):return False

def interval(key,default=None):
    return config(key).get('interval_seconds',default if default is not None else CATALOG[key]['interval_seconds'])

def wait_turn(key,default=None):
    """Cooperative stop: no new iteration begins while disabled. Existing work finishes."""
    if default is not None:CATALOG[key]['interval_seconds']=default
    while True:
        try:
            cfg=config(key);delay=cfg.get('interval_seconds',default or CATALOG[key]['interval_seconds'])
            if cfg['enabled'] and time.monotonic()-LAST.get(key,{}).get('monotonic',-1e15)>=delay:
                LAST[key]={'monotonic':time.monotonic(),'started_at':time.time()}
                return
        except (OSError,ValueError):pass
        WAKE.wait(1);WAKE.clear()

def snapshot():
    with LOCK:
        saved=read();items=[]
        for key,definition in CATALOG.items():
            cfg={'enabled':True,'interval_seconds':definition['interval_seconds'],**saved['services'].get(key,{})}
            items.append({**definition,**cfg,'id':key,'last_started_at':LAST.get(key,{}).get('started_at'),
                              'state':'Enabled' if cfg['enabled'] else 'Stopped'})
        return {'version':saved['version'],'services':items,'backend_pid':os.getpid(),
                'note':'Stop prevents new work; an operation already running may finish. Enabled does not mean a provider is configured or healthy. The web server, authentication, database and tunnel are infrastructure and remain running so this page stays accessible.'}

def update(payload,actor):
    if set(payload)-{'id','version','enabled','interval_seconds','weather_hours','cache_seconds'}:raise ValueError('Unknown setting')
    key=payload.get('id')
    if key not in CATALOG:raise ValueError('Unknown service')
    if type(payload.get('version')) is not int:raise ValueError('Reload service settings before saving')
    if 'enabled' in payload and type(payload['enabled']) is not bool:raise ValueError('enabled must be true or false')
    for field,low,high in [('interval_seconds',3,604800),('weather_hours',1,168),('cache_seconds',60,86400)]:
        if field in payload:
            if type(payload[field]) is not int or not low<=payload[field]<=high:raise ValueError(f'{field} must be an integer from {low} to {high}')
            if field=='interval_seconds' and CATALOG[key]['interval_seconds'] is None:raise ValueError('This service runs on demand, not on an interval')
            if field=='weather_hours' and key!='inflow':raise ValueError('Weather refresh applies to inflow only')
            if field=='cache_seconds' and key!='weather-api':raise ValueError('Cache interval applies to weather API only')
    with LOCK:
        value=read()
        if value['version']!=payload['version']:raise ValueError('Settings changed in another window. Reload and retry.')
        change={k:v for k,v in payload.items() if k not in ('id','version')}
        value['services'][key]={**value['services'].get(key,{}),**change};value['version']+=1
        # Keep the separately launched inflow worker's persisted pause in sync.
        if key=='inflow':
            path=ROOT/'data/.northstar-inflow.json'
            if path.exists():
                cfg=json.loads(path.read_text(encoding='utf-8'))
                if 'enabled' in change:cfg['enabled']=change['enabled']
                if 'weather_hours' in change:cfg['weather_interval_hours']=change['weather_hours']
                temp=path.with_suffix('.tmp');temp.write_text(json.dumps(cfg,indent=2),encoding='utf-8');os.replace(temp,path)
        PATH.parent.mkdir(parents=True,exist_ok=True)
        temp=PATH.with_suffix('.tmp');temp.write_text(json.dumps(value,indent=2),encoding='utf-8');os.replace(temp,PATH)
        with PATH.with_suffix('.audit.jsonl').open('a',encoding='utf-8') as log:log.write(json.dumps({'at':time.time(),'actor':actor,'service':key,'change':change,'version':value['version']})+'\n')
        if change.get('enabled') is True:LAST.pop(key,None)
        WAKE.set()
        return snapshot()

def blocked_api(route,method):
    key=None
    if route=='/api/weather':key='weather-api'
    elif route=='/api/water-elevations':key='water-api'
    elif route in ('/api/ieso-streams','/api/ieso-report','/api/market-history'):key='reports-api'
    elif route=='/api/ai' or route.startswith('/api/ai/'):key='ai-api'
    elif route.startswith('/api/chat/'):key='chat-api'
    elif method=='POST':
        if route=='/api/inflows/refresh':key='inflow'
        elif route.startswith('/api/water-collection/') and ('collect' in route.split('/')[3:] or route.endswith('/run')):key='water'
        elif route.startswith('/api/daily-report/') and route.endswith(('/run','/prepare','/refresh')):key='daily-report'
        elif route in ('/api/voice/upload','/api/voice/scan'):key='voice'
        elif route=='/api/scada/import':key='scada'
    return key if key and not enabled(key) else None
