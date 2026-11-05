import subprocess
import sys
from pathlib import Path


def test_release_status_mismatch_fails_even_with_optimization():
    result = subprocess.run(
        [sys.executable, '-O', '-c',
         "import runpy; m=runpy.run_path('scripts/verify-release.py'); "
         "m['require_status'](200, (403,), 'anonymous access')"],
        cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True,
    )
    assert result.returncode != 0
    assert 'expected (403,), got HTTP 200' in result.stderr
