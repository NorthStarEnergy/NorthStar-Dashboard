"""Demo station views must never read or mutate operational roster data."""
from unittest.mock import patch
from collections import Counter
from datetime import datetime, timedelta, timezone
import northstar_demo_roster
import test_demo_auth as auth_tests
import unittest
PUBLIC_HOST = auth_tests.PUBLIC_HOST

class PlatformDemoWorkersTest(unittest.TestCase):
    setUp = auth_tests.DemoAuthTest.setUp
    tearDown = auth_tests.DemoAuthTest.tearDown
    call = auth_tests.DemoAuthTest.call
    create_checkin = auth_tests.DemoAuthTest.create_checkin
    session_cookie = auth_tests.DemoAuthTest.session_cookie
    sign_in = auth_tests.DemoAuthTest.sign_in
    def test_platform_demo_station_roster_is_isolated(self):
        record = self.create_checkin()
        token, _ = self.backend.DEMO_SESSIONS.create("demo", 600, role=self.auth.ROLE_PLATFORM_DEMO)
        cookie = f"{self.auth.COOKIE_NAME}={token}"
        with patch.object(self.store, "list_checkins", side_effect=AssertionError("real roster accessed")):
            for route in ("/api/checkins", "/api/checkins?include=all", "/api/checkins?ts=1"):
                status, body, _ = self.call("GET", route, cookie=cookie)
                self.assertEqual(status, 200)
                self.assertEqual(len(body), 33)
                counts = Counter(row["siteId"] for row in body)
                self.assertEqual(len(counts), 10)
                staff = Counter(r["siteId"] for r in body if r["kind"] == "Northstar")
                contractors = Counter(r["siteId"] for r in body if r["kind"] == "Contractor")
                self.assertEqual(len(staff), 10)
                self.assertTrue(all(1 <= n <= 3 for n in staff.values()))
                self.assertEqual(sorted(contractors.values()), [2, 3, 4, 5])
                self.assertTrue(all(1 <= n <= 8 for n in counts.values()))
                self.assertEqual(len({row["id"] for row in body}), len(body))
                self.assertNotIn(record["id"], {row["id"] for row in body})
                self.assertTrue(all(row["status"] == "on-site" for row in body))
                self.assertTrue(all(row["site"] == self.backend.PLATFORM_DEMO_STATION_NAMES[row["siteId"]] for row in body))
                self.assertTrue(all(datetime.now(timezone.utc) - datetime.fromisoformat(row["lastHeard"]) < timedelta(minutes=15) for row in body))
        status, catalog, _ = self.call("GET", "/api/sites", cookie=cookie)
        self.assertEqual(status, 200)
        self.assertEqual({row["name"] for row in catalog["stations"]},
                         {name for sid, name in self.backend.PLATFORM_DEMO_STATION_NAMES.items() if sid != self.backend.sites.SYSTEM_ID})
        self.assertEqual(self.backend.PLATFORM_DEMO_STATION_NAMES, {r["id"]: r["name"] for r in self.backend.sites.known()})
        for route in ("/api/checkins/history", f"/api/checkins/{record['id']}"):
            self.assertEqual(self.call("GET", route, cookie=cookie)[0], 403)
        for method, route in (("POST", "/api/checkins"), ("DELETE", f"/api/checkins/{record['id']}"),
                              ("POST", f"/api/checkins/{record['id']}/heartbeat")):
            self.assertEqual(self.call(method, route, {}, cookie=cookie)[0], 403)
        self.assertEqual(self.call("GET", "/api/checkins", cookie=cookie, host=PUBLIC_HOST)[0], 403)
        self.assertEqual(self.call("GET", "/api/checkins")[0], 401)
        status, rows, _ = self.call("GET", "/api/checkins", cookie=self.session_cookie())
        self.assertEqual(status, 200)
        self.assertIn(record['id'], [row['id'] for row in rows])

    def test_roster_stays_stable_and_fresh_without_storage(self):
        now = datetime(2026, 10, 13, tzinfo=timezone.utc)
        args = (self.backend.PLATFORM_DEMO_STATION_NAMES, self.backend.sites.SYSTEM_ID)
        before = northstar_demo_roster.roster(*args, now=now)
        later = northstar_demo_roster.roster(*args, now=now + timedelta(days=3))
        self.assertEqual([(r["id"], r["name"], r["siteId"]) for r in before],
                         [(r["id"], r["name"], r["siteId"]) for r in later])
        self.assertTrue(all(datetime.fromisoformat(b["lastHeard"]) - datetime.fromisoformat(a["lastHeard"]) == timedelta(days=3) for a, b in zip(before, later)))
        self.assertEqual(len({r["name"] for r in before}), len(before))
        counts = Counter(r["siteId"] for r in before)
        self.assertTrue(all(r["alone"] == (counts[r["siteId"]] == 1) for r in before))
