"""Operator-gated switching-package draft and review workflow tests."""

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


class SwitchingWorkflowTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        os.environ["NORTHSTAR_DB"] = str(Path(self.directory.name) / "switching.db")
        os.environ["NORTHSTAR_OPERATOR_GATE"] = "off"
        import northstar_store
        import northstar_phase1

        self.store = importlib.reload(northstar_store)
        importlib.reload(northstar_phase1)
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
        os.environ.pop("NORTHSTAR_OPERATOR_GATE", None)

    def request(
        self,
        method: str,
        path: str,
        payload: object | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, object]:
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request_headers = {"Content-Type": "application/json"}
        request_headers.update(headers or {})
        request = Request(
            self.base + path,
            data=data,
            method=method,
            headers=request_headers,
        )
        try:
            response = urlopen(request, timeout=5)
        except HTTPError as error:
            response = error
        body = response.read()
        return response.status, json.loads(body) if body else None

    @staticmethod
    def payload() -> dict[str, object]:
        row = {"first": "FDR-01", "second": "Confirm source-derived condition and responsible role."}
        return {
            "packageName": "APIROQ feeder isolation review",
            "site": "Iroquois Falls",
            "asset": "FDR-01",
            "canonicalAssetId": "asset-fdr-01",
            "topologySnapshotId": "snap-pilot-01",
            "topologyRevision": "topology-rev-01",
            "revision": "REV-7",
            "ruleSet": "UWPC 2024 / EUSR current utility procedure",
            "authorityProcedureId": "uwpc-eusr-approved-procedure",
            "authorityProcedureRevision": "authority-rev-01",
            "qualificationEvidenceRef": "external-qualification-ref-01",
            "scope": "Prepare a controlled review package from the supplied circuit diagram.",
            "diagrams": [{"name": "fdr-01-rev7.pdf", "size": 1024, "type": "application/pdf", "url": "blob:local-only"}],
            "ruleSources": [{"name": "uwpc-procedure.pdf", "size": 2048, "type": "application/pdf"}],
            "sourceManifestDigest": "a" * 64,
            "isolation": [row],
            "sequence": [{"first": "STEP-01", "second": "Read back the source-derived step and required checkback."}],
            "verification": [{"first": "TEST-01", "second": "Record evidence and responsible qualified role."}],
            "permission": [{"first": "BOUNDARY-01", "second": "Confirm controlling authority and safe-work boundary."}],
            "restoration": [{"first": "CLOSE-01", "second": "Confirm closeout conditions and revision return."}],
        }

    def test_draft_persists_through_ready_and_recorded_review(self) -> None:
        status, created = self.request("POST", "/api/switching/drafts", self.payload())
        self.assertEqual(status, 201)
        self.assertIsInstance(created, dict)
        draft_id = created["id"]
        self.assertEqual(created["status"], self.store.SWITCHING_DRAFT)
        self.assertNotIn("url", created["diagrams"][0])
        self.assertEqual(created["sourceManifestDigest"], "a" * 64)
        self.assertEqual(created["audit"][0]["event"], "created")

        changed = self.payload()
        changed["scope"] = "Updated controlled review scope."
        status, saved = self.request("POST", f"/api/switching/drafts/{draft_id}", changed)
        self.assertEqual(status, 200)
        self.assertEqual(saved["scope"], "Updated controlled review scope.")

        stale = self.payload()
        stale["version"] = 1
        status, conflict = self.request("POST", f"/api/switching/drafts/{draft_id}", stale)
        self.assertEqual(status, 409)
        self.assertIn("stale draft version", conflict["error"])

        status, ready = self.request("POST", f"/api/switching/drafts/{draft_id}/ready", {})
        self.assertEqual(status, 200)
        self.assertEqual(ready["status"], self.store.SWITCHING_READY)

        status, loaded = self.request("GET", f"/api/switching/drafts/{draft_id}")
        self.assertEqual(status, 200)
        self.assertEqual(loaded["status"], self.store.SWITCHING_READY)
        self.assertTrue(any(event["event"] == "ready-for-review" for event in loaded["audit"]))

        status, reviewed = self.request(
            "POST",
            f"/api/switching/drafts/{draft_id}/review",
            {
                "reviewerName": "Qualified Reviewer",
                "reviewerRole": "Authorized switching authority",
                "reviewComments": "Reviewed against the current source package; field confirmation remains required.",
                "checks": {key: True for key in self.store.SWITCHING_REVIEW_CHECKS},
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(reviewed["status"], self.store.SWITCHING_REVIEWED)
        self.assertEqual(reviewed["reviewerName"], "Qualified Reviewer")
        self.assertEqual(reviewed["reviewedBy"], "operator console")
        self.assertTrue(any(event["event"] == "review-recorded" for event in reviewed["audit"]))

        status, evidence = self.request("GET", f"/api/switching/drafts/{draft_id}/review-evidence")
        self.assertEqual(status, 200)
        self.assertEqual(evidence["packet"], "13")
        self.assertEqual(evidence["evidenceType"], "UWPC_EUSR_REVIEW_EVIDENCE")
        self.assertTrue(evidence["terminalNonRelease"])
        self.assertEqual(evidence["sourceManifestDigest"], "a" * 64)
        self.assertNotIn("approve", evidence)
        self.assertNotIn("release", evidence)

        status, immutable = self.request("POST", f"/api/switching/drafts/{draft_id}", self.payload())
        self.assertEqual(status, 400)
        self.assertIn("immutable", immutable["error"])

    def test_source_manifest_digest_is_validated_without_storing_file_bytes(self) -> None:
        payload = self.payload()
        payload["sourceManifestDigest"] = "not-a-digest"
        status, rejected = self.request("POST", "/api/switching/drafts", payload)
        self.assertEqual(status, 400)
        self.assertIn("source manifest digest", rejected["error"])

    def test_ready_transition_requires_source_manifest_digest(self) -> None:
        payload = self.payload()
        payload.pop("sourceManifestDigest")
        status, created = self.request("POST", "/api/switching/drafts", payload)
        self.assertEqual(status, 201)
        status, rejected = self.request("POST", f"/api/switching/drafts/{created['id']}/ready", {})
        self.assertEqual(status, 400)
        self.assertIn("source manifest digest", rejected["error"])

    def test_switching_drafts_require_operator_edge_identity_when_enabled(self) -> None:
        self.backend.OPERATOR_GATE = "access"
        status, denied = self.request("GET", "/api/switching/drafts")
        self.assertEqual(status, 403)
        self.assertIn("authentication", denied["error"])

        status, allowed = self.request(
            "GET",
            "/api/switching/drafts",
            headers={
                "Cf-Access-Jwt-Assertion": "test-jwt",
                "Cf-Access-Authenticated-User-Email": "reviewer@example.com",
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(allowed, [])


if __name__ == "__main__":
    unittest.main()
