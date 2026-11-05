"""Create a local custom-format PostgreSQL backup without putting secrets in arguments."""
import argparse
import json
import os
from pathlib import Path
import subprocess
from datetime import datetime,timezone

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root',type=Path,default=ROOT)
args=parser.parse_args();root=args.root.resolve()
settings=json.loads((root/'data/.northstar-data-postgres.json').read_text())
runtime=json.loads((root/'data/postgres-runtime/runtime.json').read_text())
dest=root/'data/postgres-runtime/backups';dest.mkdir(exist_ok=True)
path=dest/('northstar-data-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.dump')
if path.exists():raise SystemExit('Backup name already exists; retry in one second')
env=os.environ.copy();env['PGPASSWORD']=settings['password']
exe=Path(runtime['bin'])/('pg_dump.exe' if os.name=='nt' else 'pg_dump')
result=subprocess.run([str(exe),'-h',settings['host'],'-p',str(settings['port']),'-U',settings['user'],'-d',settings['dbname'],'-Fc','-f',str(path)],env=env,capture_output=True,text=True,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
if result.returncode:
    path.unlink(missing_ok=True)
    raise SystemExit('Database backup failed; inspect the local PostgreSQL service')
print(str(path))
