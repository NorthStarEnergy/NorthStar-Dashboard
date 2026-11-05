# Field tracker demo-data repair — 2026-09-11

- Expanded the existing demo-data seeder to maintain six clearly fictional field-worker profiles across six stations.
- Added site-based mock GPS coordinates and fresh heartbeats so Field Tracker and Mobile display useful demonstration state.
- Made refresh idempotent by matching each demo worker by name and station before creating a record.
- Existing operational records are preserved; the seeder only creates or refreshes its named demo profiles.
- Refreshed the local demonstration database: six exact profiles, six GPS positions, six current heartbeats.
- Verification: repeated seed retained the same active-record count; 209 tests passed.
