# Raft Lake daily-data source — 2026-10-23

## Request
Register the operator-provided NOAA DADDS source for Raft Lake daily elevation: address 4815D640, channel 21, group H20POW.

## Implementation
The daily-report D5 source now has station metadata and links for each report date. The NOAA website uses platforms.address, groupCodes.cd and channels.id; its public API uses platforms, groupCodes and channels. Removed the incorrect statement that this source requires authorized feed access. The water-elevation pending entry has the same correction.

## Runtime
Source changes are installed in C:/Users/User/NorthStar/northstar-local. Python source changes require a backend restart. Automatic numerical extraction is deliberately not enabled pending the operator's answer about payload units and observation time. Existing report files remain historical snapshots.

## Verification
Verified the public messages UI and its underlying API without login. Both show address 4815D640, channel 21, group H20POW and matching payloads. API receipt timestamps have an explicit UTC suffix. Transmissions are hourly around :08; no sensor observation timestamp or units were present in the inspected messages. The first payload field is a candidate elevation, not a confirmed decoded observation. Report links follow the report date and retain the UTC date window. All 12 daily-report regression tests pass; an additional direct check confirms source filters, dynamic dates and the null-value guard.

## Limits
Awaiting confirmation that the first comma-separated value is elevation in metres and whether the hourly message represents the start-of-hour observation. No automatic value, timestamp correction, datum conversion, workbook writeback or authentication change was introduced. Full suite: 511 passed, 21 skipped, 3 failed, 8 errors, 556 subtests passed. Missing database-foundation/schema.sql and server/index.js account for two failures and eight errors. The additional Research catalog JSON parsing failure passes in isolation with both pre-change and updated source (4 tests and 30 subtests each); the full-suite ordering issue remains unresolved. The installed checkout has no Git repository; the task repository is the source record. No configured github remote or verified Drive delivery destination is available.

## Recovery
Private preimages are saved before integration under private-preimages/20261023-raft-lake-source. Compare current hashes before restoring to preserve later work.

## Handoff
The source is public; the remaining dependency is message interpretation. Once the operator confirms units and measurement timing, implement bounded retrieval with address/channel/group checks, GOOD quality checks, explicit UTC receipt timestamps, and the report's selected Eastern/Central 07:00 target. Do not silently treat message receipt as observation time or use the latest reading as a 07:00 reading.
