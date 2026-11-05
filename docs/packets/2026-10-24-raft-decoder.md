# Raft Lake elevation decoder — 2026-10-24

## Request
Enable daily-report Raft Lake elevation after operator confirmation of metre values and the preceding timing question.

## Changes
Decode the first comma-separated field for NOAA 4815D640/channel 21/H20POW. Preserve source precision, filter GOOD messages to the requested 07:00 hour in the chosen reporting timezone, and retain receipt time separately from the start-of-hour observation. Missing, conflicting, malformed and implausible values fail closed. The broad 400–500 m guard is a data sanity check, not an operating limit.

## Verification
Seven targeted tests pass, including a live NOAA retrieval for October 23: 415.190 m, received 11:08:06 UTC for 07:00 Eastern. Full pytest suite cannot start because pytest is unavailable in both installed Python runtimes. Existing pre-07:00 regression updated to expect two blocked sources, with Raft now pending.

## Runtime
Installed source requires backend restart. Live decoder retrieval verified separately; existing report snapshots are unchanged. Historical workbook values are not rewritten.

## Recovery
Private preimages saved under private-preimages/20261024-raft-decoder. Compare source hashes before restoration.

## Delivery
Source and tests recorded in the task repository. No configured GitHub remote or verified Drive destination.

## Remaining work
Reload backend and collect a fresh daily report. Broader water-elevation registry remains separate from this daily-report source.
