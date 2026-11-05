from __future__ import annotations

import importlib
import os
import tempfile
import unittest
from pathlib import Path


class FieldOperationsWorkflowTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        os.environ["NORTHSTAR_DB"] = str(Path(self.directory.name) / "field-ops.db")
        import northstar_store
        self.store = importlib.reload(northstar_store)
        self.store.init_db()

    def tearDown(self) -> None:
        self.directory.cleanup()
        os.environ.pop("NORTHSTAR_DB", None)

    def create_report(self):
        return self.store.create_field_report({
            "station": "Iroquois Falls", "area": "Unit 1", "category": "DEFICIENCY",
            "priority": "PRIORITY", "title": "Oil seep at governor cabinet",
            "conditions": "Fresh oil film below the cabinet; no active spray.",
            "immediateActions": "Area marked and absorbent placed.",
            "outstandingWork": "Maintenance inspection required.",
        }, "field.user@example.test")

    def test_report_persists_and_history_is_append_only(self) -> None:
        report = self.create_report()
        self.assertEqual(report["status"], "SUBMITTED")
        updated = self.store.transition_field_report(report["id"], {
            "status": "ACKNOWLEDGED", "assignedTo": "maintenance", "version": report["version"]
        }, "control.room@example.test")
        self.assertEqual(updated["assignedTo"], "maintenance")
        self.assertEqual(len(self.store.field_report_history(report["id"])), 2)
        self.assertEqual(self.store.list_field_reports()[0]["status"], "ACKNOWLEDGED")

    def test_stale_report_update_is_rejected(self) -> None:
        report = self.create_report()
        self.store.transition_field_report(report["id"], {"status": "ACKNOWLEDGED", "version": 1}, "operator")
        with self.assertRaisesRegex(ValueError, "changed"):
            self.store.transition_field_report(report["id"], {"status": "ASSIGNED", "version": 1}, "operator")

    def test_action_item_links_to_report_and_closes_without_deletion(self) -> None:
        report = self.create_report()
        action = self.store.create_action_item({
            "reportId": report["id"], "station": report["station"], "title": "Inspect governor cabinet",
            "details": "Confirm source and repair plan.", "priority": "PRIORITY",
        }, "operator")
        closed = self.store.transition_action_item(action["id"], {
            "status": "CLOSED", "version": 1, "resolutionEvidence": "Inspection completed; work order WO-42 closed."
        }, "operator")
        self.assertEqual(closed["status"], "CLOSED")
        self.assertEqual(self.store.list_action_items(), [])
        self.assertEqual(self.store.list_action_items(include_closed=True)[0]["reportId"], report["id"])

    def test_required_fields_are_enforced(self) -> None:
        with self.assertRaisesRegex(ValueError, "required"):
            self.store.create_field_report({"station": "Iroquois Falls"}, "operator")

    def test_attachment_is_hashed_retained_and_audited(self) -> None:
        report = self.create_report()
        attachment = self.store.add_field_report_attachment(
            report["id"], "condition.txt", "text/plain", b"observed evidence", "field.worker"
        )
        self.assertEqual(len(attachment["sha256"]), 64)
        self.assertEqual(self.store.get_field_report_attachment(report["id"], attachment["attachmentId"])["content"], b"observed evidence")
        self.assertEqual(self.store.field_report_history(report["id"])[0]["event"], "attachment_added")

    def test_summary_reports_overdue_and_unacknowledged_work(self) -> None:
        report = self.create_report()
        self.store.create_action_item({
            "reportId": report["id"], "station": report["station"], "title": "Past due action",
            "dueAt": "2020-01-01T00:00:00-04:00",
        }, "operator")
        summary = self.store.field_operations_summary()
        self.assertEqual(summary["unacknowledged"], 1)
        self.assertEqual(summary["overdueActions"], 1)
        self.assertIn("Iroquois Falls", summary["stations"])

    def test_verification_requires_resolution_evidence(self) -> None:
        report = self.create_report()
        action = self.store.create_action_item({
            "reportId": report["id"], "station": report["station"], "title": "Verify repair"
        }, "operator")
        with self.assertRaisesRegex(ValueError, "evidence"):
            self.store.transition_action_item(action["id"], {"status": "VERIFIED", "version": 1}, "operator")

    def test_readiness_registry_never_enables_switching_release(self) -> None:
        initial = self.store.readiness_summary()
        self.assertFalse(initial["switchingReleaseEnabled"])
        self.assertEqual(initial["totalDecisions"], 8)
        source = self.store.save_controlled_source({
            "sourceType": "PROCEDURE", "title": "Test controlled procedure", "revision": "TEST-1",
            "documentOwner": "procedure owner", "status": "CURRENT", "effectiveAt": "2026-08-27",
            "referenceUri": "controlled://procedures/test-1",
        }, "administrator")
        asset = self.store.save_asset({
            "station": "Iroquois Falls", "designation": "TEST-52A", "assetType": "BREAKER",
            "topologyRevision": "TEST-TOPOLOGY-1",
        }, "administrator")
        decision = self.store.save_governance_decision("procedure_owner", {
            "owner": "procedure owner", "status": "APPROVED", "decision": "Owner appointed for pilot.",
            "evidenceRef": "TEST-APPROVAL-1"
        }, "administrator")
        ready = self.store.readiness_summary()
        self.assertEqual(source["status"], "CURRENT")
        self.assertEqual(asset["designation"], "TEST-52A")
        self.assertEqual(decision["status"], "APPROVED")
        self.assertEqual(ready["approvedDecisions"], 1)
        self.assertFalse(ready["switchingReleaseEnabled"])

    def test_readiness_rejects_incomplete_approvals_and_duplicates(self) -> None:
        with self.assertRaisesRegex(ValueError, "owner, decision record, and evidence"):
            self.store.save_governance_decision("procedure_owner", {"status": "APPROVED"}, "administrator")
        with self.assertRaisesRegex(ValueError, "owner, effective date"):
            self.store.save_controlled_source({
                "title": "Incomplete procedure", "revision": "1", "status": "CURRENT"
            }, "administrator")
        self.store.save_asset({"station": "Kenora", "designation": "52A"}, "administrator")
        with self.assertRaisesRegex(ValueError, "already registered"):
            self.store.save_asset({"station": "kenora", "designation": "52a"}, "administrator")

    def test_readiness_reports_asset_and_topology_blockers(self) -> None:
        empty = self.store.readiness_summary()
        self.assertIn("No active canonical assets registered", empty["releaseBlockers"])
        self.store.save_asset({"station": "Kenora", "designation": "52A"}, "administrator")
        summary = self.store.readiness_summary()
        self.assertIn("1 active asset(s) missing topology revision", summary["releaseBlockers"])


if __name__ == "__main__":
    unittest.main()
