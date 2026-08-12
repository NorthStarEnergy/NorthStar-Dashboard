"""Tests for the server-side price alert engine.

Run from the project root:

    python -m unittest discover -s tests

Each test gets its own database file, so nothing here touches ``data\\northstar.db``.
"""

from __future__ import annotations

import importlib
import os
import sys
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


class AlertEngineTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        os.environ["NORTHSTAR_DB"] = str(Path(self.directory.name) / "test.db")
        os.environ["NORTHSTAR_ALERT_RECOVERY_MARGIN"] = "2.0"
        import northstar_store

        self.store = importlib.reload(northstar_store)
        self.store.init_db()

    def tearDown(self) -> None:
        self.directory.cleanup()
        os.environ.pop("NORTHSTAR_DB", None)
        os.environ.pop("NORTHSTAR_ALERT_RECOVERY_MARGIN", None)

    def configure(self, node: str = "APIROQ", low: float | None = 10.0, high: float | None = 100.0):
        return self.store.set_alert_setting(
            {"node": node, "low": low, "high": high, "actions": ["in-app", "sound"], "enabled": True}
        )

    # --- raising -------------------------------------------------------

    def test_high_breach_raises_one_alert(self) -> None:
        self.configure()
        changes = self.store.evaluate_price_alerts({"APIROQ": 140.0})
        self.assertEqual(len(changes["raised"]), 1)
        alert = changes["raised"][0]
        self.assertEqual(alert["node"], "APIROQ")
        self.assertEqual(alert["kind"], "high")
        self.assertEqual(alert["state"], self.store.ALERT_ACTIVE)
        self.assertEqual(alert["threshold"], 100.0)
        self.assertEqual(alert["openingPrice"], 140.0)

    def test_low_breach_raises_a_low_alert(self) -> None:
        self.configure()
        changes = self.store.evaluate_price_alerts({"APIROQ": 5.0})
        self.assertEqual([a["kind"] for a in changes["raised"]], ["low"])

    def test_breach_is_inclusive_of_the_threshold(self) -> None:
        self.configure(high=100.0)
        self.assertEqual(len(self.store.evaluate_price_alerts({"APIROQ": 100.0})["raised"]), 1)

    def test_price_inside_the_band_raises_nothing(self) -> None:
        self.configure()
        changes = self.store.evaluate_price_alerts({"APIROQ": 50.0})
        self.assertEqual(changes["raised"], [])
        self.assertEqual(self.store.list_alerts(), [])

    def test_repeat_evaluation_does_not_raise_a_second_alert(self) -> None:
        """The failure that would flood the logbook: one alarm per refresh."""
        self.configure()
        self.store.evaluate_price_alerts({"APIROQ": 140.0})
        for price in (145.0, 150.0, 141.0):
            self.assertEqual(self.store.evaluate_price_alerts({"APIROQ": price})["raised"], [])
        self.assertEqual(len(self.store.list_alerts()), 1)

    def test_unconfigured_node_never_alerts(self) -> None:
        changes = self.store.evaluate_price_alerts({"M1S": 9999.0})
        self.assertEqual(changes["raised"], [])

    def test_disabled_setting_never_alerts(self) -> None:
        self.store.set_alert_setting(
            {"node": "APIROQ", "low": 10.0, "high": 100.0, "actions": [], "enabled": False}
        )
        self.assertEqual(self.store.evaluate_price_alerts({"APIROQ": 500.0})["raised"], [])

    def test_alerts_are_independent_per_node(self) -> None:
        self.configure("APIROQ")
        self.configure("F2B")
        changes = self.store.evaluate_price_alerts({"APIROQ": 140.0, "F2B": 160.0})
        self.assertEqual({a["node"] for a in changes["raised"]}, {"APIROQ", "F2B"})
        self.assertEqual(len(self.store.list_alerts()), 2)

    def test_tracks_the_worst_excursion(self) -> None:
        self.configure()
        self.store.evaluate_price_alerts({"APIROQ": 140.0})
        self.store.evaluate_price_alerts({"APIROQ": 210.0})
        self.store.evaluate_price_alerts({"APIROQ": 160.0})
        alert = self.store.list_alerts()[0]
        self.assertEqual(alert["peakPrice"], 210.0)
        self.assertEqual(alert["price"], 160.0)

    def test_low_alert_tracks_the_minimum(self) -> None:
        self.configure()
        self.store.evaluate_price_alerts({"APIROQ": 8.0})
        self.store.evaluate_price_alerts({"APIROQ": -30.0})
        self.assertEqual(self.store.list_alerts()[0]["peakPrice"], -30.0)

    # --- hysteresis and resolution -------------------------------------

    def test_price_just_inside_the_limit_does_not_resolve(self) -> None:
        """Margin 2.0: 99.0 is below the 100.0 limit but inside the dead band."""
        self.configure(high=100.0)
        self.store.evaluate_price_alerts({"APIROQ": 140.0})
        changes = self.store.evaluate_price_alerts({"APIROQ": 99.0})
        self.assertEqual(changes["resolved"], [])
        self.assertEqual(len(self.store.list_alerts()), 1)

    def test_recovery_past_the_margin_resolves(self) -> None:
        self.configure(high=100.0)
        self.store.evaluate_price_alerts({"APIROQ": 140.0})
        changes = self.store.evaluate_price_alerts({"APIROQ": 90.0})
        self.assertEqual(len(changes["resolved"]), 1)
        self.assertEqual(changes["resolved"][0]["state"], self.store.ALERT_RESOLVED)
        self.assertEqual(changes["resolved"][0]["resolvedPrice"], 90.0)
        self.assertEqual(self.store.list_alerts(), [])

    def test_hovering_price_does_not_flap(self) -> None:
        """One alarm, not one per refresh, for a price oscillating on the limit."""
        self.configure(high=100.0)
        for price in (101.0, 99.5, 100.5, 99.0, 102.0, 99.8):
            self.store.evaluate_price_alerts({"APIROQ": price})
        self.assertEqual(len(self.store.list_alerts(include_resolved=True)), 1)
        raised = [e for e in self.store.alert_history() if e["event"] == "raised"]
        self.assertEqual(len(raised), 1)

    def test_a_new_excursion_after_recovery_raises_a_fresh_alert(self) -> None:
        self.configure(high=100.0)
        self.store.evaluate_price_alerts({"APIROQ": 140.0})
        self.store.evaluate_price_alerts({"APIROQ": 50.0})
        changes = self.store.evaluate_price_alerts({"APIROQ": 140.0})
        self.assertEqual(len(changes["raised"]), 1)
        self.assertEqual(len(self.store.list_alerts(include_resolved=True)), 2)

    def test_low_alert_resolves_upward_past_the_margin(self) -> None:
        self.configure(low=10.0)
        self.store.evaluate_price_alerts({"APIROQ": 5.0})
        self.assertEqual(self.store.evaluate_price_alerts({"APIROQ": 11.0})["resolved"], [])
        self.assertEqual(len(self.store.evaluate_price_alerts({"APIROQ": 13.0})["resolved"]), 1)

    def test_missing_price_holds_the_alarm_open(self) -> None:
        """A dead feed is not a recovery."""
        self.configure()
        self.store.evaluate_price_alerts({"APIROQ": 140.0})
        changes = self.store.evaluate_price_alerts({"APIROQ": None})
        self.assertEqual(changes["resolved"], [])
        self.assertEqual(len(self.store.list_alerts()), 1)

    def test_node_absent_from_the_feed_holds_the_alarm_open(self) -> None:
        self.configure()
        self.store.evaluate_price_alerts({"APIROQ": 140.0})
        self.store.evaluate_price_alerts({})
        self.assertEqual(len(self.store.list_alerts()), 1)

    def test_disabling_alerting_resolves_the_open_alarm(self) -> None:
        self.configure()
        self.store.evaluate_price_alerts({"APIROQ": 140.0})
        self.store.set_alert_setting(
            {"node": "APIROQ", "low": 10.0, "high": 100.0, "actions": [], "enabled": False}
        )
        changes = self.store.evaluate_price_alerts({"APIROQ": 140.0})
        self.assertEqual(len(changes["resolved"]), 1)
        self.assertEqual(self.store.list_alerts(), [])

    def test_raising_the_threshold_mid_excursion_reraises_against_the_new_limit(self) -> None:
        self.configure(high=100.0)
        self.store.evaluate_price_alerts({"APIROQ": 140.0})
        self.configure(high=120.0)
        changes = self.store.evaluate_price_alerts({"APIROQ": 140.0})
        self.assertEqual(len(changes["resolved"]), 1)
        self.assertEqual(len(changes["raised"]), 1)
        self.assertEqual(changes["raised"][0]["threshold"], 120.0)
        self.assertEqual(len(self.store.list_alerts()), 1)

    def test_widening_the_threshold_past_the_price_leaves_no_alarm(self) -> None:
        self.configure(high=100.0)
        self.store.evaluate_price_alerts({"APIROQ": 140.0})
        self.configure(high=300.0)
        changes = self.store.evaluate_price_alerts({"APIROQ": 140.0})
        self.assertEqual(len(changes["resolved"]), 1)
        self.assertEqual(changes["raised"], [])
        self.assertEqual(self.store.list_alerts(), [])

    # --- acknowledgement -----------------------------------------------

    def test_acknowledge_records_who_and_when(self) -> None:
        self.configure()
        alert = self.store.evaluate_price_alerts({"APIROQ": 140.0})["raised"][0]
        acknowledged = self.store.acknowledge_alert(alert["id"], "control room A")
        self.assertEqual(acknowledged["state"], self.store.ALERT_ACKNOWLEDGED)
        self.assertEqual(acknowledged["acknowledgedBy"], "control room A")
        self.assertIsNotNone(acknowledged["acknowledgedAt"])

    def test_acknowledge_does_not_end_the_alert(self) -> None:
        """Silencing is not resolving — the record stays open until the price recovers."""
        self.configure()
        alert = self.store.evaluate_price_alerts({"APIROQ": 140.0})["raised"][0]
        self.store.acknowledge_alert(alert["id"], "operator")
        self.assertEqual(len(self.store.list_alerts()), 1)
        self.store.evaluate_price_alerts({"APIROQ": 145.0})
        self.assertEqual(len(self.store.list_alerts()), 1)

    def test_acknowledged_alert_still_resolves_on_recovery(self) -> None:
        self.configure()
        alert = self.store.evaluate_price_alerts({"APIROQ": 140.0})["raised"][0]
        self.store.acknowledge_alert(alert["id"], "operator")
        changes = self.store.evaluate_price_alerts({"APIROQ": 50.0})
        self.assertEqual(len(changes["resolved"]), 1)
        self.assertEqual(changes["resolved"][0]["acknowledgedBy"], "operator")

    def test_double_acknowledge_keeps_the_first(self) -> None:
        self.configure()
        alert = self.store.evaluate_price_alerts({"APIROQ": 140.0})["raised"][0]
        first = self.store.acknowledge_alert(alert["id"], "operator one")
        second = self.store.acknowledge_alert(alert["id"], "operator two")
        self.assertEqual(second["acknowledgedBy"], "operator one")
        self.assertEqual(second["acknowledgedAt"], first["acknowledgedAt"])

    def test_acknowledging_an_unknown_alert_returns_none(self) -> None:
        self.assertIsNone(self.store.acknowledge_alert("alert-does-not-exist"))

    def test_acknowledging_a_resolved_alert_is_a_no_op(self) -> None:
        self.configure()
        alert = self.store.evaluate_price_alerts({"APIROQ": 140.0})["raised"][0]
        self.store.evaluate_price_alerts({"APIROQ": 50.0})
        result = self.store.acknowledge_alert(alert["id"], "late operator")
        self.assertEqual(result["state"], self.store.ALERT_RESOLVED)
        self.assertIsNone(result["acknowledgedBy"])

    # --- audit trail ---------------------------------------------------

    def test_every_transition_is_audited(self) -> None:
        self.configure()
        alert = self.store.evaluate_price_alerts({"APIROQ": 140.0})["raised"][0]
        self.store.acknowledge_alert(alert["id"], "operator")
        self.store.evaluate_price_alerts({"APIROQ": 50.0})
        events = self.store.alert_history(alert["id"])
        self.assertEqual([e["event"] for e in events], ["resolved", "acknowledged", "raised"])
        for event in events:
            self.assertTrue(event["at"])
            self.assertTrue(event["actor"])
            self.assertEqual(event["node"], "APIROQ")
        self.assertEqual(events[-1]["priorState"], None)
        self.assertEqual(events[-1]["newState"], self.store.ALERT_ACTIVE)
        self.assertEqual(events[0]["newState"], self.store.ALERT_RESOLVED)

    def test_records_are_never_deleted(self) -> None:
        self.configure()
        self.store.evaluate_price_alerts({"APIROQ": 140.0})
        self.store.evaluate_price_alerts({"APIROQ": 50.0})
        self.assertEqual(self.store.list_alerts(), [])
        self.assertEqual(len(self.store.list_alerts(include_resolved=True)), 1)

    def test_history_is_scoped_by_alert(self) -> None:
        self.configure("APIROQ")
        self.configure("F2B")
        changes = self.store.evaluate_price_alerts({"APIROQ": 140.0, "F2B": 160.0})
        first = changes["raised"][0]
        scoped = self.store.alert_history(first["id"])
        self.assertEqual(len(scoped), 1)
        self.assertEqual(len(self.store.alert_history()), 2)

    def test_alerts_survive_a_reimport(self) -> None:
        """Proxy for a backend restart: state is in the file, not the process."""
        self.configure()
        alert = self.store.evaluate_price_alerts({"APIROQ": 140.0})["raised"][0]
        self.store.acknowledge_alert(alert["id"], "operator")
        import northstar_store

        reloaded = importlib.reload(northstar_store)
        survivors = reloaded.list_alerts()
        self.assertEqual(len(survivors), 1)
        self.assertEqual(survivors[0]["id"], alert["id"])
        self.assertEqual(survivors[0]["acknowledgedBy"], "operator")
        self.assertEqual(len(reloaded.alert_history(alert["id"])), 2)

    # --- settings validation -------------------------------------------

    def test_overlapping_limits_are_rejected(self) -> None:
        with self.assertRaises(ValueError):
            self.store.set_alert_setting({"node": "APIROQ", "low": 100.0, "high": 10.0})

    def test_equal_limits_are_rejected(self) -> None:
        with self.assertRaises(ValueError):
            self.store.set_alert_setting({"node": "APIROQ", "low": 50.0, "high": 50.0})

    def test_missing_node_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            self.store.set_alert_setting({"low": 1.0, "high": 2.0})

    def test_a_single_sided_limit_is_allowed(self) -> None:
        record = self.store.set_alert_setting({"node": "APIROQ", "high": 100.0})
        self.assertIsNone(record["low"])
        self.assertEqual(self.store.evaluate_price_alerts({"APIROQ": -50.0})["raised"], [])
        self.assertEqual(len(self.store.evaluate_price_alerts({"APIROQ": 140.0})["raised"]), 1)

    def test_non_numeric_limit_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            self.store.set_alert_setting({"node": "APIROQ", "high": "not a price"})

    def test_blank_limit_reads_as_unset(self) -> None:
        record = self.store.set_alert_setting({"node": "APIROQ", "low": "", "high": 100.0})
        self.assertIsNone(record["low"])


class OverdueRegressionTest(unittest.TestCase):
    """The field-staff rules the alert work must not disturb."""

    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        os.environ["NORTHSTAR_DB"] = str(Path(self.directory.name) / "test.db")
        import northstar_store

        self.store = importlib.reload(northstar_store)
        self.store.init_db()

    def tearDown(self) -> None:
        self.directory.cleanup()
        os.environ.pop("NORTHSTAR_DB", None)

    def test_checkout_closes_rather_than_deletes(self) -> None:
        record = self.store.create_checkin({"name": "Sam R.", "site": "Kenora"})
        self.store.check_out(record["id"])
        self.assertEqual(self.store.list_checkins(), [])
        self.assertEqual(len(self.store.list_checkins(include_closed=True)), 1)

    def test_lone_worker_goes_overdue_at_the_hour(self) -> None:
        record = self.store.create_checkin({"name": "Sam R.", "site": "Kenora", "alone": True})
        self.assertEqual(record["overdueAfterMinutes"], 60)
        from datetime import datetime

        later = datetime.now(self.store.TZ) + timedelta(minutes=61)
        changed = self.store.evaluate_overdue(later)
        self.assertEqual([c["id"] for c in changed], [record["id"]])

    def test_heartbeat_clears_overdue(self) -> None:
        from datetime import datetime

        record = self.store.create_checkin({"name": "Sam R.", "site": "Kenora", "alone": True})
        self.store.evaluate_overdue(datetime.now(self.store.TZ) + timedelta(minutes=61))
        cleared = self.store.record_heartbeat(record["id"])
        self.assertEqual(cleared["status"], self.store.STATUS_ON_SITE)
        self.assertFalse(cleared["overdue"])

    def test_blank_name_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            self.store.create_checkin({"name": "   ", "site": "Kenora"})

    def test_provisional_acceptance_records_operator_and_closes_rejection(self) -> None:
        accepted = self.store.create_checkin({"name": "Alex P.", "site": "Kenora", "provisional": True})
        self.store.resolve_provisional(accepted["id"], True, "shift lead")
        accepted_events = self.store.history(accepted["id"])
        self.assertEqual(accepted_events[0]["actor"], "shift lead")
        self.assertEqual(accepted_events[0]["newStatus"], self.store.STATUS_ON_SITE)

        rejected = self.store.create_checkin({"name": "Contractor B.", "site": "Kenora", "provisional": True})
        self.store.resolve_provisional(rejected["id"], False, "control room")
        open_records = self.store.list_checkins()
        self.assertEqual([record["id"] for record in open_records], [accepted["id"]])
        self.assertEqual(open_records[0]["status"], self.store.STATUS_ON_SITE)
        rejected_events = self.store.history(rejected["id"])
        self.assertEqual(rejected_events[0]["actor"], "control room")
        self.assertEqual(rejected_events[0]["newStatus"], self.store.STATUS_CHECKED_OUT)


if __name__ == "__main__":
    unittest.main()
