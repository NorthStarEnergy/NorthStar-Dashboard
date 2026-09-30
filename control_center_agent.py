"""Narrow NorthStar management agent.

Run on the managed machine, preferably behind an authenticated private proxy.
It intentionally does not accept arbitrary shell commands or update packages.
"""
from __future__ import annotations

import json
import os
import secrets
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("NORTHSTAR_AGENT_PORT", "4190"))
TOKEN = os.environ.get("NORTHSTAR_AGENT_TOKEN", "").strip()
HEALTH_URL = os.environ.get("NORTHSTAR_AGENT_HEALTH_URL", "http://127.0.0.1:4180/api/health")
START_SCRIPT = ROOT / "start-northstar.ps1"
STARTED_AT = time.time()


def health() -> dict:
    try:
        with urlopen(HEALTH_URL, timeout=2) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return {"reachable": True, "healthy": bool(payload.get("database", {}).get("ok")), "payload": payload}
    except Exception as exc:
        return {"reachable": False, "healthy": False, "error": type(exc).__name__}


def action_restart() -> dict:
    if not START_SCRIPT.is_file():
        return {"ok": False, "error": "start script unavailable"}
    subprocess.Popen(
        ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(START_SCRIPT), "-NoBrowser"],
        cwd=ROOT,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    return {"ok": True, "operation": "restart", "accepted": True}


class AgentHandler(BaseHTTPRequestHandler):
    server_version = "NorthStarControlAgent/1"

    def log_message(self, *_args):
        return

    def send_json(self, payload: dict, status: int = 200):
        body = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def authorized(self) -> bool:
        supplied = self.headers.get("Authorization", "")
        return bool(TOKEN) and secrets.compare_digest(supplied, f"Bearer {TOKEN}")

    def do_GET(self):
        if not self.authorized():
            self.send_json({"error": "authentication required"}, 401)
            return
        if self.path.split("?", 1)[0] == "/v1/status":
            self.send_json({"apiVersion": "agent.v1", "service": "northstar", "uptimeSeconds": round(time.time() - STARTED_AT), "health": health(), "capabilities": {"status": True, "restart": True, "launch": True, "stop": False, "backup": False, "update": False, "rollback": False}})
            return
        self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        if not self.authorized():
            self.send_json({"error": "authentication required"}, 401)
            return
        if self.path.split("?", 1)[0] == "/v1/actions/restart":
            self.send_json(action_restart(), 202)
            return
        self.send_json({"error": "action unavailable"}, 403)


def main() -> None:
    if not TOKEN:
        raise SystemExit("NORTHSTAR_AGENT_TOKEN must be configured")
    server = ThreadingHTTPServer(("127.0.0.1", PORT), AgentHandler)
    print(f"NorthStar control agent listening on 127.0.0.1:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
