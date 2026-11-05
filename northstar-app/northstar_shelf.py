"""Ryan's private Shelf. NorthStar owns authentication; no second login or daemon.

All UI, API, image, historical-version and download paths pass through the same
server-side identity check. Artifacts are never served by the static web root.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import posixpath
import re
import sqlite3
import threading
from urllib.parse import parse_qs, quote, unquote, urlsplit
import uuid

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get("NORTHSTAR_SHELF_DATA", str(ROOT / "data" / "shelf")))
MAX_BYTES = int(os.environ.get("NORTHSTAR_SHELF_MAX_MB", "90")) * 1024 * 1024
LOCK = threading.RLock()
RASTER = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
          ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif"}
ASSETS = {"index.html", "icon.svg", "mobile.js", "mobile.css", "manifest.webmanifest"}
ID = r"[a-f0-9-]{36}"


def route_path(raw):
    return posixpath.normpath(unquote(raw.split("?", 1)[0]).replace("\\", "/"))


def matches(raw):
    route = '/'.join(part.rstrip(' .').casefold() for part in route_path(raw).split('/'))
    return route in {"/shelf", "/api/shelf"} or route.startswith(("/shelf/", "/api/shelf/"))


def now():
    return datetime.now(timezone.utc).isoformat()


def text(value, limit=200):
    return str(value or "").strip()[:limit]


def digest(filename):
    h = hashlib.sha256()
    with open(filename, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


@contextmanager
def database():
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "files").mkdir(exist_ok=True)
    (DATA / "tmp").mkdir(exist_ok=True)
    db = sqlite3.connect(DATA / "shelf.sqlite", timeout=30)
    db.row_factory = sqlite3.Row
    try:
        db.execute("PRAGMA foreign_keys=ON")
        db.executescript("""
        CREATE TABLE IF NOT EXISTS items (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL,
          url TEXT, filename TEXT, mime TEXT, size INTEGER NOT NULL DEFAULT 0,
          collection TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0,
          created TEXT NOT NULL, updated TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS shelf_versions (
          id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
          sequence INTEGER NOT NULL, label TEXT NOT NULL, filename TEXT NOT NULL,
          mime TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL,
          created TEXT NOT NULL, UNIQUE(item_id, sequence));
        CREATE TABLE IF NOT EXISTS shelf_calendar (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, day TEXT NOT NULL,
          time TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS shelf_apps (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL DEFAULT '',
          item_id TEXT REFERENCES items(id) ON DELETE SET NULL);
        """)
        db.executemany('INSERT OR IGNORE INTO shelf_apps(id,name,url) VALUES (?,?,?)', [
            ('asd-connects','ASD Connects','https://common-ground-ontario.forceofnaturegenetics.chatgpt.site'), ('northstar','NorthStar','/northstar-clean.html'),
            ('northstar-games','NorthStar Games','https://games.northstarenergy.ca/'), ('mywords','MyWords','https://my-communication-aac.forceofnaturegenetics.chatgpt.site/'),
            ('fon-dashboard','FoN Dashboard',''), ('northstar-manager','NorthStar Manager','')])
        for app_id, url in [
            ('asd-connects','https://common-ground-ontario.forceofnaturegenetics.chatgpt.site'),
            ('northstar-games','https://games.northstarenergy.ca/'),
            ('mywords','https://my-communication-aac.forceofnaturegenetics.chatgpt.site/')]:
            db.execute("UPDATE shelf_apps SET url=? WHERE id=? AND url=''", (url, app_id))
        # Add historical records for original standalone uploads without moving bytes.
        for row in db.execute("SELECT * FROM items WHERE filename IS NOT NULL AND id NOT IN (SELECT item_id FROM shelf_versions)").fetchall():
            source = DATA / "files" / row["id"]
            if source.is_file():
                db.execute("INSERT INTO shelf_versions VALUES (?,?,?,?,?,?,?,?,?)",
                           (row["id"], row["id"], 1, "Initial upload", row["filename"], row["mime"] or "application/octet-stream", row["size"], digest(source), row["created"]))
        db.commit()
        with db:
            yield db
    finally:
        db.close()


def item_view(db, row):
    item = dict(row)
    item["archived"] = bool(item["archived"])
    latest = db.execute("SELECT * FROM shelf_versions WHERE item_id=? ORDER BY sequence DESC LIMIT 1", (item["id"],)).fetchone()
    item["version"] = latest["label"] if latest else None
    item["sha256"] = latest["sha256"] if latest else None
    item["versionCount"] = db.execute("SELECT COUNT(*) FROM shelf_versions WHERE item_id=?", (item["id"],)).fetchone()[0]
    item["download"] = "/api/shelf/files/" + item["id"] if item["filename"] else None
    item["preview"] = "/api/shelf/images/" + item["id"] if item["kind"] == "image" else None
    # Website bundles are archived downloads here, not executable same-origin apps.
    item["site"] = None
    return item


class ShelfError(Exception):
    def __init__(self, message, status=400):
        self.status = status
        super().__init__(message)


def send_json(handler, body, status=200):
    content = json.dumps(body).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(content)))
    handler.end_headers()
    if handler.command != "HEAD":
        handler.wfile.write(content)


def read_json(handler):
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except ValueError:
        raise ShelfError("Invalid request length")
    if length < 0 or length > 32768:
        raise ShelfError("Request metadata too large", 413)
    try:
        value = json.loads(handler.rfile.read(length))
    except (ValueError, UnicodeError):
        raise ShelfError("Invalid JSON")
    if not isinstance(value, dict):
        raise ShelfError("Expected a JSON object")
    return value


def send_file(handler, filename, mime, download_name=None, etag=None):
    if not filename.is_file():
        raise ShelfError("File not found", 404)
    size = filename.stat().st_size
    start, end, status = 0, size - 1, 200
    raw_range = handler.headers.get("Range")
    if raw_range and handler.headers.get("If-Range", etag) == etag:
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", raw_range)
        if not match or not any(match.groups()) or size == 0:
            handler.send_response(416)
            handler.send_header("Content-Range", f"bytes */{size}")
            handler.send_header("Content-Length", "0")
            handler.send_header("Cache-Control", "no-store")
            handler.end_headers()
            return
        a, b = match.groups()
        if not a:
            start = max(0, size - int(b))
        else:
            start, end = int(a), min(int(b) if b else size - 1, size - 1)
        if start > end or start >= size:
            handler.send_response(416)
            handler.send_header("Content-Range", f"bytes */{size}")
            handler.send_header("Content-Length", "0")
            handler.end_headers()
            return
        status = 206
    handler.send_response(status)
    handler.send_header("Content-Type", mime)
    handler.send_header("Content-Length", str(max(0, end - start + 1)))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Accept-Ranges", "bytes")
    if etag:
        handler.send_header("ETag", etag)
    if status == 206:
        handler.send_header("Content-Range", f"bytes {start}-{end}/{size}")
    if download_name:
        handler.send_header("Content-Disposition", "attachment; filename=\"download\"; filename*=UTF-8''" + quote(download_name, safe=""))
    handler.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
    handler.send_header("X-Frame-Options", "DENY")
    handler.end_headers()
    if handler.command == "HEAD":
        return
    with filename.open("rb") as stream:
        stream.seek(start)
        left = end - start + 1
        while left > 0:
            block = stream.read(min(left, 1024 * 1024))
            if not block:
                break
            handler.wfile.write(block)
            left -= len(block)


def upload(handler, parent_id=None):
    if handler.headers.get("Transfer-Encoding"):
        raise ShelfError("Send a file with a Content-Length header", 411)
    try:
        length = int(handler.headers.get("Content-Length", "-1"))
    except ValueError:
        raise ShelfError("Invalid upload length")
    if length < 0:
        raise ShelfError("Content-Length required", 411)
    if length > MAX_BYTES:
        raise ShelfError(f"File exceeds {MAX_BYTES // 1048576} MB upload limit", 413)
    query = {k: v[0] for k, v in parse_qs(urlsplit(handler.path).query).items()}
    filename = text(query.get("filename"), 240).replace("\\", "/").split("/")[-1]
    if not filename or any(ord(c) < 32 for c in filename):
        raise ShelfError("Choose a valid filename")
    with LOCK, database() as db:
        if parent_id:
            parent = db.execute("SELECT * FROM items WHERE id=?", (parent_id,)).fetchone()
            if not parent or not parent["filename"]:
                raise ShelfError("File item not found", 404)
    key = str(uuid.uuid4())
    item_id = parent_id or key
    temporary = DATA / "tmp" / key
    target = DATA / "files" / key
    sha = hashlib.sha256()
    try:
        old_timeout = handler.connection.gettimeout()
        handler.connection.settimeout(120)
        try:
            with temporary.open("xb") as stream:
                remaining = length
                while remaining:
                    block = handler.rfile.read(min(remaining, 1024 * 1024))
                    if not block:
                        raise ShelfError("Upload ended before all bytes arrived")
                    stream.write(block)
                    sha.update(block)
                    remaining -= len(block)
        finally:
            handler.connection.settimeout(old_timeout)
        mime = RASTER.get(Path(filename).suffix.lower(), "application/octet-stream")
        kind = "image" if mime.startswith("image/") else "file"
        with LOCK, database() as db:
            if parent_id and not db.execute("SELECT 1 FROM items WHERE id=?", (parent_id,)).fetchone():
                raise ShelfError("Item was deleted during upload", 409)
            sequence = db.execute("SELECT COALESCE(MAX(sequence),0)+1 FROM shelf_versions WHERE item_id=?", (item_id,)).fetchone()[0]
            label = text(query.get("version"), 80) or f"Version {sequence}"
            created = now()
            temporary.replace(target)
            if parent_id:
                db.execute("UPDATE items SET filename=?, mime=?, size=?, kind=?, updated=? WHERE id=?",
                           (filename, mime, length, kind, created, parent_id))
            else:
                db.execute("INSERT INTO items VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                           (key, text(query.get("title")) or filename, text(query.get("description"),2000), kind, None, filename, mime, length, text(query.get("collection"),80), 0, created, created))
            db.execute("INSERT INTO shelf_versions VALUES (?,?,?,?,?,?,?,?,?)", (key,item_id,sequence,label,filename,mime,length,sha.hexdigest(),created))
            result = item_view(db, db.execute("SELECT * FROM items WHERE id=?",(item_id,)).fetchone())
    except BaseException:
        temporary.unlink(missing_ok=True)
        target.unlink(missing_ok=True)
        raise
    send_json(handler, result, 201)


def handle(handler, gate, config):
    """Called after NorthStar's existing operator/hostname checks, on every verb."""
    import northstar_auth as auth
    actor = handler._demo_actor()
    account = auth.account(config, actor or "")
    # Never trust claimed names, headers, the off-mode fallback actor, or an
    # unverified Access identity. The configured live Ryan session is required.
    if gate != "demo" or not handler._is_operator_host() or not actor:
        if handler.command == "GET" and handler.headers.get("Sec-Fetch-Mode") == "navigate" and handler._is_operator_host():
            handler.send_response(302)
            handler.send_header("Location", "/operator-login.html")
            handler.send_header("Cache-Control", "no-store")
            handler.send_header("Content-Length", "0")
            handler.end_headers()
        else:
            send_json(handler, {"error":"NorthStar sign-in required"}, 401)
        return
    if actor.casefold() != "ryan" or handler._demo_role() != "operator" or not account or account.get("disabled") or auth.account_role(config, actor) != "operator":
        send_json(handler, {"error":"Shelf is available only to Ryan"}, 403)
        return
    try:
        if handler.command not in {"GET", "HEAD"}:
            origin = urlsplit(handler.headers.get("Origin", ""))
            expected = handler.headers.get("Host", "").lower()
            if origin.scheme not in {"http", "https"} or origin.netloc.lower() != expected or handler.headers.get("X-Shelf-Request") != "1":
                raise ShelfError("Cross-origin Shelf request refused", 403)
        dispatch(handler)
    except ShelfError as exc:
        handler.close_connection = True
        send_json(handler, {"error":str(exc)}, exc.status)
    except (BrokenPipeError, ConnectionResetError):
        handler.close_connection = True
    except Exception:
        handler.close_connection = True
        handler.log_error("Shelf operation failed; inspect file permissions and available disk space")
        send_json(handler, {"error":"Shelf operation failed. Check server storage and try again."}, 500)


def dispatch(h):
    route = route_path(h.path)
    method = "GET" if h.command == "HEAD" else h.command
    if route == "/shelf" and method == "GET":
        if not h.path.split("?",1)[0].endswith("/"):
            h.send_response(302); h.send_header("Location","/shelf/"); h.send_header("Content-Length","0"); h.end_headers(); return
        return send_file(h, ROOT / "shelf" / "index.html", "text/html; charset=utf-8")
    if route.startswith("/shelf/") and method == "GET":
        name = route.removeprefix("/shelf/")
        if name not in ASSETS:
            raise ShelfError("Not found",404)
        return send_file(h, ROOT / "shelf" / name, mimetypes.guess_type(name)[0] or "application/octet-stream")
    if route == "/api/shelf/session" and method == "GET":
        return send_json(h, {"authenticated":True,"username":"Ryan","platform":True,"maxUploadMB":MAX_BYTES//1048576})
    if route == "/api/shelf/uploads" and method == "POST":
        return upload(h)
    match = re.fullmatch(r"/api/shelf/items/("+ID+r")/versions",route)
    if match and method == "POST":
        return upload(h, match[1])
    with LOCK, database() as db:
        if route == '/api/shelf/calendar' and method == 'GET':
            return send_json(h, {'events':[dict(r) for r in db.execute('SELECT * FROM shelf_calendar ORDER BY day,time,created')]})
        if route == '/api/shelf/calendar' and method == 'POST':
            body = read_json(h)
            title, day, time = text(body.get('title')), text(body.get('day')), text(body.get('time'))
            try:
                datetime.strptime(day, '%Y-%m-%d')
                if time: datetime.strptime(time, '%H:%M')
            except ValueError:
                raise ShelfError('Choose a valid calendar date and time')
            if not title: raise ShelfError('Event title is required')
            event = {'id':str(uuid.uuid4()),'title':title,'day':day,'time':time,'notes':text(body.get('notes'),2000),'created':now()}
            db.execute('INSERT INTO shelf_calendar VALUES (?,?,?,?,?,?)', tuple(event.values()))
            return send_json(h,event,201)
        event_match = re.fullmatch(r'/api/shelf/calendar/('+ID+r')',route)
        if event_match and method == 'DELETE':
            db.execute('DELETE FROM shelf_calendar WHERE id=?',(event_match[1],))
            return send_json(h,{'ok':True})
        if route == '/api/shelf/apps' and method == 'GET':
            return send_json(h,{'apps':[dict(r) for r in db.execute('SELECT * FROM shelf_apps ORDER BY rowid')]})
        app_match = re.fullmatch(r'/api/shelf/apps/([a-z-]+)',route)
        if app_match and method == 'POST':
            body = read_json(h)
            row = db.execute('SELECT * FROM shelf_apps WHERE id=?',(app_match[1],)).fetchone()
            if not row: raise ShelfError('App not found',404)
            url = text(body.get('url',row['url']),4000)
            parsed = urlsplit(url)
            if url and not (url == '/northstar-clean.html' or (parsed.scheme in {'https','http'} and parsed.hostname and not parsed.username and not parsed.password)):
                raise ShelfError('Enter an HTTP or HTTPS app link')
            item_id = body.get('item_id',row['item_id'])
            if item_id and not db.execute('SELECT 1 FROM items WHERE id=? AND filename IS NOT NULL',(item_id,)).fetchone():
                raise ShelfError('App download not found',404)
            db.execute('UPDATE shelf_apps SET url=?,item_id=? WHERE id=?',(url,item_id or None,row['id']))
            return send_json(h,{'ok':True})
        if route == "/api/shelf/items" and method == "GET":
            rows = db.execute("SELECT * FROM items ORDER BY updated DESC").fetchall()
            storage = db.execute("SELECT COALESCE(SUM(size),0) FROM shelf_versions").fetchone()[0]
            return send_json(h, {"items":[item_view(db,r) for r in rows], "storage":storage})
        if route == "/api/shelf/links" and method == "POST":
            body = read_json(h); url = text(body.get("url"),4000); parsed = urlsplit(url)
            if parsed.scheme not in {"http","https"} or not parsed.hostname or parsed.username or parsed.password:
                raise ShelfError("Enter an HTTP or HTTPS link without embedded credentials")
            key, created = str(uuid.uuid4()), now()
            db.execute("INSERT INTO items VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",(key,text(body.get("title")) or parsed.hostname,text(body.get("description"),2000),"link",url,None,None,0,text(body.get("collection"),80),0,created,created))
            return send_json(h,item_view(db,db.execute("SELECT * FROM items WHERE id=?",(key,)).fetchone()),201)
        if match and method == "GET":
            rows=db.execute("SELECT * FROM shelf_versions WHERE item_id=? ORDER BY sequence DESC",(match[1],)).fetchall()
            return send_json(h,{"versions":[dict(r,download="/api/shelf/versions/"+r["id"]+"/download") for r in rows]})
        artifact = re.fullmatch(r"/api/shelf/(files|images)/("+ID+r")",route)
        version = re.fullmatch(r"/api/shelf/versions/("+ID+r")/download",route)
        if method == "GET" and (artifact or version):
            row = db.execute("SELECT * FROM shelf_versions WHERE " + ("item_id=? ORDER BY sequence DESC LIMIT 1" if artifact else "id=?"),((artifact[2] if artifact else version[1]),)).fetchone()
            if not row:
                raise ShelfError("File not found",404)
            image = artifact and artifact[1] == "images"
            if image and row["mime"] not in RASTER.values():
                raise ShelfError("Image not found",404)
            filename = DATA / "files" / row["id"]
            # Release the DB/lock before streaming large downloads.
            saved = (filename,row["mime"] if image else "application/octet-stream",None if image else row["filename"],'"'+row["sha256"]+'"')
        else:
            saved = None
            item = re.fullmatch(r"/api/shelf/items/("+ID+r")",route)
            if not item:
                raise ShelfError("Not found",404)
            row = db.execute("SELECT * FROM items WHERE id=?",(item[1],)).fetchone()
            if not row:
                raise ShelfError("Item not found",404)
            if method == "PATCH":
                body=read_json(h); title=text(body.get("title",row["title"]))
                if not title: raise ShelfError("A title is required")
                archived = int(body["archived"]) if isinstance(body.get("archived"),bool) else row["archived"]
                db.execute("UPDATE items SET title=?,description=?,collection=?,archived=?,updated=? WHERE id=?",(title,text(body.get("description",row["description"]),2000),text(body.get("collection",row["collection"]),80),archived,now(),row["id"]))
                return send_json(h,item_view(db,db.execute("SELECT * FROM items WHERE id=?",(row["id"],)).fetchone()))
            if method == "DELETE":
                for version in db.execute("SELECT id FROM shelf_versions WHERE item_id=?",(row["id"],)).fetchall():
                    (DATA / "files" / version["id"]).unlink(missing_ok=True)
                db.execute("DELETE FROM items WHERE id=?",(row["id"],))
                return send_json(h,{"ok":True})
            raise ShelfError("Method not allowed",405)
    if saved:
        return send_file(h,*saved)
