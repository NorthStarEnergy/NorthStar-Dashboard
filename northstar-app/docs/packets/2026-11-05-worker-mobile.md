# Compact worker check-in

Removed decorative graphic and unconfigured-calling pilot paragraph. Enlarged SITE CHECK-IN, added a prominent native site dropdown using the canonical 20 station names, and compacted fields for phone browsers with 16px inputs and 44px touch targets. Phone and expected duration share a row. Live 390x844 browser rendering verified the complete arrival form fits.

Signed QR tokens resolve and lock the site. Legacy site links prefill it. Direct visits choose manually; a saved QR is reused only when it has an existing visit to restore. Manual arrivals retain provisional operator confirmation. Invalid signed tokens remain rejected. Existing help, checkout and solo safety code is retained. Offline shell cache version bumped.

Focused JavaScript checks pass for manual selection, signed token resolution and legacy QR prefill. Full Python results are recorded in the commit message. No production check-ins were submitted during testing.

Static HTML and service worker installed under runtime integration lock with preimage hashes checked and private rollback copies retained in outputs/private-preimages/20261105-worker-mobile. No backend restart or public route expansion required.
