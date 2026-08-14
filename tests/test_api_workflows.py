"""HTTP and persistence tests for operational workflows."""

from __future__ import annotations

import importlib
import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

MISSING = object()

# Several tests here are security regressions: they assert that a route is
# refused. A socket timeout is not a status code and not a security finding, but
# with a short timeout and no URLError handling it surfaced as one — a slow run
# on a loaded machine reported "the static tree serves secrets" when the server
# had simply not answered yet. Time out generously, and when it does happen say
# plainly that it is a responsiveness problem so nobody goes hunting a breach.
REQUEST_TIMEOUT = float(os.environ.get("NORTHSTAR_TEST_TIMEOUT", "20"))


def _timed_out(request: Request, error: BaseException) -> AssertionError:
    # urlopen raises URLError when the connection itself fails, but a bare
    # TimeoutError when reading the response times out. TimeoutError is not a
    # URLError — both are OSError, only one is a URLError — so both must be
    # named, and only one of them carries .reason.
    reason = getattr(error, "reason", None) or error.__class__.__name__
    return AssertionError(
        f"{request.get_method()} {request.full_url} did not respond within"
        f" {REQUEST_TIMEOUT:.0f}s ({reason}).\n"
        "This is a responsiveness failure, not a security finding. Re-run on an"
        " idle machine, or raise NORTHSTAR_TEST_TIMEOUT, before treating it as a"
        " regression."
    )


class APITest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        os.environ["NORTHSTAR_DB"] = str(Path(self.directory.name) / "api.db")
        import northstar_store

        self.store = importlib.reload(northstar_store)
        self.store.init_db()
        import ieso_backend

        self.backend = importlib.reload(ieso_backend)
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

    def request(
        self,
        method: str,
        path: str,
        payload: object = MISSING,
        *,
        raw: bytes | None = None,
    ) -> tuple[int, object, dict[str, str]]:
        if raw is not None:
            data = raw
        elif payload is MISSING:
            data = None
        else:
            data = json.dumps(payload).encode("utf-8")
        request = Request(
            self.base + path,
            data=data,
            method=method,
            headers={"Content-Type": "application/json"},
        )
        try:
            response = urlopen(request, timeout=REQUEST_TIMEOUT)
        except HTTPError as error:
            response = error
        except (URLError, TimeoutError) as error:
            raise _timed_out(request, error) from error
        body = response.read()
        value = json.loads(body) if body else None
        return response.status, value, dict(response.headers.items())

    def create_checkin(self) -> dict[str, object]:
        status, record, _ = self.request(
            "POST", "/api/checkins", {"name": "API Worker", "site": "Kenora", "alone": True}
        )
        self.assertEqual(status, 201)
        return record

    def test_second_backend_cannot_share_the_active_port(self) -> None:
        with self.assertRaises(OSError):
            self.backend.NorthstarHTTPServer(
                ("127.0.0.1", self.server.server_port), self.backend.Handler
            )

    # The demo operator login (Packet 19) has its own suite: tests/test_demo_auth.py.

    def enable_operator_gate(self) -> None:
        previous = self.backend.OPERATOR_GATE
        self.backend.OPERATOR_GATE = "access"
        self.addCleanup(setattr, self.backend, "OPERATOR_GATE", previous)

    def gated_request(
        self, method: str, path: str, payload: object = MISSING, *, identity: str = ""
    ) -> int:
        data = None if payload is MISSING else json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if identity:
            headers["Cf-Access-Jwt-Assertion"] = identity
        request = Request(self.base + path, data=data, method=method, headers=headers)
        try:
            return urlopen(request, timeout=REQUEST_TIMEOUT).status
        except HTTPError as error:
            return error.status
        except (URLError, TimeoutError) as error:
            raise _timed_out(request, error) from error

    def test_operator_gate_covers_help_subroutes_but_not_the_workers_alarm(self) -> None:
        """A worker must be able to raise help; only an operator may clear it."""
        record = self.create_checkin()
        self.enable_operator_gate()

        # The worker's own device carries no identity and must still raise help.
        self.assertEqual(
            self.gated_request("POST", f"/api/checkins/{record['id']}/help", {"actor": "worker"}), 200
        )

        # Clearing that alarm is an operator action. Before this was gated, any
        # unauthenticated caller could resolve a distress call from the internet.
        self.assertEqual(
            self.gated_request("POST", f"/api/checkins/{record['id']}/help/acknowledge", {"actor": "x"}), 403
        )
        self.assertEqual(
            self.gated_request("POST", f"/api/checkins/{record['id']}/help/resolve", {"actor": "x"}), 403
        )
        self.assertEqual(
            self.gated_request("POST", f"/api/checkins/{record['id']}/provisional", {}), 403
        )
        self.assertEqual(self.gated_request("POST", f"/api/checkins/{record['id']}/time", {}), 403)

        # The alarm must still be standing after those refusals.
        _, live, _ = self.request("GET", f"/api/checkins/{record['id']}")
        self.assertTrue(live["needsHelp"])
        self.assertEqual(live["helpState"], "requested")

        # With an edge identity the operator can clear it.
        self.assertEqual(
            self.gated_request(
                "POST", f"/api/checkins/{record['id']}/help/resolve", {"actor": "control room"}, identity="jwt"
            ), 200
        )

    def test_public_health_is_liveness_only_and_hides_filesystem_paths(self) -> None:
        self.enable_operator_gate()
        request = Request(self.base + "/api/health", method="GET")
        public = json.loads(urlopen(request, timeout=REQUEST_TIMEOUT).read())
        self.assertEqual(set(public), {"status", "serverTime", "checkinOrigin", "database"})
        self.assertNotIn("sharePath", json.dumps(public))
        # Liveness flag only — never the operational counts beside it.
        self.assertEqual(set(public["database"]), {"ok"})
        self.assertNotIn("activeCheckins", json.dumps(public))
        self.assertNotIn("openHelpRequests", json.dumps(public))

        identified = Request(self.base + "/api/health", method="GET",
                             headers={"Cf-Access-Jwt-Assertion": "jwt"})
        operator = json.loads(urlopen(identified, timeout=REQUEST_TIMEOUT).read())
        self.assertIn("database", operator)
        self.assertIn("scada", operator)

    def test_static_tree_does_not_serve_secrets_or_the_database(self) -> None:
        """The web root is the project directory; only web assets may be served."""
        for path in ("/data/northstar.db", "/data/.northstar-qr-secret", "/data/",
                     "/ieso_backend.py", "/tests/test_api_workflows.py", "/AGENTS.md"):
            with self.subTest(path=path):
                self.assertEqual(self.gated_request("GET", path), 404)
        for path in ("/northstar-clean.html", "/module-layout.js", "/manifest.webmanifest"):
            with self.subTest(path=path):
                self.assertEqual(self.gated_request("GET", path), 200)

    def host_request(
        self, method: str, path: str, payload: object = MISSING, *, host: str, identity: str = ""
    ) -> int:
        """Issue a request that claims to have arrived on ``host``."""
        headers = {"Content-Type": "application/json", "Host": host}
        if identity:
            headers["Cf-Access-Jwt-Assertion"] = identity
        data = None if payload is MISSING else json.dumps(payload).encode("utf-8")
        request = Request(self.base + path, data=data, method=method, headers=headers)
        try:
            return urlopen(request, timeout=REQUEST_TIMEOUT).status
        except HTTPError as error:
            return error.status
        except (URLError, TimeoutError) as error:
            raise _timed_out(request, error) from error

    def test_forged_access_header_cannot_clear_a_distress_call(self) -> None:
        """The worst case on the public hostname is a write, not a read.

        The edge path rule admits ``api/checkins(/.*)?`` because the worker PWA
        POSTs there, so ``/help/acknowledge`` and ``/help/resolve`` reach the
        origin from the internet. Before the Host check, a forged edge header
        let an unauthenticated caller clear a lone worker's alarm from the
        control room's view — the same failure the 2026-08-11 audit found, with
        the gate reopened by a different route.
        """
        record = self.create_checkin()
        self.enable_operator_gate()
        previous = self.backend.CHECKIN_ORIGIN
        self.backend.CHECKIN_ORIGIN = "https://checkin.northstarenergy.ca"
        self.addCleanup(setattr, self.backend, "CHECKIN_ORIGIN", previous)
        public = "checkin.northstarenergy.ca"

        # The worker raises the alarm from their own phone, on that hostname.
        self.assertEqual(
            self.host_request(
                "POST", f"/api/checkins/{record['id']}/help", {"actor": "worker"}, host=public
            ), 200
        )

        # Nothing arriving on the public hostname may clear it, forged or not.
        for action in ("help/acknowledge", "help/resolve", "provisional", "time"):
            with self.subTest(action=action):
                self.assertEqual(
                    self.host_request(
                        "POST", f"/api/checkins/{record['id']}/{action}", {"actor": "x"},
                        host=public, identity="forged",
                    ), 403
                )

        # The alarm is still standing.
        _, live, _ = self.request("GET", f"/api/checkins/{record['id']}")
        self.assertTrue(live["needsHelp"])
        self.assertEqual(live["helpState"], "requested")

        # A real operator on the operator hostname can still clear it.
        self.assertEqual(
            self.host_request(
                "POST", f"/api/checkins/{record['id']}/help/resolve", {"actor": "control room"},
                host="ops.northstarenergy.ca", identity="jwt",
            ), 200
        )

    def test_forged_access_header_cannot_open_the_roster_on_the_public_host(self) -> None:
        """A live probe on 2026-08-11 did exactly this and got the roster back.

        Cloudflare passes a client-supplied Cf-Access-Jwt-Assertion through to
        the origin, so the header alone never proved the edge had authenticated
        anyone. The operator surface does not exist on the public check-in
        hostname, so it is refused there regardless of headers.
        """
        self.create_checkin()
        self.enable_operator_gate()
        previous = self.backend.CHECKIN_ORIGIN
        self.backend.CHECKIN_ORIGIN = "https://checkin.northstarenergy.ca"
        self.addCleanup(setattr, self.backend, "CHECKIN_ORIGIN", previous)

        public = "checkin.northstarenergy.ca"
        for path in ("/api/checkins", "/api/checkins?include=all", "/api/checkins/history",
                     "/api/logbook", "/api/checkin-tokens", "/api/switching/drafts"):
            with self.subTest(path=path):
                self.assertEqual(self.host_request("GET", path, host=public), 403)
                # The forged header must not change the answer.
                self.assertEqual(
                    self.host_request("GET", path, host=public, identity="forged"), 403
                )

        # The worker's own routes are not operator routes and stay open on that
        # same hostname — closing them would break every phone in the field.
        record = self.create_checkin()
        self.assertEqual(self.host_request("GET", f"/api/checkins/{record['id']}", host=public), 200)
        self.assertEqual(self.host_request("GET", "/api/health", host=public), 200)

        # The operator hostname is unaffected: an edge identity still works.
        self.assertEqual(
            self.host_request("GET", "/api/checkins", host="ops.northstarenergy.ca", identity="jwt"),
            200,
        )
        self.assertEqual(
            self.host_request("GET", "/api/checkins", host="ops.northstarenergy.ca"), 403
        )

    def test_operator_gate_closes_the_roster_but_not_the_worker_routes(self) -> None:
        record = self.create_checkin()
        self.enable_operator_gate()

        # The operator surface: roster, QR tokens, operational log.
        self.assertEqual(self.gated_request("GET", "/api/checkins"), 403)
        self.assertEqual(self.gated_request("GET", "/api/checkin-tokens"), 403)
        self.assertEqual(self.gated_request("GET", "/api/logbook"), 403)
        self.assertEqual(self.gated_request("GET", "/api/scada"), 403)

        # The same routes open once Cloudflare Access has vouched for the user.
        self.assertEqual(self.gated_request("GET", "/api/checkins", identity="jwt"), 200)
        self.assertEqual(self.gated_request("GET", "/api/logbook", identity="jwt"), 200)

        # A worker device carries no identity and must keep working.
        self.assertEqual(self.gated_request("GET", f"/api/checkins/{record['id']}"), 200)
        self.assertEqual(
            self.gated_request("POST", f"/api/checkins/{record['id']}/heartbeat", {}), 200
        )
        self.assertEqual(
            self.gated_request("POST", "/api/checkins", {"name": "Walk Up", "site": "Kenora"}),
            201,
        )
        self.assertEqual(self.gated_request("DELETE", f"/api/checkins/{record['id']}"), 200)

    def test_health_publishes_the_checkin_origin_for_qr_placards(self) -> None:
        previous = self.backend.CHECKIN_ORIGIN
        self.backend.CHECKIN_ORIGIN = "https://checkin.northstarenergy.ca"
        self.addCleanup(setattr, self.backend, "CHECKIN_ORIGIN", previous)
        _, health, _ = self.request("GET", "/api/health")
        self.assertEqual(health["checkinOrigin"], "https://checkin.northstarenergy.ca")

    def test_cors_origin_can_be_pinned_for_a_public_deployment(self) -> None:
        previous = self.backend.ALLOWED_ORIGIN
        self.backend.ALLOWED_ORIGIN = "https://checkin.example.com"
        self.addCleanup(setattr, self.backend, "ALLOWED_ORIGIN", previous)
        _, _, headers = self.request("GET", "/api/health")
        self.assertEqual(headers["Access-Control-Allow-Origin"], "https://checkin.example.com")

    def test_single_checkin_lookup_does_not_expose_the_roster(self) -> None:
        mine = self.create_checkin()
        status, other, _ = self.request(
            "POST", "/api/checkins", {"name": "Other Worker", "site": "Kenora"}
        )
        self.assertEqual(status, 201)

        status, record, _ = self.request("GET", f"/api/checkins/{mine['id']}")
        self.assertEqual(status, 200)
        self.assertEqual(record["id"], mine["id"])
        self.assertNotIsInstance(record, list)
        self.assertNotIn(other["id"], json.dumps(record))

        status, missing, _ = self.request("GET", "/api/checkins/does-not-exist")
        self.assertEqual(status, 404)
        self.assertIn("not found", missing["error"])

    def test_help_lifecycle_and_shadow_logbook(self) -> None:
        record = self.create_checkin()
        status, requested, _ = self.request(
            "POST", f"/api/checkins/{record['id']}/help", {"actor": "worker tablet"}
        )
        self.assertEqual(status, 200)
        self.assertEqual(requested["helpState"], "requested")

        status, acknowledged, _ = self.request(
            "POST",
            f"/api/checkins/{record['id']}/help/acknowledge",
            {"actor": "shift lead"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(acknowledged["helpAcknowledgedBy"], "shift lead")

        status, resolved, _ = self.request(
            "POST", f"/api/checkins/{record['id']}/help/resolve", {"actor": "control room"}
        )
        self.assertEqual(status, 200)
        self.assertFalse(resolved["needsHelp"])

        _, events, _ = self.request("GET", f"/api/checkins/history?id={record['id']}")
        self.assertEqual(
            [event["event"] for event in events[:3]],
            ["help resolved", "help acknowledged", "help requested"],
        )
        _, logs, _ = self.request("GET", "/api/logbook")
        types = [entry["type"] for entry in logs]
        self.assertIn("Staff help requested", types)
        self.assertIn("Staff help acknowledged", types)
        self.assertIn("Staff help resolved", types)
        request_log = next(entry for entry in logs if entry["type"] == "Staff help requested")
        self.assertIn("shadow mode", request_log["details"])

    def test_help_after_checkout_is_conflict(self) -> None:
        record = self.create_checkin()
        self.request("DELETE", f"/api/checkins/{record['id']}")
        status, error, _ = self.request("POST", f"/api/checkins/{record['id']}/help", {})
        self.assertEqual(status, 409)
        self.assertIn("after checkout", error["error"])

    def test_outage_history_records_actor_and_is_idempotent(self) -> None:
        status, outage, _ = self.request(
            "POST",
            "/api/outages",
            {
                "title": "Unit unavailable",
                "asset": "GEN-01",
                "site": "Kenora",
                "type": "Planned",
                "actor": "operator A",
            },
        )
        self.assertEqual(status, 201)
        self.assertEqual(outage["openedBy"], "operator A")
        self.assertEqual(outage["asset"], "GEN-01")
        self.assertEqual(outage["type"], "Planned")
        status, closed, _ = self.request(
            "POST",
            f"/api/outages/{outage['id']}/close",
            {"actor": "operator B", "details": "unit returned"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(closed["closedBy"], "operator B")
        self.request(
            "POST", f"/api/outages/{outage['id']}/close", {"actor": "operator C"}
        )
        _, history, _ = self.request("GET", f"/api/outages/history?id={outage['id']}")
        self.assertEqual([event["event"] for event in history], ["closed", "opened"])
        self.assertEqual(history[0]["actor"], "operator B")
        self.assertEqual(history[0]["details"], "unit returned")

    def test_malformed_and_non_object_json_return_errors_without_killing_server(self) -> None:
        status, body, _ = self.request("POST", "/api/checkins", raw=b"{broken")
        self.assertEqual(status, 400)
        self.assertIn("valid JSON", body["error"])
        status, body, _ = self.request("POST", "/api/checkins", payload=["not", "an", "object"])
        self.assertEqual(status, 400)
        self.assertIn("JSON object", body["error"])
        status, records, _ = self.request("GET", "/api/checkins")
        self.assertEqual(status, 200)
        self.assertEqual(records, [])

    def test_oversized_json_is_rejected(self) -> None:
        status, body, _ = self.request(
            "POST", "/api/logbook", {"subject": "large", "details": "x" * 70000}
        )
        self.assertEqual(status, 413)
        self.assertIn("exceeds", body["error"])

    def test_api_errors_and_preflight_are_json_and_cors_enabled(self) -> None:
        status, body, headers = self.request("POST", "/api/checkins", {})
        self.assertEqual(status, 400)
        self.assertEqual(body["error"], "name and site are required")
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")
        status, body, headers = self.request("OPTIONS", "/api/checkins")
        self.assertEqual(status, 204)
        self.assertIsNone(body)
        self.assertIn("POST", headers["Access-Control-Allow-Methods"])

    def test_health_reports_database_and_operational_counts(self) -> None:
        record = self.create_checkin()
        self.request("POST", f"/api/checkins/{record['id']}/help", {})
        self.request("POST", "/api/outages", {"title": "Health-count outage"})
        status, health, _ = self.request("GET", "/api/health")
        self.assertEqual(status, 200)
        self.assertTrue(health["database"]["ok"])
        self.assertEqual(health["database"]["activeCheckins"], 1)
        self.assertEqual(health["database"]["openHelpRequests"], 1)
        self.assertEqual(health["database"]["openOutages"], 1)
        self.assertEqual(health["externalNotifications"], "shadow")
        self.assertEqual(health["status"], "degraded")  # market fixture has not refreshed


class OutageStoreTest(unittest.TestCase):
    def test_outage_records_survive_reload(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            os.environ["NORTHSTAR_DB"] = str(Path(directory) / "outages.db")
            try:
                import northstar_store

                store = importlib.reload(northstar_store)
                store.init_db()
                outage = store.create_outage({"title": "Persistent outage", "site": "Kenora"}, "A")
                store.close_outage(outage["id"], "B")
                reloaded = importlib.reload(northstar_store)
                self.assertEqual(reloaded.get_outage(outage["id"])["closedBy"], "B")
                self.assertEqual(len(reloaded.outage_history(outage["id"])), 2)
            finally:
                os.environ.pop("NORTHSTAR_DB", None)


if __name__ == "__main__":
    unittest.main()
