"""Run the hidden Games service with usable output streams and startup diagnostics."""
from pathlib import Path
import os
import runpy
import sys

root = Path(__file__).resolve().parent
os.chdir(root)
log = root / 'outputs' / 'games-service.log'
log.parent.mkdir(parents=True, exist_ok=True)
if log.exists() and log.stat().st_size > 2_000_000:
    log.replace(log.with_suffix('.previous.log'))
stream = log.open('a', encoding='utf-8', buffering=1)
sys.stdout = sys.stderr = stream
print('Starting NorthStar Games service', flush=True)
sys.path.insert(0, str(root))
runpy.run_module('poker_study.web', run_name='__main__')
