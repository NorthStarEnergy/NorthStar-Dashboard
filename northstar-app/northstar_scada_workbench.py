"""Ryan-only gateway to the local S+ Workbench. No browser receives its token."""
from __future__ import annotations
import json
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

PREFIX = '/scada-workbench'
ACCESS_FILE = Path.home() / 'OneDrive' / 'Documents' / 'ChatGPT' / 'SCADA' / 'scada-workbench' / 'data' / 'access.json'
BASE = 'http://127.0.0.1:4310'
MAX_BODY = 32 * 1024 * 1024


def handle(handler):
    route = urlsplit(handler.path)
    if route.path != PREFIX and not route.path.startswith(PREFIX + '/'):
        return False
    # The authenticated server-side session is required even if the general gate
    # is off or Access headers are present; never trust client-supplied identity.
    if not handler._is_operator_host() or (handler._demo_actor() or '').casefold() != 'ryan' or handler._demo_role() != 'operator':
        handler.send_error(403, 'Workbench access denied')
        return True
    if handler.command not in ('GET', 'POST'):
        handler.send_error(405)
        return True
    if handler.command == 'POST' and (handler.headers.get('Origin', '').lower() != 'https://ops.northstarenergy.ca' or handler._cross_origin_write()):
        handler.send_error(403, 'Cross-origin request refused')
        return True
    relative = route.path[len(PREFIX):] or '/'
    if relative == '/':
        relative = '/index.html'
    if not (relative in ('/index.html', '/app.js', '/style.css', '/manager.html', '/manager.js', '/manager.css') or relative.startswith('/api/')):
        handler.send_error(404)
        return True
    if handler.command == 'POST' and not relative.startswith('/api/'):
        handler.send_error(405)
        return True
    try:
        length = int(handler.headers.get('Content-Length', '0'))
        if length < 0 or length > MAX_BODY:
            handler.send_error(413)
            return True
        if handler.headers.get('Transfer-Encoding'):
            handler.send_error(400)
            return True
        body = handler.rfile.read(length) if handler.command == 'POST' else None
        if body is not None and len(body) != length:
            handler.send_error(400)
            return True
        headers = {}
        if relative.startswith('/api/'):
            headers['Authorization'] = 'Bearer ' + json.loads(ACCESS_FILE.read_text(encoding='utf-8-sig'))['dashboard']
        if body is not None:
            headers['Content-Type'] = handler.headers.get('Content-Type', 'application/json')
        management = relative in ('/manager.html', '/manager.js', '/manager.css', '/api/manager', '/api/manager/receipt')
        target = ('http://127.0.0.1:4311' if management else BASE) + relative + (('?' + route.query) if route.query else '')
        request = Request(target, data=body, headers=headers, method=handler.command)
        try:
            response = urlopen(request, timeout=30)
        except HTTPError as exc:
            response = exc
        with response:
            data = response.read()
            content_type = response.headers.get('Content-Type', 'application/octet-stream')
            if relative == '/api/library/file' and not content_type.lower().startswith(('image/png', 'image/jpeg', 'text/plain', 'application/json')):
                content_type = 'application/octet-stream'
            if response.status == 200 and relative == '/index.html':
                text = data.decode('utf-8').replace('href="/style.css"', 'href="/scada-workbench/style.css"').replace('src="/app.js"', 'src="/scada-workbench/app.js"')
                data = text.encode('utf-8')
            elif response.status == 200 and relative == '/app.js':
                text = data.decode('utf-8').replace("fetch('/api/'+route", "fetch('/scada-workbench/api/'+route")
                marker = "if(location.hash)history.replaceState(null,'',location.pathname);"
                if marker not in text:
                    raise ValueError('Unsupported workbench client')
                text = text.replace(marker, marker + "\ntoken='northstar-session';")
                data = text.encode('utf-8')
            handler.send_response(response.status)
            handler.send_header('Content-Type', content_type)
            handler.send_header('Content-Length', str(len(data)))
            handler.send_header('Cache-Control', 'no-store')
            handler.send_header('X-Content-Type-Options', 'nosniff')
            handler.send_header('Content-Security-Policy', "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'")
            disposition = response.headers.get('Content-Disposition')
            if disposition and '\r' not in disposition and '\n' not in disposition:
                handler.send_header('Content-Disposition', disposition)
            handler.end_headers()
            handler.wfile.write(data)
    except (OSError, ValueError, KeyError, URLError):
        handler.send_error(503, 'Workbench unavailable')
    return True



