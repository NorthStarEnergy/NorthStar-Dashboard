"""Run the synthetic trainer locally, without operational backend imports or feeds."""
from __future__ import annotations

import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from northstar_sim.service import SimulatorService


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=43190)
    parser.add_argument("--data-root", type=Path, required=True, help="Dedicated simulator storage directory")
    args = parser.parse_args()
    service = SimulatorService(args.data_root, local_instructor=True)

    class Handler(BaseHTTPRequestHandler):
        def respond(self, status, body, content_type="application/json"):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def handle_request(self):
            host = self.headers.get("Host", "")
            local = host in {f"127.0.0.1:{args.port}", f"localhost:{args.port}"}
            forwarded = any(self.headers.get(name) for name in ("Forwarded", "X-Forwarded-For", "X-Forwarded-Host", "Cf-Ray", "Cf-Connecting-Ip"))
            if not local or forwarded or self.headers.get("Origin", f"http://{host}") != f"http://{host}":
                self.respond(403, b'{"message":"Direct local requests only"}')
                return
            path = urlsplit(self.path).path
            if path.startswith("/api/training/switching"):
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 <= length <= 65536:
                        raise ValueError("Request body too large")
                    body = json.loads(self.rfile.read(length)) if length else None
                    if body is not None and not isinstance(body, dict):
                        raise ValueError("Expected JSON object")
                    status, result = service.handle(self.command, self.path, body, "local-trainer", instructor_access=True)
                    self.respond(status, json.dumps(result, allow_nan=False).encode())
                except (ValueError, TypeError) as exc:
                    self.respond(400, json.dumps({"message": str(exc)}).encode())
                return
            if self.command != "GET":
                self.respond(405, b'{}')
            elif path == "/":
                html = (ROOT / "northstar-clean.html").read_text(encoding="utf-8")
                start = html.index('<section id="training"')
                end = html.index('\n    </section>', start) + len('\n    </section>')
                page = ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
                        '<title>Twin Falls / Iroquois Trainer — NorthStar</title><link rel="stylesheet" href="/switching-simulator.css"><link rel="stylesheet" href="/complex-trainer.css">'
                        '<style>body{margin:0;background:#0e1720;font:14px system-ui}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #e7ad34} [hidden]{display:none!important}</style>'
                        '</head><body>' + html[start:end] + '<script src="/complex-trainer.js"></script><script src="/switching-simulator.js"></script></body></html>')
                self.respond(200, page.encode(), "text/html; charset=utf-8")
            elif path in {"/switching-simulator.js", "/switching-simulator.css", "/complex-trainer.js", "/complex-trainer.css"}:
                self.respond(200, (ROOT / path[1:]).read_bytes(), "text/javascript; charset=utf-8" if path.endswith(".js") else "text/css; charset=utf-8")
            elif path in {"/trainer-assets/h2o-native-bases.zip", "/trainer-assets/h2o-controls-reference.json"}:
                asset = ROOT / path[1:]
                if not asset.is_file():
                    self.respond(404, b'{"message":"Native bases are supplied in the local trainer delivery archive"}')
                else:
                    self.respond(200, asset.read_bytes(), "application/zip" if path.endswith('.zip') else "application/json")
            else:
                self.respond(404, b'{}')

        do_GET = handle_request
        do_POST = handle_request

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Synthetic trainer: http://127.0.0.1:{args.port}/ — dedicated store: {args.data_root}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
