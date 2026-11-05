import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_agent_compiles():
    result = subprocess.run([sys.executable, "-m", "py_compile", "control_center_agent.py"], cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_agent_contract_documents_fail_closed_actions():
    source = (ROOT / "control_center_agent.py").read_text(encoding="utf-8")
    assert '"backup": False' in source
    assert '"update": False' in source
    assert '"rollback": False' in source
    assert 'Bearer {TOKEN}' in source
