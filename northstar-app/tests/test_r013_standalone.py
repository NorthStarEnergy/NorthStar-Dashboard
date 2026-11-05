"""Real HTTP smoke test of the standalone delivery, without operational imports."""
import json
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT=Path(__file__).resolve().parents[1]


class R013StandaloneTests(unittest.TestCase):
    def test_http_assets_session_and_local_boundary(self):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        with tempfile.TemporaryDirectory() as tmp:
            proc=subprocess.Popen([sys.executable,str(ROOT/'scripts/run-switching-trainer.py'),
                '--port',str(port),'--data-root',tmp],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            base=f'http://127.0.0.1:{port}'
            try:
                deadline=time.monotonic()+10
                while True:
                    try:
                        with urlopen(base+'/',timeout=1) as response:html=response.read().decode()
                        break
                    except URLError:
                        if time.monotonic()>deadline or proc.poll() is not None:raise
                        time.sleep(.05)
                self.assertIn('r013-trainer.js',html)
                for asset,needle in [('r013-trainer.js',b'window.R013Trainer'),('trainer-assets/r013/runtime.svg',b'data-device="IS-G1"')]:
                    with urlopen(base+'/'+asset) as response:self.assertIn(needle,response.read())
                payload=json.dumps(dict(modelId='SIM-IS-TW-IR-R013',scenarioId='R013-T9-LOSS')).encode()
                with urlopen(Request(base+'/api/training/switching/sessions',data=payload,headers={'Content-Type':'application/json'})) as response:
                    self.assertEqual(response.status,201);snapshot=json.load(response)
                self.assertEqual(snapshot['electrical']['nodes']['TF-B1']['voltageKVLL'],0)
                self.assertGreater(snapshot['electrical']['nodes']['IS-B1']['voltageKVLL'],12)
                for path,headers in [('/',{'Origin':'https://untrusted.example'}),('/',{'X-Forwarded-Host':'example.com'}),('/northstar_sim/fixtures/is-tw-ir-r013.model.json',{})]:
                    with self.assertRaises(HTTPError) as caught:urlopen(Request(base+path,headers=headers))
                    self.assertEqual(caught.exception.code,404 if not headers else 403)
            finally:
                proc.terminate();proc.wait(timeout=10)
