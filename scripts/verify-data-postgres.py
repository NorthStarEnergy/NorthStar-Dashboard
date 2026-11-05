"""Local verification: empty production backup/restore and disposable scale fixture."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid
import psycopg
from psycopg import sql
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import northstar_data_workspace as ws

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,required=True)
    parser.add_argument('--report',type=Path,required=True)
    parser.add_argument('--scale-rows',type=int,default=1000000)
    args=parser.parse_args()
    if not 1<=args.scale_rows<=2000000:parser.error('Scale rows must be 1–2,000,000')
    root=args.root.resolve();private=root/'data/postgres-runtime'
    admin=json.loads((private/'admin.json').read_text())
    app=json.loads((root/'data/.northstar-data-postgres.json').read_text())
    runtime=json.loads((private/'runtime.json').read_text())
    report={'engine':'PostgreSQL','syntheticRows':args.scale_rows,'productionImportedRows':0}
    with ws.connect(app) as c:
        report['productionCounts']={name:c.execute(f'SELECT count(*) AS n FROM "{name}"').fetchone()['n'] for name in ws.DATASETS}
    if any(report['productionCounts'].values()):raise RuntimeError('This empty-install verifier refuses a populated operating database')
    created=[]
    def temporary():
        name='ns_test_'+uuid.uuid4().hex
        with psycopg.connect(**admin,autocommit=True) as c:c.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
        created.append(name)
        return {**admin,'dbname':name}
    try:
        test=temporary();ws.initialize(test)
        with ws.connect(test) as c:
            c.execute("SET LOCAL statement_timeout TO '180s'")
            c.execute('''INSERT INTO power(_id,_actor,site,equipment,observed_at,power_mw,interval_hours)
              SELECT gen_random_uuid(),'synthetic-verification','Fixture '||(n%%50),'Test G1',
                '2026-01-01'::timestamptz+n*interval '1 second',(n%%100)*0.5,1
              FROM generate_series(1,%s) AS n''',(args.scale_rows,))
            c.execute('ANALYZE power')
        original=ws.config;ws.config=lambda:test
        try:
            payload={'filters':[{'field':'site','op':'eq','value':'Fixture 1'}],'sort':'observed_at','direction':'asc','limit':100}
            started=time.perf_counter();result=ws.query_rows('power',payload);report['filteredPageMs']=round((time.perf_counter()-started)*1000,2)
            assert len(result['rows'])==min(100,args.scale_rows//50+(args.scale_rows%50>=1))
            started=time.perf_counter();chart=ws.chart('power',{**payload,'group':'observed_at','metric':'power_mw','aggregate':'avg','bucket':'day'});report['filteredChartMs']=round((time.perf_counter()-started)*1000,2)
            assert sum(p['n'] for p in chart['points'])==args.scale_rows//50+(args.scale_rows%50>=1)
            report['chartGroups']=len(chart['points'])
        finally:ws.config=original
        backup=subprocess.run([sys.executable,str(Path(__file__).with_name('backup-data-postgres.py')),'--root',str(root)],capture_output=True,text=True,check=True).stdout.strip()
        dump=Path(backup)
        if not dump.is_file() or not dump.resolve().is_relative_to(private.resolve()):raise RuntimeError('Unexpected backup path')
        restore=temporary();env={**os.environ,'PGPASSWORD':admin['password']}
        binary=Path(runtime['bin'])/('pg_restore.exe' if os.name=='nt' else 'pg_restore')
        command=[str(binary),'-h',admin['host'],'-p',str(admin['port']),'-U',admin['user'],'-d',restore['dbname'],'--no-owner','--exit-on-error',str(dump)]
        restored=subprocess.run(command,env=env,capture_output=True,text=True)
        if restored.returncode:raise RuntimeError('Disposable backup restore failed')
        with ws.connect(restore) as c:
            counts={name:c.execute(f'SELECT count(*) AS n FROM "{name}"').fetchone()['n'] for name in ws.DATASETS}
        assert counts==report['productionCounts']
        report.update(backupRestore='passed',backupBytes=dump.stat().st_size,disposableDatabasesRemoved=True)
    finally:
        with psycopg.connect(**admin,autocommit=True) as c:
            for name in created:
                assert name.startswith('ns_test_')
                c.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))
    args.report.parent.mkdir(parents=True,exist_ok=True)
    args.report.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report))

if __name__=='__main__':main()
