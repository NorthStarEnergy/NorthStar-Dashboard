import northstar_services as services
"""Durable, operator-only daily preparation. Source workbooks are never overwritten."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import csv
import json
import os
import re
import sqlite3
import subprocess
import threading
import time
import uuid
from urllib.parse import urlsplit
import northstar_report_sources as sources
import northstar_report_workbook as workbook

ROOT=Path(__file__).resolve().parent
DEFAULTS=dict(enabled=False,time='06:30',timezone='America/New_York',readingTimezone='America/New_York',retryMinutes=60)
_worker_lock=threading.Lock()

def home():return Path(os.environ.get('NORTHSTAR_DAILY_REPORT_HOME',ROOT/'data'/'daily-report'))
def config():
    path=home()/'config.json'
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
def connect():
    home().mkdir(parents=True,exist_ok=True)
    c=sqlite3.connect(home()/'jobs.sqlite',timeout=10);c.row_factory=sqlite3.Row
    c.executescript('''CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,created TEXT NOT NULL,day TEXT NOT NULL,state TEXT NOT NULL,
      actor TEXT NOT NULL,slot TEXT UNIQUE,finished TEXT,error TEXT,settings TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(at TEXT NOT NULL,actor TEXT NOT NULL,body TEXT NOT NULL);''')
    c.execute('INSERT OR IGNORE INTO settings VALUES(1,?)',(json.dumps(DEFAULTS),));c.commit()
    return c
def settings(c):return json.loads(c.execute('SELECT body FROM settings WHERE id=1').fetchone()[0])
def now_utc():return datetime.now(timezone.utc)
def save_settings(payload,actor):
    if set(payload)-set(DEFAULTS):raise ValueError('Unknown setting')
    with connect() as c:
        value={**settings(c),**payload}
        if type(value['enabled']) is not bool:raise ValueError('enabled must be true or false')
        if not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d',str(value['time'])):raise ValueError('Use HH:MM')
        if value['timezone']!='America/New_York':raise ValueError('Daily schedule uses Eastern time')
        if value['readingTimezone'] not in ('America/Winnipeg','America/New_York'):raise ValueError('Choose Central or Eastern water-reading time')
        if type(value['retryMinutes']) is not int or value['retryMinutes'] not in (0,30,60,120):raise ValueError('Retry interval must be 0, 30, 60 or 120 minutes')
        if value['enabled'] and not config().get('template'):raise ValueError('Configure the local report template first')
        c.execute('UPDATE settings SET body=? WHERE id=1',(json.dumps(value),))
        c.execute('INSERT INTO audit VALUES(?,?,?)',(now_utc().isoformat(),actor,json.dumps(value)))
    return value
def schedule_slot(value,now):
    local=now.astimezone(ZoneInfo(value['timezone']));hh,mm=map(int,value['time'].split(':'))
    start=local.replace(hour=hh,minute=mm,second=0,microsecond=0)
    if not value['enabled'] or local<start:return None
    # One catch-up draft after downtime; later hourly retries stop at noon Eastern.
    elapsed=int((local-start).total_seconds()//60)
    index=elapsed//value['retryMinutes'] if value['retryMinutes'] and local.hour<12 else 0
    return f'{local.date()}:{index}'
def enqueue(actor,slot=None,now=None):
    now=now or now_utc();cfg=config()
    if not cfg.get('template'):raise ValueError('Report template is not configured')
    with connect() as c:
        c.execute('BEGIN IMMEDIATE')
        if slot:
            existing=c.execute('SELECT * FROM runs WHERE slot=?',(slot,)).fetchone()
            if existing:return dict(existing)
        active=c.execute("SELECT * FROM runs WHERE state IN ('queued','running') ORDER BY created LIMIT 1").fetchone()
        if active:return dict(active)
        last=c.execute('SELECT created FROM runs ORDER BY created DESC LIMIT 1').fetchone()
        if last and (now-datetime.fromisoformat(last[0])).total_seconds()<120:raise ValueError('Please wait two minutes between refreshes')
        value=settings(c);rid=uuid.uuid4().hex;day=now.astimezone(ZoneInfo(value['timezone'])).date().isoformat()
        c.execute('INSERT INTO runs(id,created,day,state,actor,slot,settings) VALUES(?,?,?,?,?,?,?)',
                  (rid,now.isoformat(),day,'queued',actor,slot,json.dumps(value)))
        return dict(c.execute('SELECT * FROM runs WHERE id=?',(rid,)).fetchone())
def run_dir(rid):
    if not re.fullmatch('[a-f0-9]{32}',str(rid)):raise LookupError('Unknown report run')
    return home()/'runs'/rid
def write_json(path,value):
    temp=path.with_suffix('.tmp');temp.write_text(json.dumps(value,indent=2,ensure_ascii=False),encoding='utf-8');temp.replace(path)
def cooldown_fetch(url):
    """Honor a provider's Retry-After across fields, manual runs and service restarts."""
    path=home()/'provider-cooldowns.json'
    cooldowns=json.loads(path.read_text()) if path.exists() else {}
    host=urlsplit(url).netloc;now=time.time()
    if cooldowns.get(host,0)>now:raise sources.water.SourceError('Provider cooldown is active; retry later')
    try:return sources.water.download(url)
    except sources.water.SourceError as exc:
        if exc.retry_seconds:
            cooldowns[host]=now+exc.retry_seconds;write_json(path,cooldowns)
        raise
def prepare(row):
    cfg=config();directory=run_dir(row['id']);directory.mkdir(parents=True,exist_ok=True)
    snapshot=json.loads(row['settings']);template=Path(cfg['template'])
    # Snapshot the template bytes once so a concurrent Excel save cannot change the draft mid-run.
    template_copy=directory/'template.private.xlsm';template_copy.write_bytes(template.read_bytes())
    targets=workbook.inspect_template(template_copy)
    fields=sources.collect(row['day'],snapshot['readingTimezone'],fetch=cooldown_fetch)
    write_json(directory/'inputs.json',fields)
    with (directory/'inputs.csv').open('w',newline='',encoding='utf-8-sig') as f:
        cols=['cell','label','station','value','unit','status','observedAt','sourceDate','requestedAt','receivedAt','ageMinutes','ageDays','stale','periodNote','sourceUrl','mappingNote','message']
        writer=csv.DictWriter(f,fieldnames=cols,extrasaction='ignore');writer.writeheader();writer.writerows(fields['fields'])
    write_json(directory/'capture-input.private.json',dict(targets=targets,output=str(directory)))
    env=os.environ.copy()
    if cfg.get('playwrightModule'):env['NORTHSTAR_PLAYWRIGHT_MODULE']=cfg['playwrightModule']
    env['NORTHSTAR_BROWSER_CHANNEL']=cfg.get('browserChannel','msedge')
    subprocess.run([cfg.get('node','node'),str(ROOT/'scripts'/'capture-daily-report.cjs'),str(directory/'capture-input.private.json')],
                   env=env,cwd=ROOT,check=True,timeout=600,capture_output=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    captures=json.loads((directory/'captures.json').read_text(encoding='utf-8'))
    proof=workbook.refresh(template_copy,directory/'report-images-only.xlsm',{r['id']:directory/r['file'] for r in captures})
    write_json(directory/'verification.json',proof)
    return 'ready' if all(r['status']=='captured' for r in captures) and all(f['status'] in ('collected','trace') for f in fields['fields']) else 'partial'
def work_once():
    if not _worker_lock.acquire(blocking=False):return False
    try:
        with connect() as c:
            c.execute('BEGIN IMMEDIATE')
            row=c.execute("SELECT * FROM runs WHERE state='queued' ORDER BY created LIMIT 1").fetchone()
            if not row:return False
            c.execute("UPDATE runs SET state='running' WHERE id=?",(row['id'],));row=dict(row)
        try:state=prepare(row);error=None
        except Exception as exc:
            state='failed';error=f'{type(exc).__name__}: preparation failed; check template, public sources and browser runtime'
        with connect() as c:c.execute('UPDATE runs SET state=?,finished=?,error=? WHERE id=?',(state,now_utc().isoformat(),error,row['id']))
        return True
    finally:_worker_lock.release()
def scheduler_loop():
    # The single backend owns the worker. Interrupted jobs are visible and retried as a new run.
    with connect() as c:c.execute("UPDATE runs SET state='interrupted',error='Backend restarted during preparation' WHERE state='running'")
    while True:
        services.wait_turn('daily-report',20)
        try:
            with connect() as c:value=settings(c)
            slot=schedule_slot(value,now_utc())
            if slot:enqueue('daily-report-scheduler',slot)
            work_once()
        except Exception as exc:print('Daily report worker:',type(exc).__name__)
        time.sleep(0.1)
def detail(rid):
    directory=run_dir(rid)
    with connect() as c:row=c.execute('SELECT * FROM runs WHERE id=?',(rid,)).fetchone()
    if not row:raise LookupError('Unknown report run')
    item=dict(row);item.pop('settings');item['files']=[]
    for name,key in [('inputs.json','inputs'),('captures.json','captures'),('verification.json','verification')]:
        p=directory/name
        if p.exists():
            try:item[key]=json.loads(p.read_text(encoding='utf-8'))
            except (ValueError,OSError):pass
    for name in ('inputs.csv','inputs.json','report-images-only.xlsm','verification.json'):
        if (directory/name).exists() and (name!='report-images-only.xlsm' or item['state'] in ('ready','partial')):item['files'].append(name)
    return item
def download(rid,name):
    item=detail(rid)
    allowed=item['files']+[r['file'] for r in item.get('captures',[])]
    if name not in allowed or '/' in name or '\\' in name:raise LookupError('Unknown report file')
    path=run_dir(rid)/name
    if not path.is_file():raise LookupError('File is unavailable')
    return path
def request(method,path,params,payload,actor):
    route=path.removeprefix('/api/daily-report/')
    if method=='GET' and route=='status':
        with connect() as c:
            value=settings(c);rows=[dict(r) for r in c.execute('SELECT id,created,day,state,finished,error FROM runs ORDER BY created DESC LIMIT 30')]
        cfg=config()
        return dict(settings=value,configured=bool(cfg.get('template')),template=Path(cfg.get('template','')).name,runs=rows,
                    limitation='Images-only report draft. Operating figures and report date remain from the template; review before distribution. Public inputs are a separate review draft. No email is sent.')
    if method=='GET' and route=='run':return detail(params.get('id',''))
    if method=='POST' and route=='settings':return save_settings(payload,actor)
    if method=='POST' and route=='refresh':return enqueue(actor)
    raise LookupError('Unknown daily report endpoint')
