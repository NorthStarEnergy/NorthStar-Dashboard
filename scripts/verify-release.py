"""Exercise committed runtime source in disposable storage, never the live database."""
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ROUTES = ('/api/outages', '/api/uwpc', '/api/sites', '/api/library',
          '/api/maximo', '/api/chat/rooms', '/api/chat/status',
          '/api/dispatch/apiroq', '/api/readiness', '/api/assets', '/api/schematics')


def main():
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    archive = subprocess.check_output(['git', 'archive', '--format=zip', revision], cwd=ROOT)
    with tempfile.TemporaryDirectory(prefix='northstar-release-') as directory:
        target = Path(directory)
        with zipfile.ZipFile(io.BytesIO(archive)) as source:
            source.extractall(target)
        if (target / '.env.local').exists() or (target / 'data').exists():
            raise RuntimeError('Release archive contains private configuration or operational data')
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        # Explicit environment allowlist prevents inherited credentials and integration paths.
        env = {key: value for key, value in os.environ.items()
               if key.upper() in {'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'LANG'}}
        env.update(NORTHSTAR_PORT=str(port), NORTHSTAR_BIND_HOST='127.0.0.1',
                   NORTHSTAR_OPERATOR_GATE='access', NORTHSTAR_OPERATOR_HOST='ops.example.test',
                   NORTHSTAR_CHECKIN_ORIGIN='https://checkin.example.test',
                   NORTHSTAR_ALLOWED_ORIGIN='https://ops.example.test',
                   NORTHSTAR_DB=str(target / 'data' / 'smoke.db'))
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

        def request(path, host='ops.example.test', assertion=None):
            headers = {'Host': host}
            if assertion:
                headers['Cf-Access-Jwt-Assertion'] = assertion
            req = urllib.request.Request(f'http://127.0.0.1:{port}{path}', headers=headers)
            try:
                with opener.open(req, timeout=3) as response:
                    return response.status, response.read()
            except urllib.error.HTTPError as error:
                return error.code, error.read()

        with (target / 'smoke.log').open('w') as log:
            process = subprocess.Popen([sys.executable, 'ieso_backend.py'], cwd=target,
                                       env=env, stdout=log, stderr=log)
            try:
                deadline = time.monotonic() + 30
                while True:
                    if process.poll() is not None:
                        raise RuntimeError('Isolated backend exited during startup')
                    try:
                        status, body = request('/api/health')
                        if status == 200 and json.loads(body)['database']['ok']:
                            break
                    except (OSError, ValueError, KeyError):
                        pass
                    if time.monotonic() >= deadline:
                        raise RuntimeError('Isolated backend readiness timed out')
                    time.sleep(.2)
                checks = 0
                for route in ROUTES:
                    assert request(route)[0] == 403, f'Anonymous operator access: {route}'
                    assert request(route, 'checkin.example.test', 'forged')[0] == 403, route
                    status, body = request(route, assertion='local-smoke-only')
                    assert status == 200, (route, status)
                    json.loads(body)
                    checks += 3
                for route in ('/.env.local', '/data/smoke.db', '/ieso_backend.py'):
                    assert request(route, assertion='local-smoke-only')[0] in (403, 404), route
                    checks += 1
                assert request('/northstar-clean.html', assertion='local-smoke-only')[0] == 200
                assert request('/northstar-clean.html', 'checkin.example.test')[0] == 404
                checks += 2
                print(f'PASS: {checks} isolated HTTP checks; source {revision}')
                print('Synthetic Access header exercises origin routing only; it does not validate edge JWT authentication.')
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)


if __name__ == '__main__':
    main()
