"""Voice intake, transcription adapter, and content-triage tests.

The triage rules are the point of most of these: a filter that can hide a
distress call is worse than no filter, so the safety floor gets more coverage
than the happy path.
"""

from __future__ import annotations

import importlib
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


class VoiceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name)
        self.inbox = root / "inbox"
        self.store_dir = root / "store"
        self.inbox.mkdir()
        self.store_dir.mkdir()
        os.environ["NORTHSTAR_DB"] = str(root / "voice.db")
        os.environ["NORTHSTAR_VOICE_INBOX"] = str(self.inbox)
        os.environ["NORTHSTAR_VOICE_STORE"] = str(self.store_dir)
        os.environ.pop("NORTHSTAR_VOICE_ENGINE", None)
        os.environ.pop("NORTHSTAR_VOICE_COMMAND", None)

        import northstar_store

        self.store = importlib.reload(northstar_store)
        import northstar_voice

        self.voice = importlib.reload(northstar_voice)
        self.voice._STABILITY.clear()
        self.store.init_db()

    def tearDown(self) -> None:
        for key in ("NORTHSTAR_DB", "NORTHSTAR_VOICE_INBOX", "NORTHSTAR_VOICE_STORE",
                    "NORTHSTAR_VOICE_ENGINE", "NORTHSTAR_VOICE_COMMAND"):
            os.environ.pop(key, None)
        self.directory.cleanup()

    # -- triage ------------------------------------------------------------- #

    def test_safety_vocabulary_is_never_filtered(self) -> None:
        """The whole feature is unsafe if this can fail."""
        distress = [
            "we have a man down at the spillway",
            "somebody call an ambulance right now",
            "mayday mayday",
            "he is bleeding badly",
            "there is a fire in the switchgear room",
            "I think he is unconscious",
            "worker down, need rescue",
        ]
        for line in distress:
            with self.subTest(line=line):
                verdict = self.voice.classify_segment(line)
                self.assertEqual(verdict["classification"], self.voice.CLASS_OPERATIONAL)
                self.assertTrue(verdict["safety_hold"])

    def test_safety_wins_even_when_wrapped_in_small_talk(self) -> None:
        line = "anyway how was your weekend oh wait somebody is injured over here"
        verdict = self.voice.classify_segment(line)
        self.assertEqual(verdict["classification"], self.voice.CLASS_OPERATIONAL)
        self.assertTrue(verdict["safety_hold"])

    def test_ordinary_chatter_is_demoted_with_a_stated_reason(self) -> None:
        verdict = self.voice.classify_segment("how was your weekend buddy")
        self.assertEqual(verdict["classification"], self.voice.CLASS_NON_OPERATIONAL)
        self.assertFalse(verdict["safety_hold"])
        self.assertIn("weekend", verdict["reason"])

    def test_operations_vocabulary_keeps_a_line_in_the_feed(self) -> None:
        for line in ("Breaker 52 at Kenora is open", "APIROQ unit two back online",
                     "spill gates raised two feet"):
            with self.subTest(line=line):
                self.assertEqual(
                    self.voice.classify_segment(line)["classification"],
                    self.voice.CLASS_OPERATIONAL,
                )

    def test_word_boundaries_prevent_false_safety_hits(self) -> None:
        # 'fall' must not fire inside 'Fort Frances' or 'Iroquois Falls'.
        verdict = self.voice.classify_segment("crew heading to Iroquois Falls station")
        self.assertFalse(verdict["safety_hold"])
        self.assertEqual(verdict["classification"], self.voice.CLASS_OPERATIONAL)

    # -- intake ------------------------------------------------------------- #

    def test_ingest_is_idempotent_on_content_hash(self) -> None:
        first = self.voice.ingest_audio("call.wav", b"RIFFfake-audio-bytes")
        second = self.voice.ingest_audio("call-copy.wav", b"RIFFfake-audio-bytes")
        self.assertFalse(first["duplicate"])
        self.assertTrue(second["duplicate"])
        self.assertEqual(first["recordingId"], second["recordingId"])
        self.assertEqual(len(self.voice.list_recordings()), 1)

    def test_inbox_sweep_waits_for_a_file_to_stop_changing(self) -> None:
        target = self.inbox / "radio-log.wav"
        target.write_bytes(b"partial")
        # First sweep only observes; a half-copied file must not be ingested.
        self.assertEqual(self.voice.scan_inbox_once(), [])
        self.assertEqual(len(self.voice.list_recordings()), 0)
        results = self.voice.scan_inbox_once()
        self.assertEqual([r["action"] for r in results], ["Ingested"])
        self.assertFalse(target.exists(), "ingested audio should leave the inbox")
        self.assertEqual(len(list(self.store_dir.iterdir())), 1)

    def test_non_audio_files_are_ignored(self) -> None:
        (self.inbox / "notes.txt").write_text("not audio")
        self.voice.scan_inbox_once()
        self.assertEqual(self.voice.scan_inbox_once(), [])
        self.assertEqual(len(self.voice.list_recordings()), 0)

    # -- transcription ------------------------------------------------------ #

    def test_without_an_engine_nothing_is_transcribed_or_invented(self) -> None:
        record = self.voice.ingest_audio("call.wav", b"audio")
        self.assertEqual(record["status"], self.voice.STATUS_AWAITING)
        self.assertEqual(self.voice.transcribe_pending(), [])
        detail = self.voice.get_recording(record["recordingId"])
        self.assertEqual(detail["segments"], [])
        snapshot = self.voice.voice_snapshot()
        self.assertFalse(snapshot["engineConfigured"])
        self.assertIn("nothing is transcribed", snapshot["engineNote"])

    def test_command_engine_transcribes_and_triages(self) -> None:
        payload = {
            "text": "Breaker 52 open at Kenora. How was your weekend. Man down at the gate.",
            "segments": [
                {"start": 0.0, "end": 2.5, "text": "Breaker 52 open at Kenora."},
                {"start": 2.5, "end": 4.0, "text": "How was your weekend."},
                {"start": 4.0, "end": 6.0, "text": "Man down at the gate."},
            ],
        }
        script = Path(self.directory.name) / "fake_engine.py"
        script.write_text(f"import json\nprint(json.dumps({payload!r}))\n", encoding="utf-8")
        os.environ["NORTHSTAR_VOICE_ENGINE"] = "command"
        os.environ["NORTHSTAR_VOICE_COMMAND"] = f'"{sys.executable}" "{script}" {{file}}'

        (self.inbox / "shift.wav").write_bytes(b"audio-bytes")
        self.voice.scan_inbox_once()
        self.voice.scan_inbox_once()
        results = self.voice.transcribe_pending()
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["status"], self.voice.STATUS_TRANSCRIBED)
        self.assertEqual(results[0]["operational"], 2)
        self.assertEqual(results[0]["filtered"], 1)
        self.assertEqual(results[0]["safetyHeld"], 1)

        detail = self.voice.get_recording(results[0]["recordingId"])
        self.assertEqual(len(detail["segments"]), 3)
        self.assertEqual(detail["segments"][0]["startedSeconds"], 0.0)

        operational_only = self.voice.get_recording(
            results[0]["recordingId"], include_filtered=False
        )
        self.assertEqual(len(operational_only["segments"]), 2)

    def test_a_failing_engine_records_the_error_and_does_not_fabricate(self) -> None:
        os.environ["NORTHSTAR_VOICE_ENGINE"] = "command"
        os.environ["NORTHSTAR_VOICE_COMMAND"] = f'"{sys.executable}" -c "import sys; sys.exit(3)"'
        (self.inbox / "bad.wav").write_bytes(b"audio")
        self.voice.scan_inbox_once()
        self.voice.scan_inbox_once()
        results = self.voice.transcribe_pending()
        self.assertEqual(results[0]["status"], self.voice.STATUS_FAILED)
        detail = self.voice.get_recording(results[0]["recordingId"])
        self.assertEqual(detail["segments"], [])
        self.assertIsNotNone(detail["error"])

    # -- operator review and retention -------------------------------------- #

    def test_operator_can_restore_a_filtered_segment(self) -> None:
        record = self.voice.ingest_audio("c.wav", b"a")
        self.voice.store_transcript(record["recordingId"], {
            "text": "how was your weekend", "segments": [{"text": "how was your weekend"}],
        })
        detail = self.voice.get_recording(record["recordingId"])
        segment = detail["segments"][0]
        self.assertEqual(segment["classification"], self.voice.CLASS_NON_OPERATIONAL)
        updated = self.voice.review_segment(
            segment["segmentId"], self.voice.CLASS_OPERATIONAL, "operator@example.com", "context for the outage"
        )
        self.assertEqual(updated["classification"], self.voice.CLASS_OPERATIONAL)
        self.assertEqual(updated["reviewedBy"], "operator@example.com")
        events = self.voice.get_recording(record["recordingId"])["events"]
        self.assertTrue(any(e["event"] == "segment reviewed" for e in events))

    def test_operator_cannot_filter_out_a_safety_held_segment(self) -> None:
        record = self.voice.ingest_audio("c.wav", b"a")
        self.voice.store_transcript(record["recordingId"], {
            "text": "man down", "segments": [{"text": "we have a man down at the gate"}],
        })
        segment = self.voice.get_recording(record["recordingId"])["segments"][0]
        self.assertTrue(segment["safetyHold"])
        with self.assertRaises(ValueError):
            self.voice.review_segment(
                segment["segmentId"], self.voice.CLASS_NON_OPERATIONAL, "operator", "noise"
            )

    def test_retention_purges_audio_but_keeps_transcript_and_audit(self) -> None:
        (self.inbox / "old.wav").write_bytes(b"audio")
        self.voice.scan_inbox_once()
        self.voice.scan_inbox_once()
        record = self.voice.list_recordings()[0]
        self.voice.store_transcript(record["recordingId"], {
            "text": "breaker 52 open", "segments": [{"text": "breaker 52 open"}],
        })
        purged = self.voice.purge_expired_audio(
            datetime.fromisoformat(record["retentionExpiresAt"]) + timedelta(seconds=1)
        )
        self.assertEqual(purged, 1)
        detail = self.voice.get_recording(record["recordingId"])
        self.assertFalse(detail["audioRetained"])
        self.assertEqual(len(detail["segments"]), 1, "transcript must survive the audio")
        self.assertTrue(any(e["event"] == "audio purged" for e in detail["events"]))
        self.assertEqual(len(list(self.store_dir.iterdir())), 0)


if __name__ == "__main__":
    unittest.main()
