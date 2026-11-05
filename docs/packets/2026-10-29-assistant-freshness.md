# NorthStar assistant follow-up — 2026-10-29

The approved saved-inflow answer evaluation correctly identified paused collection and validation limits, but exposed incorrect timezone arithmetic in the model's prose. NorthStar now calculates elapsed forecast and refresh ages before inference. Unknown or offsetless timestamps remain unknown; future issuance is flagged. Prompt version northstar-operations/9 directs the assistant to use the calculated ages and distinguish input age at issuance from age at request time.

## Verification

63 isolated assistant/document-control tests pass, including seven new timestamp regression cases. A provider check using entirely synthetic data returned the correct 46.5-hour elapsed age. No second internal-data provider test was run. The earlier full-suite comparison had 546 passes and the same six failures/eight errors as the 523-pass baseline; this small follow-up used targeted regression testing rather than another full-suite run.

The user-authorized UWPC 2024 book and IHSA changes overview were classified REFERENCE_ONLY through audited reviews. Checksums, study retrieval and exclusion from controlled-only retrieval were verified. This is document availability, not a passed UWPC expertise examination or approval as local operating procedures.

## Delivery

This packet contains the complete allowlisted assistant source snapshot and an incremental manifest against packet-20261029-assistant-research. Only manifest entries whose before/after hashes differ need installation. Operational data, licensed originals, credentials and real answer transcripts are excluded. The original packet and tag are retained unchanged.

The existing backend remains healthy, but Windows denied stopping its elevated process. An administrator restart remains necessary to activate installed Python changes. Collection settings remain unchanged. See the local delivery receipt and handoff for installed hashes, archive URLs and activation status.
