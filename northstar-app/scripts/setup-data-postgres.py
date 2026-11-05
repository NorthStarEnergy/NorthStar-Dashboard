"""Provision an empty, local PostgreSQL data workspace using installed binaries."""
from __future__ import annotations
import argparse
import getpass
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import northstar_data_workspace as workspace
import northstar_water_collection as water_collection

def run(args):
    result=subprocess.run([str(a) for a in args],capture_output=True,text=True,
                          creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    if result.returncode:
        # These commands contain no password values; initdb uses a private password file.
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or 'PostgreSQL command failed')
    return result.stdout

def protect(path,directory=False):
    if os.name=='nt':
        scope='(OI)(CI)F' if directory else 'F'
        run(['icacls',path,'/inheritance:r','/grant:r',getpass.getuser()+':'+scope,'*S-1-5-18:'+scope])
    else:path.chmod(0o700 if directory else 0o600)

def save_private(path,data):
    with path.open('x',encoding='utf-8') as f:json.dump(data,f,indent=2)
    protect(path)

def start(runtime):
    cluster=Path(runtime['cluster']);binary=Path(runtime['bin']);exe='.exe' if os.name=='nt' else ''
    result=subprocess.run([str(binary/('pg_ctl'+exe)),'-D',str(cluster),'status'],capture_output=True,
                          creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    if result.returncode:
        # A detached postmaster can retain pipe handles on Windows. Do not wait
        # for captured-pipe EOF after pg_ctl has already exited successfully.
        started=subprocess.run([str(binary/('pg_ctl'+exe)),'-D',str(cluster),'-l',str(cluster.parent/'postgres.log'),'-w','start'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=75,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        if started.returncode:raise RuntimeError('PostgreSQL failed to start; inspect its local postgres.log')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=ROOT)
    parser.add_argument('--bin',type=Path)
    parser.add_argument('--port',type=int,default=5433)
    parser.add_argument('--start-only',action='store_true')
    args=parser.parse_args();root=args.root.resolve();private=root/'data/postgres-runtime'
    private.mkdir(parents=True,exist_ok=True);protect(private,True)
    runtime_path=private/'runtime.json';app_path=root/'data/.northstar-data-postgres.json'
    if runtime_path.exists():
        runtime=json.loads(runtime_path.read_text());start(runtime)
        if args.start_only:print('NorthStar PostgreSQL is running on loopback.');return
        if not app_path.exists():raise RuntimeError('Runtime exists without app config; preserve it and repair setup explicitly')
        settings=json.loads(app_path.read_text())
    else:
        if args.start_only:print('PostgreSQL is not configured; existing dashboard can continue.');return
        if app_path.exists():raise RuntimeError('Refusing to replace existing PostgreSQL connection settings')
        binary=(args.bin or private/'pgsql/bin').resolve();exe='.exe' if os.name=='nt' else ''
        if not (binary/('initdb'+exe)).exists():raise RuntimeError('Install PostgreSQL binaries first and supply --bin')
        if not 1024<=args.port<=65535:raise ValueError('Choose a nonprivileged local port')
        cluster=private/'cluster'
        app_password=secrets.token_urlsafe(40)
        if cluster.exists():
            if not (private/'admin.json').exists():raise RuntimeError('Refusing to initialize an existing PostgreSQL cluster')
            admin=json.loads((private/'admin.json').read_text())
            if admin['host']!='127.0.0.1' or admin['port']!=args.port:raise RuntimeError('Existing cluster configuration differs; explicit repair required')
        else:
            with socket.socket() as probe:probe.bind(('127.0.0.1',args.port))
            admin_password=secrets.token_urlsafe(40)
            password_path=private/'bootstrap-password.tmp'
            with password_path.open('x',encoding='utf-8') as f:f.write(admin_password+'\n')
            protect(password_path)
            try:run([binary/('initdb'+exe),'-D',cluster,'-U','northstar_admin','--auth=scram-sha-256','--encoding=UTF8','--locale=C','--pwfile='+str(password_path)])
            finally:password_path.unlink(missing_ok=True)
            with (cluster/'postgresql.conf').open('a',encoding='utf-8') as f:
                f.write(f"\n# NorthStar data workspace\nlisten_addresses='127.0.0.1'\nport={args.port}\nmax_connections=40\nshared_buffers='128MB'\nlog_statement='none'\nlog_min_error_statement='panic'\n")
            admin=dict(host='127.0.0.1',port=args.port,dbname='postgres',user='northstar_admin',password=admin_password)
            save_private(private/'admin.json',admin)
        runtime=dict(bin=str(binary),cluster=str(cluster),port=args.port)
        settings=dict(host='127.0.0.1',port=args.port,dbname='northstar_data',user='northstar_data',password=app_password)
        save_private(app_path,settings);save_private(runtime_path,runtime)
        start(runtime)
    import psycopg
    from psycopg import sql
    admin=json.loads((private/'admin.json').read_text())
    with psycopg.connect(**admin,autocommit=True) as con:
        if not con.execute("SELECT 1 FROM pg_roles WHERE rolname='northstar_data'").fetchone():
            con.execute(sql.SQL('CREATE ROLE northstar_data LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD {}').format(sql.Literal(settings['password'])))
        if not con.execute("SELECT 1 FROM pg_database WHERE datname='northstar_data'").fetchone():
            con.execute('CREATE DATABASE northstar_data OWNER northstar_data')
        con.execute('REVOKE ALL ON DATABASE northstar_data FROM PUBLIC')
    workspace.initialize(settings)
    water_collection.initialize(settings)
    with workspace.connect(settings) as con:
        counts={key:con.execute(f'SELECT count(*) AS n FROM "{key}"').fetchone()['n'] for key in workspace.DATASETS}
    print(json.dumps(dict(engine='PostgreSQL',host=settings['host'],port=settings['port'],database=settings['dbname'],datasets=counts)))

if __name__=='__main__':main()
