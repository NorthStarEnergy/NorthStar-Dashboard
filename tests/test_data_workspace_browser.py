"""Opt-in rendered integration with a disposable database and real HTTP API."""
import os
from pathlib import Path
import subprocess
import pytest
import test_demo_auth as support
from test_data_workspace import pg_settings, pg

@pytest.mark.skipif(os.environ.get('NORTHSTAR_DATA_BROWSER')!='1',reason='Opt-in rendered PostgreSQL integration')
def test_workspace_rendered(pg):
    case=support.DemoAuthTest();case.setUp()
    try:
        cookie=case.session_cookie()
        case.backend.OPERATOR_HOST='127.0.0.1'
        case.backend.CHECKIN_ORIGIN='http://checkin.test.invalid'
        env={**os.environ,'NORTHSTAR_DATA_TEST_URL':case.base,'NORTHSTAR_DATA_TEST_COOKIE':cookie}
        result=subprocess.run(['node',str(Path(__file__).with_name('data-workspace.browser.cjs'))],env=env,capture_output=True,text=True,timeout=120)
        assert result.returncode==0,result.stdout+'\n'+result.stderr
        print(result.stdout)
    finally:case.tearDown()

