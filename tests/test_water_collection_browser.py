"""Rendered schedule and run-now controls use a temporary authenticated server."""
import os
from pathlib import Path
import subprocess
import pytest
import test_demo_auth as support
import northstar_water_collection as water
from test_water_collection import pg_settings, collected, sample_point

@pytest.mark.skipif(os.environ.get('NORTHSTAR_DATA_BROWSER')!='1',reason='Opt-in PostgreSQL browser integration')
def test_public_water_controls(collected,monkeypatch):
    monkeypatch.setattr(water,'collect_station',lambda *args,**kwargs:[sample_point()])
    case=support.DemoAuthTest();case.setUp()
    try:
        cookie=case.session_cookie();case.backend.OPERATOR_HOST='127.0.0.1';case.backend.CHECKIN_ORIGIN='http://checkin.test.invalid'
        result=subprocess.run(['node',str(Path(__file__).with_name('water-collection.browser.cjs'))],
            env={**os.environ,'NORTHSTAR_DATA_TEST_URL':case.base,'NORTHSTAR_DATA_TEST_COOKIE':cookie},capture_output=True,text=True,timeout=100)
        assert result.returncode==0,result.stdout+'\n'+result.stderr
        print(result.stdout)
    finally:case.tearDown()

