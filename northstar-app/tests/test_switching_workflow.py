"""Operator-gated switching-package draft and review workflow tests."""

from __future__ import annotations

import importlib
import hashlib
import io
import json
import os
import sqlite3
import sys
import tempfile
import threading
import unittest
import zipfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


class SwitchingMigrationTest(unittest.TestCase):
    def test_legacy_switching_table_adds_link_columns_before_outage_index(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "legacy-switching.db"
            connection = sqlite3.connect(database)
            try:
                connection.execute(
                    """CREATE TABLE switching_drafts (
                    id TEXT PRIMARY KEY, status TEXT NOT NULL,
                    updated_at TEXT NOT NULL, record_version INTEGER NOT NULL DEFAULT 1
                    )"""
                )
                connection.commit()
            finally:
                connection.close()

            prior_database = os.environ.get("NORTHSTAR_DB")
            os.environ["NORTHSTAR_DB"] = str(database)
            try:
                import northstar_store

                store = importlib.reload(northstar_store)
                store.init_db()
                connection = sqlite3.connect(database)
                try:
                    columns = {
                        row[1] for row in connection.execute(
                            "PRAGMA table_info(switching_drafts)"
                        )
                    }
                    indexes = {
                        row[1] for row in connection.execute(
                            "PRAGMA index_list(switching_drafts)"
                        )
                    }
                finally:
                    connection.close()
                self.assertIn("outage_id", columns)
                self.assertIn("schematic_id", columns)
                self.assertIn("idx_switching_drafts_outage", indexes)
            finally:
                if prior_database is None:
                    os.environ.pop("NORTHSTAR_DB", None)
                else:
                    os.environ["NORTHSTAR_DB"] = prior_database


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

    def raw_request(
        self,
        method: str,
        path: str,
        data: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, bytes, object]:
        request = Request(self.base + path, data=data, method=method, headers=headers or {})
        try:
            response = urlopen(request, timeout=5)
        except HTTPError as error:
            response = error
        return response.status, response.read(), response.headers

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

        for kind, filename, content_type, content in (
            ("diagram", "fdr-01-rev7.pdf", "application/pdf", b"%PDF-1.7\ndiagram"),
            ("source", "uwpc-procedure.pdf", "application/pdf", b"%PDF-1.7\nprocedure"),
        ):
            upload_status, _, _ = self.raw_request(
                "POST",
                f"/api/switching/drafts/{draft_id}/attachments?kind={kind}",
                content,
                {"Content-Type": content_type, "X-Northstar-Filename": filename},
            )
            self.assertEqual(upload_status, 200)

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
        self.assertEqual(len(evidence["sourceManifestDigest"]), 64)
        self.assertNotEqual(evidence["sourceManifestDigest"], "a" * 64)
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

    def test_source_bytes_are_stored_downloaded_and_removed_through_operator_routes(self) -> None:
        payload = self.payload()
        payload["diagrams"] = [{"name": "fdr-01-rev7.pdf", "size": 16, "type": "application/pdf"}]
        status, created = self.request("POST", "/api/switching/drafts", payload)
        self.assertEqual(status, 201)
        draft_id = created["id"]
        source = b"%PDF-1.7\nsource\n"
        status, body, _ = self.raw_request(
            "POST",
            f"/api/switching/drafts/{draft_id}/attachments?kind=diagram",
            source,
            {
                "Content-Type": "application/pdf",
                "X-Northstar-Filename": "fdr-01-rev7.pdf",
            },
        )
        self.assertEqual(status, 200)
        stored = json.loads(body)
        self.assertEqual(len(stored["diagrams"]), 1)
        attachment = stored["diagrams"][0]
        self.assertEqual(attachment["storage"], "SERVER")
        self.assertEqual(len(attachment["sha256"]), 64)

        status, downloaded, headers = self.raw_request(
            "GET", f"/api/switching/drafts/{draft_id}/attachments/{attachment['attachmentId']}"
        )
        self.assertEqual(status, 200)
        self.assertEqual(downloaded, source)
        self.assertEqual(headers["X-Content-SHA256"], attachment["sha256"])

        status, body, _ = self.raw_request(
            "DELETE", f"/api/switching/drafts/{draft_id}/attachments/{attachment['attachmentId']}"
        )
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["diagrams"], [])

    def test_controlled_bundle_and_server_revision_preserve_sources_without_release(self) -> None:
        status, created = self.request("POST", "/api/switching/drafts", self.payload())
        self.assertEqual(status, 201)
        draft_id = created["id"]
        source_bytes = {
            "diagram": b"%PDF-1.7\ncontrolled diagram",
            "source": b"%PDF-1.7\ncontrolled procedure",
        }
        for kind, filename in (("diagram", "fdr-01.pdf"), ("source", "uwpc.pdf")):
            upload_status, _, _ = self.raw_request(
                "POST",
                f"/api/switching/drafts/{draft_id}/attachments?kind={kind}",
                source_bytes[kind],
                {"Content-Type": "application/pdf", "X-Northstar-Filename": filename},
            )
            self.assertEqual(upload_status, 200)
        status, ready = self.request("POST", f"/api/switching/drafts/{draft_id}/ready", {})
        self.assertEqual(status, 200)
        status, reviewed = self.request(
            "POST",
            f"/api/switching/drafts/{draft_id}/review",
            {
                "reviewerName": "Qualified Reviewer",
                "reviewerRole": "Authorized switching authority",
                "reviewComments": "Evidence review complete; this is not an operational release.",
                "checks": {key: True for key in self.store.SWITCHING_REVIEW_CHECKS},
                "version": ready["version"],
            },
        )
        self.assertEqual(status, 200)

        status, bundle_bytes, headers = self.raw_request(
            "GET", f"/api/switching/drafts/{draft_id}/bundle"
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers.get_content_type(), "application/zip")
        self.assertEqual(headers["X-Content-SHA256"], hashlib.sha256(bundle_bytes).hexdigest())
        with zipfile.ZipFile(io.BytesIO(bundle_bytes)) as archive:
            names = archive.namelist()
            self.assertIn("package.json", names)
            self.assertIn("review-evidence.json", names)
            self.assertIn("bundle-manifest.json", names)
            manifest = json.loads(archive.read("bundle-manifest.json"))
            package = json.loads(archive.read("package.json"))
            evidence = json.loads(archive.read("review-evidence.json"))
            self.assertEqual(manifest["attachmentCount"], 2)
            self.assertTrue(manifest["terminalNonRelease"])
            self.assertTrue(evidence["terminalNonRelease"])
            self.assertEqual(package["status"], self.store.SWITCHING_REVIEWED)
            self.assertEqual(
                {archive.read(item["path"]) for item in manifest["sources"]},
                set(source_bytes.values()),
            )
            self.assertTrue(
                any(event["event"] == "controlled-bundle-exported" for event in package["audit"])
            )

        status, stale = self.request(
            "POST", f"/api/switching/drafts/{draft_id}/clone", {"version": 1}
        )
        self.assertEqual(status, 409)
        self.assertIn("stale draft version", stale["error"])
        status, cloned = self.request(
            "POST",
            f"/api/switching/drafts/{draft_id}/clone",
            {"version": reviewed["version"]},
        )
        self.assertEqual(status, 201)
        self.assertNotEqual(cloned["id"], draft_id)
        self.assertEqual(cloned["status"], self.store.SWITCHING_DRAFT)
        self.assertEqual(cloned["version"], 1)
        self.assertEqual(cloned["revision"], "")
        self.assertEqual(cloned["qualificationEvidenceRef"], "")
        self.assertEqual(cloned["reviewerName"], "")
        self.assertFalse(any(cloned["checks"].values()))
        self.assertEqual(len(cloned["diagrams"]), 1)
        self.assertEqual(len(cloned["ruleSources"]), 1)
        self.assertNotEqual(
            cloned["diagrams"][0]["attachmentId"], reviewed["diagrams"][0]["attachmentId"]
        )
        self.assertTrue(any(event["event"] == "revision-created" for event in cloned["audit"]))
        status, copied, _ = self.raw_request(
            "GET",
            f"/api/switching/drafts/{cloned['id']}/attachments/{cloned['diagrams'][0]['attachmentId']}",
        )
        self.assertEqual(status, 200)
        self.assertEqual(copied, source_bytes["diagram"])
        status, original = self.request("GET", f"/api/switching/drafts/{draft_id}")
        self.assertEqual(status, 200)
        self.assertEqual(original["status"], self.store.SWITCHING_REVIEWED)
        self.assertTrue(any(event["event"] == "revision-cloned" for event in original["audit"]))

    def test_one_line_documents_are_server_versioned_and_link_to_outages(self) -> None:
        status, outage = self.request(
            "POST",
            "/api/outages",
            {"title": "Feeder outage", "asset": "FDR-01", "site": "Iroquois Falls"},
        )
        self.assertEqual(status, 201)
        record = {
            "version": 2,
            "symbols": [
                {"id": "BUS-01", "type": "bus", "x": 300, "y": 200, "label": "Main bus"},
                {"id": "CB-01", "type": "breaker", "x": 500, "y": 200, "deviceFunction": "52"},
            ],
            "edges": [{"id": "old", "from": "BUS-01", "to": "CB-01"}],
        }
        status, created = self.request(
            "POST",
            "/api/schematics",
            {
                "name": "FDR-01 one-line",
                "outageId": outage["id"],
                "standardApprovalRef": "UTILITY-CATALOGUE-REV-3",
                "record": record,
            },
        )
        self.assertEqual(status, 201)
        self.assertEqual(created["revision"], 1)
        self.assertEqual(created["outageId"], outage["id"])
        self.assertEqual(created["record"]["designationStandard"], "IEEE C37.2-2022 (active)")
        self.assertEqual(created["record"]["symbolLibraryProfile"], "northstar-ieee-compat-2026.4")
        self.assertEqual(created["record"]["catalogueVersion"], "2026.4")

        changed = dict(record)
        changed["symbols"] = [*record["symbols"], {"id": "GND-01", "type": "ground", "x": 500, "y": 350}]
        status, saved = self.request(
            "POST",
            f"/api/schematics/{created['id']}",
            {
                "name": created["name"],
                "outageId": outage["id"],
                "standardApprovalRef": "UTILITY-CATALOGUE-REV-3",
                "revision": 1,
                "record": changed,
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(saved["revision"], 2)
        self.assertEqual(len(saved["history"]), 2)

        status, conflict = self.request(
            "POST",
            f"/api/schematics/{created['id']}",
            {"name": created["name"], "revision": 1, "record": record},
        )
        self.assertEqual(status, 409)
        self.assertIn("stale schematic revision", conflict["error"])

        status, listed = self.request("GET", f"/api/schematics?outageId={outage['id']}")
        self.assertEqual(status, 200)
        self.assertEqual([item["id"] for item in listed], [created["id"]])

    def test_switching_package_accepts_current_server_schematic_as_diagram_source(self) -> None:
        status, schematic = self.request(
            "POST",
            "/api/schematics",
            {
                "name": "Server one-line",
                "standardApprovalRef": "UTILITY-CATALOGUE-REV-3",
                "record": {
                    "symbols": [{"id": "BUS-01", "type": "bus", "x": 200, "y": 200}],
                    "edges": [],
                },
            },
        )
        self.assertEqual(status, 201)
        payload = self.payload()
        payload["diagrams"] = []
        payload["schematicId"] = schematic["id"]
        payload["schematicRevision"] = schematic["revision"]
        payload["symbolProfileApprovalRef"] = "UTILITY-CATALOGUE-REV-3"
        status, created = self.request("POST", "/api/switching/drafts", payload)
        self.assertEqual(status, 201)
        upload_status, _, _ = self.raw_request(
            "POST",
            f"/api/switching/drafts/{created['id']}/attachments?kind=source",
            b"%PDF-1.7\nprocedure",
            {"Content-Type": "application/pdf", "X-Northstar-Filename": "uwpc-procedure.pdf"},
        )
        self.assertEqual(upload_status, 200)
        status, ready = self.request("POST", f"/api/switching/drafts/{created['id']}/ready", {})
        self.assertEqual(status, 200)
        self.assertEqual(ready["status"], self.store.SWITCHING_READY)

    def test_schematic_records_keep_terminals_drawn_state_and_utility_types(self) -> None:
        status, created = self.request(
            "POST",
            "/api/schematics",
            {
                "name": "Catalogue 2026.4 feeder",
                "standardApprovalRef": "UTILITY-CATALOGUE-REV-3",
                "record": {
                    "symbols": [
                        {"id": "BUS-01", "type": "bus", "x": 200, "y": 200},
                        {"id": "RCL-01", "type": "recloser", "x": 360, "y": 200, "operatingState": "open", "assetTag": "52-A", "siteCode": "TEST", "scada": {"feedCode": "default", "tagName": "RCL.POS"}, "measurements": [{"tagName": "RCL.MW", "feedCode": "default", "label": "Power"}]},
                        {"id": "XF3-01", "type": "transformer-3winding", "x": 520, "y": 200, "windingConfig": "dy"},
                        {"id": "DROP-01", "type": "mystery-device", "x": 10, "y": 10},
                    ],
                    "edges": [
                        {"from": "BUS-01", "to": "RCL-01", "fromTerminal": "span", "toTerminal": "L"},
                        {"from": "RCL-01", "to": "XF3-01", "fromTerminal": "R", "toTerminal": "L"},
                    ],
                },
            },
        )
        self.assertEqual(status, 201)
        record = created["record"]
        types = {item["type"] for item in record["symbols"]}
        by_id = {item["id"]: item for item in record["symbols"]}
        self.assertEqual(record["symbolLibraryProfile"], "northstar-ieee-compat-2026.4")
        self.assertNotIn("mystery-device", types)
        self.assertEqual(by_id["RCL-01"]["operatingState"], "open")
        self.assertEqual(by_id["RCL-01"]["assetTag"], "52-A")
        status, loaded = self.request("GET", f"/api/schematics/{created['id']}")
        self.assertEqual(status, 200)
        loaded_symbol = next(item for item in loaded["record"]["symbols"] if item["id"] == "RCL-01")
        self.assertEqual(loaded_symbol["scada"]["tagName"], "RCL.POS")
        self.assertEqual(loaded_symbol["measurements"][0]["tagName"], "RCL.MW")
        self.assertEqual(by_id["XF3-01"]["windingConfig"], "dy")
        self.assertEqual(record["edges"][0]["fromTerminal"], "span")
        self.assertEqual(record["edges"][0]["toTerminal"], "L")


if __name__ == "__main__":
    unittest.main()
