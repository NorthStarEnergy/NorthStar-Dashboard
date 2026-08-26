"""Packet 19 — demo operator authentication.

Every test here maps to a line in the packet's "tests required before Packet 19
is complete" list, plus the containment invariants the packet says must survive:
the check-in hostname never becomes a second way to reach the operator surface,
and no password value exists in HTML, JavaScript, source, or logs.
"""

from __future__ import annotations

import importlib
import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

ROOT = Path(__file__).resolve().parent.parent

# The owner supplies the real temporary password out of band; this one exists
# only inside this test process and is never written anywhere.
TEST_PASSWORD = "packet19-temporary-demo"
OPS_HOST = "ops.northstarenergy.ca"
PUBLIC_HOST = "checkin.northstarenergy.ca"

MISSING = object()


class DemoAuthTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        os.environ["NORTHSTAR_DB"] = str(Path(self.directory.name) / "demo-auth.db")
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

        # Demo mode is a distinct gate mode: the operator gate is never "off".
        self.backend.OPERATOR_GATE = "demo"
        self.backend.OPERATOR_HOST = OPS_HOST
        self.backend.CHECKIN_ORIGIN = f"https://{PUBLIC_HOST}"
        self.backend.DEMO_AUTH = self.auth.build_config("ron", TEST_PASSWORD)
        self.backend.DEMO_SESSIONS.clear()
        self.backend.DEMO_LOGIN_THROTTLE.clear()
        # The weather route is an operator route; calling the live provider from
        # a test would make this suite depend on the internet.
        self.backend.weather_snapshot = lambda: {"source": "test", "stations": [], "stale": False}

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

    def call(
        self,
        method: str,
        path: str,
        payload: object = MISSING,
        *,
        host: str = OPS_HOST,
        cookie: str = "",
        origin: str = "",
    ) -> tuple[int, object, dict[str, str]]:
        headers = {"Content-Type": "application/json", "Host": host}
        if cookie:
            headers["Cookie"] = cookie
        if origin:
            headers["Origin"] = origin
        data = None if payload is MISSING else json.dumps(payload).encode("utf-8")
        request = Request(self.base + path, data=data, method=method, headers=headers)
        try:
            response = urlopen(request, timeout=5)
        except HTTPError as error:
            response = error
        body = response.read()
        value = json.loads(body) if body else None
        return response.status, value, dict(response.headers.items())

    def sign_in(self, username: str = "ron", password: str = TEST_PASSWORD, **kwargs):
        return self.call("POST", "/api/auth/login", {"username": username, "password": password}, **kwargs)

    def session_cookie(self) -> str:
        status, _, headers = self.sign_in()
        self.assertEqual(status, 200)
        return headers["Set-Cookie"].split(";", 1)[0]

    def create_checkin(self) -> dict:
        """A worker checks themselves in — an open route on the public host."""
        status, record, _ = self.call(
            "POST",
            "/api/checkins",
            {"name": "Packet19 Worker", "site": "Kenora", "alone": True},
            host=PUBLIC_HOST,
        )
        self.assertEqual(status, 201)
        return record

    # ------------------------------------------------------------- sign-in

    def test_correct_credentials_on_ops_create_a_session(self) -> None:
        status, body, headers = self.sign_in()
        self.assertEqual(status, 200)
        self.assertTrue(body["authenticated"])
        self.assertEqual(body["username"], "ron")

        cookie_header = headers["Set-Cookie"]
        self.assertIn(f"{self.auth.COOKIE_NAME}=", cookie_header)
        self.assertIn("HttpOnly", cookie_header)
        self.assertIn("Secure", cookie_header)
        self.assertIn("SameSite=Lax", cookie_header)
        # Host-only. A Domain attribute would hand the operator session to every
        # subdomain, including the public check-in hostname.
        self.assertNotIn("Domain=", cookie_header)
        # Time-limited, and not longer than a workday.
        max_age = int(
            next(p for p in cookie_header.split(";") if p.strip().startswith("Max-Age=")).split("=")[1]
        )
        self.assertGreater(max_age, 0)
        self.assertLessEqual(max_age, 12 * 60 * 60)

        # The token is random, not derived from the username.
        token = cookie_header.split("=", 1)[1].split(";", 1)[0]
        self.assertGreaterEqual(len(token), 32)
        self.assertNotIn("ron", token)
        self.assertNotIn(TEST_PASSWORD, cookie_header)

    def test_wrong_username_wrong_password_and_blank_password_all_fail(self) -> None:
        for label, username, password in (
            ("wrong username", "operator", TEST_PASSWORD),
            ("wrong password", "ron", "not-the-password"),
            ("blank password", "ron", ""),
            ("blank username", "", TEST_PASSWORD),
            ("both blank", "", ""),
            ("case-shifted username", "RON", TEST_PASSWORD),
        ):
            with self.subTest(label):
                status, body, headers = self.sign_in(username, password)
                self.assertEqual(status, 401)
                self.assertNotIn("Set-Cookie", headers)
                # The failure never says which half was wrong.
                self.assertEqual(body["error"], "invalid credentials")
            self.backend.DEMO_LOGIN_THROTTLE.clear()

        self.assertEqual(self.backend.DEMO_SESSIONS.count(), 0)

    def test_a_malformed_login_body_is_a_400_not_a_crash(self) -> None:
        request = Request(
            self.base + "/api/auth/login",
            data=b"not json",
            method="POST",
            headers={"Content-Type": "application/json", "Host": OPS_HOST},
        )
        try:
            status = urlopen(request, timeout=5).status
        except HTTPError as error:
            status = error.status
        self.assertEqual(status, 400)

    # ------------------------------------------------- session authorization

    def test_every_operator_route_refuses_a_request_with_no_session(self) -> None:
        record = self.create_checkin()
        operator_reads = (
            "/api/checkins",
            "/api/checkins/history",
            "/api/checkin-tokens",
            "/api/logbook",
            "/api/outages",
            "/api/outages/history",
            "/api/alerts",
            "/api/alerts/settings",
            "/api/alerts/history",
            "/api/scada",
            "/api/scada/readings",
            "/api/retention",
            "/api/site-policies",
            "/api/switching/drafts",
            "/api/schematics",
            "/api/voice",
            "/api/voice/recordings",
        )
        for path in operator_reads:
            with self.subTest(path=path):
                status, body, _ = self.call("GET", path)
                self.assertIn(status, (401, 403))
                self.assertTrue(body.get("loginRequired"))

        operator_writes = (
            ("POST", "/api/logbook", {"subject": "unauthorised"}),
            ("POST", "/api/outages", {"title": "unauthorised", "site": "Kenora"}),
            ("POST", "/api/alerts/clear", {"id": "x"}),
            ("POST", "/api/switching/drafts", {"packageName": "unauthorised"}),
            ("POST", "/api/schematics", {"name": "unauthorised", "record": {}}),
            ("POST", f"/api/checkins/{record['id']}/help/resolve", {"actor": "x"}),
            ("POST", f"/api/checkins/{record['id']}/provisional", {"accept": True}),
            ("POST", "/api/voice/scan", {}),
        )
        for method, path, payload in operator_writes:
            with self.subTest(path=path):
                status, _, _ = self.call(method, path, payload)
                self.assertIn(status, (401, 403))

        # Nothing was written by any of those refusals.
        cookie = self.session_cookie()
        _, logbook, _ = self.call("GET", "/api/logbook", cookie=cookie)
        self.assertNotIn("unauthorised", json.dumps(logbook))

    def test_a_malformed_or_expired_session_is_refused(self) -> None:
        for label, cookie in (
            ("garbage token", f"{self.auth.COOKIE_NAME}=not-a-real-token"),
            ("empty token", f"{self.auth.COOKIE_NAME}="),
            ("wrong cookie name", "SomeOtherCookie=whatever"),
            ("no cookie at all", ""),
        ):
            with self.subTest(label):
                status, _, _ = self.call("GET", "/api/checkins", cookie=cookie)
                self.assertIn(status, (401, 403))

        # A session that has aged out is refused by the server, not by the
        # browser declining to send an expired cookie.
        token, _ = self.backend.DEMO_SESSIONS.create("ron", -1)
        status, _, _ = self.call(
            "GET", "/api/checkins", cookie=f"{self.auth.COOKIE_NAME}={token}"
        )
        self.assertEqual(status, 401)

    def test_logout_invalidates_the_server_session_and_clears_the_cookie(self) -> None:
        cookie = self.session_cookie()
        self.assertEqual(self.call("GET", "/api/checkins", cookie=cookie)[0], 200)

        status, body, headers = self.call("POST", "/api/auth/logout", {}, cookie=cookie)
        self.assertEqual(status, 200)
        self.assertFalse(body["authenticated"])
        self.assertIn("Max-Age=0", headers["Set-Cookie"])
        self.assertIn("HttpOnly", headers["Set-Cookie"])

        # The token is dead server-side: replaying the same cookie fails.
        self.assertEqual(self.call("GET", "/api/checkins", cookie=cookie)[0], 401)
        self.assertEqual(self.backend.DEMO_SESSIONS.count(), 0)

    def test_a_valid_session_loads_weather_field_tracker_and_field_staff(self) -> None:
        self.create_checkin()
        cookie = self.session_cookie()

        status, weather, _ = self.call("GET", "/api/weather", cookie=cookie)
        self.assertEqual(status, 200)
        self.assertIn("stations", weather)

        # Field Staff Status and the Field Tracker both read the roster.
        status, roster, _ = self.call("GET", "/api/checkins", cookie=cookie)
        self.assertEqual(status, 200)
        self.assertEqual(roster[0]["name"], "Packet19 Worker")

        status, history, _ = self.call("GET", "/api/checkins/history", cookie=cookie)
        self.assertEqual(status, 200)
        self.assertIsInstance(history, list)

        # And the panels beside them.
        for path in ("/api/logbook", "/api/outages", "/api/alerts", "/api/voice"):
            with self.subTest(path=path):
                self.assertEqual(self.call("GET", path, cookie=cookie)[0], 200)

    def test_the_session_state_endpoint_answers_the_dashboard_boot_sequence(self) -> None:
        status, body, _ = self.call("GET", "/api/auth/session")
        self.assertEqual(status, 401)
        self.assertTrue(body["required"])
        self.assertFalse(body["authenticated"])
        self.assertEqual(body["loginUrl"], "/operator-login.html")

        cookie = self.session_cookie()
        status, body, _ = self.call("GET", "/api/auth/session", cookie=cookie)
        self.assertEqual(status, 200)
        self.assertTrue(body["authenticated"])
        self.assertEqual(body["username"], "ron")

    def test_the_console_page_serves_the_login_screen_when_signed_out(self) -> None:
        """A signed-out browser must not get a dashboard that then 401s."""
        for path in ("/", "/northstar-clean.html"):
            with self.subTest(path=path):
                request = Request(self.base + path, method="GET", headers={"Host": OPS_HOST})
                page = urlopen(request, timeout=5).read().decode("utf-8", "replace")
                self.assertIn("operator sign in", page.lower())
                self.assertNotIn("EDIT LAYOUT", page)

        cookie = self.session_cookie()
        request = Request(
            self.base + "/northstar-clean.html", method="GET",
            headers={"Host": OPS_HOST, "Cookie": cookie},
        )
        page = urlopen(request, timeout=5).read().decode("utf-8", "replace")
        self.assertIn("EDIT LAYOUT", page)

    # ------------------------------------------------------ host containment

    def test_the_login_endpoint_does_not_exist_on_the_checkin_hostname(self) -> None:
        """The worker hostname must not offer a second way to get a session."""
        for path in ("/api/auth/login", "/api/auth/logout"):
            with self.subTest(path=path):
                status, _, headers = self.call(
                    "POST", path, {"username": "ron", "password": TEST_PASSWORD},
                    host=PUBLIC_HOST,
                )
                self.assertEqual(status, 404)
                self.assertNotIn("Set-Cookie", headers)
        self.assertEqual(self.call("GET", "/api/auth/session", host=PUBLIC_HOST)[0], 404)
        self.assertEqual(self.backend.DEMO_SESSIONS.count(), 0)

    def test_an_operator_session_is_still_refused_on_the_checkin_hostname(self) -> None:
        """Even a genuine cookie cannot open the operator surface there.

        The cookie is host-only, so a browser never sends it to the check-in
        hostname — but the origin must not depend on that promise. This is the
        same containment the forged-Access-header tests protect.
        """
        self.create_checkin()
        cookie = self.session_cookie()
        for path in ("/api/checkins", "/api/checkins/history", "/api/logbook",
                     "/api/checkin-tokens", "/api/switching/drafts", "/api/schematics"):
            with self.subTest(path=path):
                self.assertEqual(self.call("GET", path, host=PUBLIC_HOST, cookie=cookie)[0], 403)

    def test_worker_routes_stay_open_on_the_checkin_hostname(self) -> None:
        """Closing these would take every phone in the field offline."""
        record = self.create_checkin()
        self.assertEqual(self.call("GET", f"/api/checkins/{record['id']}", host=PUBLIC_HOST)[0], 200)
        self.assertEqual(
            self.call("POST", f"/api/checkins/{record['id']}/help", {"actor": "worker"},
                      host=PUBLIC_HOST)[0],
            200,
        )
        self.assertEqual(
            self.call("POST", f"/api/checkins/{record['id']}/heartbeat", {}, host=PUBLIC_HOST)[0],
            200,
        )
        self.assertEqual(self.call("GET", "/api/health", host=PUBLIC_HOST)[0], 200)

    def test_public_health_stays_liveness_only_without_a_session(self) -> None:
        status, public, _ = self.call("GET", "/api/health", host=PUBLIC_HOST)
        self.assertEqual(status, 200)
        self.assertEqual(set(public), {"status", "serverTime", "checkinOrigin", "database"})
        self.assertNotIn("sharePath", json.dumps(public))

        cookie = self.session_cookie()
        _, operator, _ = self.call("GET", "/api/health", cookie=cookie)
        self.assertIn("scada", operator)

    def test_a_cross_origin_write_is_refused_even_with_a_valid_session(self) -> None:
        cookie = self.session_cookie()
        status, _, _ = self.call(
            "POST", "/api/logbook", {"subject": "cross-origin"},
            cookie=cookie, origin="https://attacker.example",
        )
        self.assertEqual(status, 403)

        status, _, _ = self.call(
            "POST", "/api/logbook", {"subject": "same-origin"},
            cookie=cookie, origin=f"https://{OPS_HOST}",
        )
        self.assertEqual(status, 201)

        # A cross-origin sign-in attempt is refused before the password is read.
        self.assertEqual(self.sign_in(origin="https://attacker.example")[0], 403)

    # ------------------------------------------------------------- throttling

    def test_failed_logins_are_throttled_and_reset_after_the_window(self) -> None:
        self.backend.DEMO_LOGIN_THROTTLE = self.auth.LoginThrottle(
            max_failures=3, window_seconds=60
        )
        for attempt in range(3):
            with self.subTest(attempt=attempt):
                self.assertEqual(self.sign_in(password="wrong")[0], 401)

        status, body, _ = self.sign_in(password="wrong")
        self.assertEqual(status, 429)
        self.assertGreater(body["retryAfter"], 0)

        # Locked out means locked out: the correct password is refused too, so
        # a guessing run cannot be finished by getting lucky on attempt four.
        self.assertEqual(self.sign_in()[0], 429)

        # The window is a sliding one; once the failures age out, sign-in works.
        throttle = self.backend.DEMO_LOGIN_THROTTLE
        with throttle._lock:  # simulate the window elapsing, without sleeping 60s
            key = next(iter(throttle._failures))
            throttle._failures[key] = [stamp - 61 for stamp in throttle._failures[key]]
        self.assertEqual(self.sign_in()[0], 200)

    def test_a_successful_sign_in_clears_the_failure_count(self) -> None:
        self.backend.DEMO_LOGIN_THROTTLE = self.auth.LoginThrottle(
            max_failures=3, window_seconds=60
        )
        self.assertEqual(self.sign_in(password="wrong")[0], 401)
        self.assertEqual(self.sign_in(password="wrong")[0], 401)
        self.assertEqual(self.sign_in()[0], 200)
        # Two more failures would have tripped the limit if the count survived.
        self.assertEqual(self.sign_in(password="wrong")[0], 401)
        self.assertEqual(self.sign_in(password="wrong")[0], 401)
        self.assertEqual(self.sign_in()[0], 200)

    # ------------------------------------------------------------------ audit

    def test_audit_records_name_the_demo_user_not_a_claimed_identity(self) -> None:
        record = self.create_checkin()
        cookie = self.session_cookie()

        self.call("POST", f"/api/checkins/{record['id']}/help", {"actor": "worker"}, host=PUBLIC_HOST)
        status, _, _ = self.call(
            "POST", f"/api/checkins/{record['id']}/help/resolve",
            {"actor": "Jane Doe, Senior Operator"}, cookie=cookie,
        )
        self.assertEqual(status, 200)

        _, logbook, _ = self.call("GET", "/api/logbook", cookie=cookie)
        resolved = next(entry for entry in logbook if entry["type"] == "Staff help resolved")
        # The server decides the actor. A claimed employee identity in the
        # request body must not end up in the audit trail.
        self.assertEqual(resolved["source"], "ron")
        self.assertNotIn("Jane Doe", json.dumps(resolved))

        signin = next(entry for entry in logbook if entry["type"] == "Operator sign-in")
        self.assertEqual(signin["source"], "ron")
        self.assertNotIn(TEST_PASSWORD, json.dumps(logbook))

    # --------------------------------------------------- configuration shape

    def test_no_password_value_exists_in_html_javascript_or_source(self) -> None:
        """Requirement 2: no password in HTML, JavaScript, Git, Drive, or logs."""
        for name in ("operator-login.html", "northstar-clean.html", "auth.js",
                     "ieso_backend.py", "northstar_auth.py", "operator-session.js"):
            path = ROOT / name
            with self.subTest(name=name):
                self.assertTrue(path.exists(), f"{name} is missing")
                self.assertNotIn(TEST_PASSWORD, path.read_text(encoding="utf-8", errors="replace"))

        # No browser-side file may carry a credential or decide access itself.
        # The retired auth.js shipped `operator/operator` in exactly this way.
        for name in ("operator-login.html", "auth.js", "operator-session.js"):
            text = (ROOT / name).read_text(encoding="utf-8", errors="replace")
            for marker in ("operator/operator", "northstarAuth", "loginForm", "password ==="):
                with self.subTest(name=name, marker=marker):
                    self.assertNotIn(marker, text)

        # The credential file lives outside the served tree, under data/, and is
        # a dotfile — the static server refuses it twice over.
        configured = self.auth.config_path()
        self.assertEqual(configured.name[0], ".")
        for path in ("/data/.northstar-demo-auth.json", "/.northstar-demo-auth.json"):
            with self.subTest(path=path):
                request = Request(self.base + path, method="GET", headers={"Host": OPS_HOST})
                try:
                    status = urlopen(request, timeout=5).status
                except HTTPError as error:
                    status = error.status
                self.assertEqual(status, 404)

    def test_the_stored_credential_is_a_one_way_verifier(self) -> None:
        config = self.auth.build_config("ron", TEST_PASSWORD)
        serialised = json.dumps(config)
        self.assertNotIn(TEST_PASSWORD, serialised)
        algorithm, salt, digest = config["verifier"].split("$")
        self.assertEqual(algorithm, "scrypt")
        self.assertGreaterEqual(len(salt), 32)
        self.assertGreaterEqual(len(digest), 64)

        # Same password, different install: different salt, different digest.
        other = self.auth.build_config("ron", TEST_PASSWORD)
        self.assertNotEqual(other["verifier"], config["verifier"])

        self.assertTrue(self.auth.authenticates(config, "ron", TEST_PASSWORD))
        self.assertFalse(self.auth.authenticates(config, "ron", TEST_PASSWORD + "x"))
        self.assertFalse(self.auth.authenticates(config, "ron", ""))
        self.assertFalse(self.auth.authenticates(None, "ron", TEST_PASSWORD))

    def test_setup_refuses_a_blank_password_or_username(self) -> None:
        with self.assertRaises(self.auth.AuthConfigError):
            self.auth.build_config("ron", "")
        with self.assertRaises(self.auth.AuthConfigError):
            self.auth.build_config("", TEST_PASSWORD)

    def test_the_credential_round_trips_through_the_runtime_config_file(self) -> None:
        path = Path(self.directory.name) / ".northstar-demo-auth.json"
        self.auth.save_config(self.auth.build_config("ron", TEST_PASSWORD), path)
        loaded = self.auth.load_config(path)
        self.assertEqual(loaded["username"], "ron")
        self.assertTrue(self.auth.authenticates(loaded, "ron", TEST_PASSWORD))
        # One workday by default, and never unbounded.
        self.assertGreaterEqual(loaded["sessionSeconds"], 900)
        self.assertLessEqual(loaded["sessionSeconds"], 12 * 60 * 60)

    def test_demo_mode_is_a_distinct_gate_mode_not_the_gate_turned_off(self) -> None:
        self.assertEqual(self.backend.OPERATOR_GATE, "demo")
        # The operator route classification is the existing one, not a copy.
        self.assertIn("/api/checkins", self.backend.OPERATOR_ROUTES)
        self.assertIn("/api/voice", self.backend.OPERATOR_ROUTES)
        self.assertTrue(self.backend.OPERATOR_ROUTE_PATTERNS)

        # With the gate off, none of this engages — the local development path
        # is unchanged by Packet 19.
        self.backend.OPERATOR_GATE = "off"
        self.backend.CHECKIN_ORIGIN = ""
        try:
            self.assertEqual(self.call("GET", "/api/checkins", host="localhost")[0], 200)
            status, body, _ = self.call("GET", "/api/auth/session", host="localhost")
            self.assertEqual(status, 200)
            self.assertFalse(body["required"])
        finally:
            self.backend.OPERATOR_GATE = "demo"
            self.backend.CHECKIN_ORIGIN = f"https://{PUBLIC_HOST}"

    def test_sessions_do_not_outlive_their_expiry_in_memory(self) -> None:
        sessions = self.auth.SessionStore()
        live, _ = sessions.create("ron", 60)
        dead, _ = sessions.create("ron", -1)
        self.assertEqual(sessions.actor(live), "ron")
        self.assertIsNone(sessions.actor(dead))
        self.assertEqual(sessions.count(), 1)
        self.assertTrue(sessions.destroy(live))
        self.assertFalse(sessions.destroy(live))
        self.assertEqual(sessions.count(), 0)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
