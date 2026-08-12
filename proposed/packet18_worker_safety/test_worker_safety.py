"""Unit tests for worker_safety.py — Packet 18 §18.1.

STATUS AS OF 2026-08-12: written and hand-traced, NOT executed. Nobody has
run `python -m pytest proposed/packet18_worker_safety -q` yet. Do that before
trusting this file, and before wiring worker_safety.py into anything live.

Deliberately outside tests/, so it is not picked up by the existing
`python -m pytest tests -q` baseline command and cannot change that count
just by existing.
"""

from __future__ import annotations

import unittest

from worker_safety import (
    PhoneVerificationThrottle,
    SlidingWindowThrottle,
    TokenError,
    issue_worker_capability_token,
    normalize_phone,
    verify_worker_capability_token,
)


class WorkerCapabilityTokenTests(unittest.TestCase):
    def test_round_trip_verifies_for_the_bound_checkin(self) -> None:
        token = issue_worker_capability_token("checkin-123", now=1_000.0)
        verified = verify_worker_capability_token(token, "checkin-123", now=1_000.0)
        self.assertIsNotNone(verified)
        self.assertEqual(verified.checkin_id, "checkin-123")
        self.assertEqual(verified.issued_at, 1_000)
        self.assertEqual(verified.expires_at, 1_000 + 12 * 60 * 60)

    def test_rejects_a_different_checkin_id(self) -> None:
        token = issue_worker_capability_token("checkin-123", now=1_000.0)
        verified = verify_worker_capability_token(token, "checkin-456", now=1_000.0)
        self.assertIsNone(verified)

    def test_rejects_after_expiry(self) -> None:
        token = issue_worker_capability_token("checkin-123", ttl_seconds=60, now=1_000.0)
        # Still valid one second before expiry.
        self.assertIsNotNone(
            verify_worker_capability_token(token, "checkin-123", now=1_059.0)
        )
        # Expired exactly at and after the boundary.
        self.assertIsNone(
            verify_worker_capability_token(token, "checkin-123", now=1_060.0)
        )
        self.assertIsNone(
            verify_worker_capability_token(token, "checkin-123", now=2_000.0)
        )

    def test_rejects_a_tampered_signature(self) -> None:
        token = issue_worker_capability_token("checkin-123", now=1_000.0)
        prefix, encoded, signature = token.split(".", 2)
        tampered = f"{prefix}.{encoded}.{signature[:-1]}{'a' if signature[-1] != 'a' else 'b'}"
        self.assertIsNone(
            verify_worker_capability_token(tampered, "checkin-123", now=1_000.0)
        )

    def test_rejects_a_tampered_payload(self) -> None:
        token_for_other = issue_worker_capability_token("checkin-999", now=1_000.0)
        _, other_encoded, _ = token_for_other.split(".", 2)
        token = issue_worker_capability_token("checkin-123", now=1_000.0)
        prefix, _, signature = token.split(".", 2)
        # Splice a different, validly-encoded payload behind this token's
        # signature. The signature won't match the swapped payload, so this
        # must fail even though both halves are individually well-formed.
        forged = f"{prefix}.{other_encoded}.{signature}"
        self.assertIsNone(
            verify_worker_capability_token(forged, "checkin-999", now=1_000.0)
        )

    def test_rejects_garbage_and_empty_input(self) -> None:
        self.assertIsNone(verify_worker_capability_token("", "checkin-123"))
        self.assertIsNone(verify_worker_capability_token("not-a-token", "checkin-123"))
        self.assertIsNone(verify_worker_capability_token("wct1.onlytwoparts", "checkin-123"))
        self.assertIsNone(
            verify_worker_capability_token("wrongprefix.aaaa.bbbb", "checkin-123")
        )

    def test_rejects_empty_expected_checkin_id(self) -> None:
        token = issue_worker_capability_token("checkin-123", now=1_000.0)
        self.assertIsNone(verify_worker_capability_token(token, "", now=1_000.0))

    def test_issue_rejects_empty_checkin_id(self) -> None:
        with self.assertRaises(TokenError):
            issue_worker_capability_token("")
        with self.assertRaises(TokenError):
            issue_worker_capability_token("   ")

    def test_issue_rejects_non_positive_ttl(self) -> None:
        with self.assertRaises(TokenError):
            issue_worker_capability_token("checkin-123", ttl_seconds=0)
        with self.assertRaises(TokenError):
            issue_worker_capability_token("checkin-123", ttl_seconds=-5)

    def test_two_tokens_for_the_same_checkin_are_not_identical(self) -> None:
        # jti (token id) must differ even for the same checkin_id/timestamp,
        # otherwise two devices sharing a clock could mint colliding tokens.
        first = issue_worker_capability_token("checkin-123", now=1_000.0)
        second = issue_worker_capability_token("checkin-123", now=1_000.0)
        self.assertNotEqual(first, second)


class NormalizePhoneTests(unittest.TestCase):
    def test_strips_formatting(self) -> None:
        self.assertEqual(normalize_phone("+1 (705) 555-0100"), "17055550100")
        self.assertEqual(normalize_phone("705.555.0100"), "7055550100")

    def test_empty_and_none_are_empty_string(self) -> None:
        self.assertEqual(normalize_phone(""), "")
        self.assertEqual(normalize_phone(None), "")

    def test_two_spellings_of_the_same_number_match(self) -> None:
        self.assertEqual(normalize_phone("(705) 555-0100"), normalize_phone("7055550100"))


class SlidingWindowThrottleTests(unittest.TestCase):
    def test_allows_up_to_the_limit_then_blocks(self) -> None:
        throttle = SlidingWindowThrottle(limit=3, window_seconds=60)
        for _ in range(3):
            decision = throttle.check("key-a", now=1_000.0)
            self.assertTrue(decision.allowed)
        blocked = throttle.check("key-a", now=1_000.0)
        self.assertFalse(blocked.allowed)
        self.assertGreater(blocked.retry_after_seconds, 0)

    def test_different_keys_are_independent(self) -> None:
        throttle = SlidingWindowThrottle(limit=1, window_seconds=60)
        self.assertTrue(throttle.check("key-a", now=1_000.0).allowed)
        self.assertTrue(throttle.check("key-b", now=1_000.0).allowed)
        self.assertFalse(throttle.check("key-a", now=1_000.0).allowed)

    def test_old_hits_fall_out_of_the_window(self) -> None:
        throttle = SlidingWindowThrottle(limit=1, window_seconds=60)
        self.assertTrue(throttle.check("key-a", now=1_000.0).allowed)
        self.assertFalse(throttle.check("key-a", now=1_030.0).allowed)
        # 61 seconds after the first hit, the window has fully passed.
        self.assertTrue(throttle.check("key-a", now=1_061.0).allowed)

    def test_reset_clears_a_single_key_without_touching_others(self) -> None:
        throttle = SlidingWindowThrottle(limit=1, window_seconds=60)
        throttle.check("key-a", now=1_000.0)
        throttle.check("key-b", now=1_000.0)
        throttle.reset("key-a")
        self.assertTrue(throttle.check("key-a", now=1_000.0).allowed)
        self.assertFalse(throttle.check("key-b", now=1_000.0).allowed)

    def test_constructor_rejects_non_positive_settings(self) -> None:
        with self.assertRaises(ValueError):
            SlidingWindowThrottle(limit=0, window_seconds=60)
        with self.assertRaises(ValueError):
            SlidingWindowThrottle(limit=5, window_seconds=0)


class PhoneVerificationThrottleTests(unittest.TestCase):
    def test_allows_requests_under_every_limit(self) -> None:
        throttle = PhoneVerificationThrottle(
            per_token=SlidingWindowThrottle(limit=5, window_seconds=60),
            per_phone=SlidingWindowThrottle(limit=5, window_seconds=60),
            per_source=SlidingWindowThrottle(limit=5, window_seconds=60),
        )
        decision = throttle.check(
            token="tok-1", phone="705-555-0100", source_address="203.0.113.5", now=1_000.0
        )
        self.assertTrue(decision.allowed)

    def test_blocks_when_the_phone_dimension_is_exceeded_even_if_others_are_fine(self) -> None:
        throttle = PhoneVerificationThrottle(
            per_token=SlidingWindowThrottle(limit=100, window_seconds=60),
            per_phone=SlidingWindowThrottle(limit=1, window_seconds=60),
            per_source=SlidingWindowThrottle(limit=100, window_seconds=60),
        )
        first = throttle.check(
            token="tok-1", phone="705-555-0100", source_address="203.0.113.5", now=1_000.0
        )
        self.assertTrue(first.allowed)
        # Different token and source, same phone number (differently
        # formatted) — must still be blocked on the phone dimension.
        second = throttle.check(
            token="tok-2", phone="7055550100", source_address="203.0.113.9", now=1_000.0
        )
        self.assertFalse(second.allowed)
        self.assertIn("phone", second.reason)

    def test_blocks_when_the_source_dimension_is_exceeded(self) -> None:
        throttle = PhoneVerificationThrottle(
            per_token=SlidingWindowThrottle(limit=100, window_seconds=60),
            per_phone=SlidingWindowThrottle(limit=100, window_seconds=60),
            per_source=SlidingWindowThrottle(limit=1, window_seconds=60),
        )
        self.assertTrue(
            throttle.check(
                token="tok-1", phone="705-555-0100", source_address="203.0.113.5", now=1_000.0
            ).allowed
        )
        second = throttle.check(
            token="tok-2", phone="705-555-0199", source_address="203.0.113.5", now=1_000.0
        )
        self.assertFalse(second.allowed)
        self.assertIn("source", second.reason)

    def test_missing_dimension_values_are_skipped_not_treated_as_a_shared_key(self) -> None:
        # Two requests that both omit source_address must not throttle each
        # other on an empty-string "source" key.
        throttle = PhoneVerificationThrottle(
            per_token=SlidingWindowThrottle(limit=100, window_seconds=60),
            per_phone=SlidingWindowThrottle(limit=100, window_seconds=60),
            per_source=SlidingWindowThrottle(limit=1, window_seconds=60),
        )
        first = throttle.check(token="tok-1", phone="705-555-0100", source_address="", now=1_000.0)
        second = throttle.check(token="tok-2", phone="705-555-0199", source_address="", now=1_000.0)
        self.assertTrue(first.allowed)
        self.assertTrue(second.allowed)


if __name__ == "__main__":
    unittest.main()
