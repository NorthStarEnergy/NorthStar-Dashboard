"""Packet 20 — hostname separation and worker safety.

Packet 19 put a real door on the operator dashboard. Packet 20 is the other
half: the contractor experience on `checkin.northstarenergy.ca` stays public and
unchanged, and the operator application does not exist on that hostname at all.

The gap this suite closes is narrow and easy to miss. The operator *gate* asks
"is this an operator route, and is the caller authenticated?" — so everything
that is not an operator route is public by construction: the dashboard HTML,
every script and stylesheet it loads, the login page, the weather and market
feeds. None of those are gated, because on `ops.` they do not need to be. On the
public worker hostname they were being served to anyone who asked.

Cloudflare's ingress rule for that hostname says the same thing this suite does,
but that rule lives in the Zero Trust dashboard: this process cannot read it, no
test can assert on it, and an operator can change it in a browser. So the origin
states the contract itself, and these tests hold it.

Each test names the packet clause or verification-matrix row it covers.
"""

from __future__ import annotations

import importlib
import json
import os
import re
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

ROOT = Path(__file__).resolve().parent.parent

OPS_HOST = "ops.northstarenergy.ca"
PUBLIC_HOST = "checkin.northstarenergy.ca"
TEST_PASSWORD = "packet20-temporary-demo"

MISSING = object()


class HostnameSeparationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        os.environ["NORTHSTAR_DB"] = str(Path(self.directory.name) / "packet20.db")
        os.environ["NORTHSTAR_DEMO_AUTH_FILE"] = str(
            Path(self.directory.name) / ".northstar-demo-auth.json"
        )
        import northstar_store

        self.store = importlib.reload(northstar_store)
        self.store.init_db()
        import northstar_auth

        self.auth = importlib.reload(northstar_auth)
        import ieso_backend

        self.backend = importlib.reload(ieso_backend)
        self.backend.OPERATOR_HOST = OPS_HOST
        self.backend.CHECKIN_ORIGIN = f"https://{PUBLIC_HOST}"
        self.backend.DEMO_AUTH = self.auth.build_config("ron", TEST_PASSWORD)
        self.backend.DEMO_SESSIONS.clear()
        self.backend.DEMO_LOGIN_THROTTLE.clear()
        # Weather is an operator route; calling the live provider would make this
        # suite depend on the internet.
        self.backend.weather_snapshot = lambda: {"source": "test", "stations": [], "stale": False}
        self.use_gate("demo")

        self.server = self.backend.NorthstarHTTPServer(("127.0.0.1", 0), self.backend.Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.directory.cleanup()
        os.environ.pop("NORTHSTAR_DB", None)
        os.environ.pop("NORTHSTAR_DEMO_AUTH_FILE", None)

    # ------------------------------------------------------------------ tools

    def use_gate(self, mode: str) -> None:
        """Both deployed modes must contain the check-in hostname identically.

        `access` is what is live today; `demo` is Packet 19's replacement mode.
        Containment is not allowed to be a property of whichever one is running.
        """
        self.backend.OPERATOR_GATE = mode

    def call(
        self,
        method: str,
        path: str,
        payload: object = MISSING,
        *,
        host: str = PUBLIC_HOST,
        cookie: str = "",
        identity: str = "",
    ) -> tuple[int, object, dict[str, str]]:
        headers = {"Content-Type": "application/json", "Host": host}
        if cookie:
            headers["Cookie"] = cookie
        if identity:
            # A client-supplied copy of the header Cloudflare Access injects.
            # The 2026-08-11 probe proved the edge passes this through.
            headers["Cf-Access-Jwt-Assertion"] = identity
        data = None if payload is MISSING else json.dumps(payload).encode("utf-8")
        request = Request(self.base + path, data=data, method=method, headers=headers)
        try:
            response = urlopen(request, timeout=5)
        except HTTPError as error:
            response = error
        body = response.read()
        value = None
        if body:
            try:
                value = json.loads(body)
            except (json.JSONDecodeError, UnicodeDecodeError):
                # HTML, JavaScript, an icon: the status is what matters here.
                value = body[:64]
        return response.status, value, dict(response.headers.items())

    def status(self, method: str, path: str, payload: object = MISSING, **kwargs) -> int:
        return self.call(method, path, payload, **kwargs)[0]

    def session_cookie(self) -> str:
        status, _, headers = self.call(
            "POST", "/api/auth/login", {"username": "ron", "password": TEST_PASSWORD}, host=OPS_HOST
        )
        self.assertEqual(status, 200)
        return headers["Set-Cookie"].split(";", 1)[0]

    def worker_checks_in(self) -> dict:
        status, record, _ = self.call(
            "POST",
            "/api/checkins",
            {"name": "Packet20 Worker", "site": "Kenora", "alone": True},
            host=PUBLIC_HOST,
        )
        self.assertEqual(status, 201)
        return record

    # -------------------------------------------- §2 no public operator mirror

    def test_the_operator_console_is_not_served_on_the_check_in_hostname(self) -> None:
        """§2. The console and everything it loads must not exist there.

        None of these are operator *routes*, so the gate never looks at them.
        Before this packet each one returned 200 with its full body to any
        request that reached the origin on the public hostname.
        """
        for mode in ("access", "demo"):
            self.use_gate(mode)
            for path in (
                "/",
                "/northstar-clean.html",
                "/index.html",
                "/operator-login.html",
                "/contractor-qr.html",
                "/ops-beta.html",
                "/module-layout.js",
                "/lamination-dashboard.js",
                "/lamination-dashboard.css",
                "/switching-workspace.js",
                "/mobile-dashboard.js",
            ):
                with self.subTest(mode=mode, path=path):
                    self.assertEqual(self.status("GET", path), 404)

    def test_non_operator_apis_are_not_published_on_the_check_in_hostname(self) -> None:
        """§2. Feeds and session state belong to the console, not to workers."""
        for mode in ("access", "demo"):
            self.use_gate(mode)
            for path in ("/api/weather", "/api/market-prices", "/api/auth/session"):
                with self.subTest(mode=mode, path=path):
                    self.assertEqual(self.status("GET", path), 404)

    def test_an_admitted_prefix_cannot_be_walked_out_of(self) -> None:
        """§2. `/icons/` is admitted; `/icons/../` must not be a way out.

        The static handler collapses `..` before it opens a file, so a prefix
        match on the raw path would have served the console from an allowed
        directory. The check normalises first.
        """
        for path in (
            "/icons/%2e%2e/northstar-clean.html",
            "/icons/../northstar-clean.html",
            "/api/checkins/%2e%2e/weather",
            "/icons/%2e%2e/%2e%2e/ieso_backend.py",
        ):
            with self.subTest(path=path):
                self.assertEqual(self.status("GET", path), 404)

    def test_the_worker_app_surface_is_still_served_there(self) -> None:
        """§1. Everything the contractor PWA needs, with no login of any kind."""
        for mode in ("access", "demo"):
            self.use_gate(mode)
            for path in (
                "/contractor-checkin.html",
                "/manifest.webmanifest",
                "/sw.js",
                "/icons/northstar-192.png",
                "/icons/northstar-512.png",
                "/favicon.ico",
                "/api/health",
            ):
                with self.subTest(mode=mode, path=path):
                    self.assertEqual(self.status("GET", path), 200)

    def test_the_allowlist_covers_every_asset_the_worker_app_caches(self) -> None:
        """§1, guarded against drift.

        `sw.js` precaches the offline shell. If someone adds a file to that list
        and not to `CHECKIN_PUBLIC_ROUTES`, the worker page breaks in the field
        rather than at a desk — the phone caches a 404 and a contractor at a
        remote gate has no way to check in. Read the real list and assert it.
        """
        shell_block = re.search(
            r"const SHELL = \[(.*?)\]", (ROOT / "sw.js").read_text(encoding="utf-8"), re.S
        )
        self.assertIsNotNone(shell_block, "sw.js no longer declares a SHELL array")
        cached = re.findall(r"'([^']+)'", shell_block.group(1))
        self.assertIn("/contractor-checkin.html", cached)
        for path in cached:
            with self.subTest(path=path):
                self.assertEqual(self.status("GET", path), 200)

    # ------------------------------------------ §3 operator routes are refused

    def test_operator_routes_are_refused_on_the_check_in_hostname(self) -> None:
        """§3 and the verification matrix.

        Refused, and refused as 403 rather than 404: the containment rule runs
        after the gate on purpose, so a known operator route gives the same
        deliberate answer it has given since 2026-08-11 and the two forged-header
        regression tests keep their meaning.
        """
        self.worker_checks_in()
        cookie = self.session_cookie()
        operator_routes = (
            ("GET", "/api/checkins"),
            ("GET", "/api/checkins?include=all"),
            ("GET", "/api/checkins/history"),
            ("GET", "/api/logbook"),
            ("POST", "/api/logbook"),
            ("GET", "/api/outages"),
            ("POST", "/api/outages"),
            ("GET", "/api/checkin-tokens"),
            ("GET", "/api/switching/drafts"),
            ("GET", "/api/voice"),
        )
        for method, path in operator_routes:
            payload = MISSING if method == "GET" else {"entry": "x", "site": "Kenora"}
            with self.subTest(route=f"{method} {path}"):
                # No credentials at all.
                self.assertEqual(self.status(method, path, payload), 403)
                # A forged copy of the Cloudflare Access header.
                self.assertEqual(self.status(method, path, payload, identity="forged"), 403)
                # A genuine operator session cookie, copied off `ops.`.
                self.assertEqual(self.status(method, path, payload, cookie=cookie), 403)
                # Both at once.
                self.assertEqual(
                    self.status(method, path, payload, cookie=cookie, identity="forged"), 403
                )

    def test_the_operator_hostname_and_local_development_are_unaffected(self) -> None:
        """§2, the other direction. Containment must not reach `ops.`.

        A rule that quietly closed the console's own assets would be caught in
        production, not here — but it would be caught by an operator with an
        outage on screen.
        """
        cookie = self.session_cookie()
        for path in ("/northstar-clean.html", "/module-layout.js", "/api/weather", "/api/checkins"):
            with self.subTest(path=path):
                self.assertEqual(self.status("GET", path, host=OPS_HOST, cookie=cookie), 200)

        # With the gate in Access mode the same paths answer to the edge header.
        self.use_gate("access")
        for path in ("/northstar-clean.html", "/api/weather", "/api/checkins"):
            with self.subTest(mode="access", path=path):
                self.assertEqual(self.status("GET", path, host=OPS_HOST, identity="jwt"), 200)

        # And a developer on the loopback address is not behind either hostname.
        self.backend.CHECKIN_ORIGIN = ""
        self.use_gate("off")
        self.assertEqual(self.status("GET", "/northstar-clean.html", host="localhost"), 200)
        self.assertEqual(self.status("GET", "/api/checkins", host="localhost"), 200)

    # ----------------------------------------------- verification-matrix rows

    def test_health_on_the_check_in_hostname_is_liveness_only(self) -> None:
        """Matrix row: `GET /api/health` on the public host.

        Health is the one operator-app route the worker PWA shares, so it cannot
        be closed there — only reduced. Not to a session, not to a forged header,
        and not in either gate mode does it report operational counts, the SCADA
        block, or a filesystem path.
        """
        self.worker_checks_in()
        cookie = self.session_cookie()
        for mode in ("access", "demo"):
            self.use_gate(mode)
            for label, kwargs in (
                ("anonymous", {}),
                ("forged header", {"identity": "forged"}),
                ("copied session", {"cookie": cookie}),
            ):
                with self.subTest(mode=mode, caller=label):
                    status, public, _ = self.call("GET", "/api/health", **kwargs)
                    self.assertEqual(status, 200)
                    self.assertEqual(
                        set(public), {"status", "serverTime", "checkinOrigin", "database"}
                    )
                    self.assertEqual(set(public["database"]), {"ok"})
                    body = json.dumps(public)
                    self.assertNotIn("activeCheckins", body)
                    self.assertNotIn("openHelpRequests", body)
                    self.assertNotIn("sharePath", body)

    def test_the_worker_flow_is_unchanged_end_to_end_on_the_public_hostname(self) -> None:
        """§1 and §5, and the last two rows of the verification matrix.

        A contractor scans a placard, checks in, sends heartbeats, raises the
        alarm and checks out — all with no login. The same hostname cannot read
        the roster that check-in joined or clear the alarm it raised, and the
        record is visible from `ops.` only after signing in.
        """
        record = self.worker_checks_in()
        checkin_id = record["id"]

        self.assertEqual(self.status("GET", f"/api/checkins/{checkin_id}"), 200)
        self.assertEqual(self.status("POST", f"/api/checkins/{checkin_id}/heartbeat", {}), 200)
        self.assertEqual(
            self.status("POST", f"/api/checkins/{checkin_id}/help", {"actor": "worker"}), 200
        )

        # The roster and the operator's half of the alarm stay closed there.
        self.assertEqual(self.status("GET", "/api/checkins"), 403)
        for action in ("help/acknowledge", "help/resolve"):
            with self.subTest(action=action):
                self.assertEqual(
                    self.status("POST", f"/api/checkins/{checkin_id}/{action}", {"actor": "x"}), 403
                )

        # Signed out, the operator hostname shows nothing either.
        self.assertEqual(self.status("GET", "/api/checkins", host=OPS_HOST), 401)

        # Signed in, the record is there and the alarm is still standing.
        cookie = self.session_cookie()
        _, roster, _ = self.call("GET", "/api/checkins", host=OPS_HOST, cookie=cookie)
        entry = next((row for row in roster if row["id"] == checkin_id), None)
        self.assertIsNotNone(entry, "the end-to-end check-in is missing from the roster")
        self.assertTrue(entry["needsHelp"])
        self.assertEqual(
            self.status(
                "POST", f"/api/checkins/{checkin_id}/help/resolve", {"actor": "control room"},
                host=OPS_HOST, cookie=cookie,
            ), 200
        )

        # The worker's own phone can still check out afterwards.
        self.assertEqual(self.status("DELETE", f"/api/checkins/{checkin_id}"), 200)

    def test_the_session_cookie_is_host_only_so_the_browser_never_sends_it(self) -> None:
        """§4. Belt and braces with the server-side refusal above.

        No `Domain` attribute means the browser scopes the cookie to `ops.` and
        never attaches it to a request for the check-in hostname. Packet 19's
        suite asserts the same thing from the credential side; it is repeated
        here because §4 is a hostname-separation requirement and this file is
        where someone will look for it.
        """
        _, _, headers = self.call(
            "POST", "/api/auth/login", {"username": "ron", "password": TEST_PASSWORD}, host=OPS_HOST
        )
        set_cookie = headers["Set-Cookie"]
        self.assertNotIn("domain=", set_cookie.lower())
        self.assertIn("Path=/", set_cookie)
        self.assertIn("HttpOnly", set_cookie)
        self.assertIn("Secure", set_cookie)
        self.assertIn("SameSite=Lax", set_cookie)

    # ------------------------------------------------------ §6/§7 the gate itself

    def test_demo_mode_gates_operator_routes_rather_than_turning_the_gate_off(self) -> None:
        """§6. The replacement mode is a third mode, never `off`.

        `NORTHSTAR_OPERATOR_GATE=off` on a published deployment is the exact
        2026-08-11 exposure: the roster readable from the internet. Demo mode has
        to hold the same line while leaving the worker routes open.
        """
        source = (ROOT / "ieso_backend.py").read_text(encoding="utf-8")
        self.assertIn('OPERATOR_GATE not in {"access", "demo"}', source)

        self.use_gate("demo")
        self.assertEqual(self.status("GET", "/api/checkins", host=OPS_HOST), 401)
        self.assertEqual(self.status("GET", "/api/checkins"), 403)
        # ...while the worker's own routes stay open on the public hostname.
        record = self.worker_checks_in()
        self.assertEqual(self.status("GET", f"/api/checkins/{record['id']}"), 200)

    def test_the_check_in_origin_and_loopback_bind_requirements_are_intact(self) -> None:
        """§7. Both startup guards, unchanged by this packet."""
        source = (ROOT / "ieso_backend.py").read_text(encoding="utf-8")
        self.assertIn('CHECKIN_ORIGIN.startswith("https://") and OPERATOR_GATE not in', source)
        self.assertIn(
            'CHECKIN_ORIGIN.startswith("https://") and HOST not in {"127.0.0.1", "localhost", "::1"}',
            source,
        )
        launcher = (ROOT / "start-northstar.ps1").read_text(encoding="utf-8")
        self.assertIn("NORTHSTAR_CHECKIN_ORIGIN = 'https://checkin.northstarenergy.ca'", launcher)
        self.assertIn("NORTHSTAR_BIND_HOST = '127.0.0.1'", launcher)

    def test_launcher_opens_the_hostname_that_can_authenticate(self) -> None:
        launcher = (ROOT / "start-northstar.ps1").read_text(encoding="utf-8")
        self.assertIn('"https://$operatorHost/northstar-clean.html"', launcher)
        self.assertIn("'http://localhost:4180/northstar-clean.html'", launcher)
        self.assertIn("if ($LocalOnly)", launcher)

        login = (ROOT / "operator-login.html").read_text(encoding="utf-8")
        self.assertIn("r.status===404", login)
        self.assertIn("https://ops.northstarenergy.ca/operator-login.html", login)


if __name__ == "__main__":
    unittest.main()
