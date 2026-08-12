# Switching / Engineering / UWPC Remaining Work

## Completed in this increment

- Added a SHA-256 source manifest digest for selected circuit diagrams and governing procedure files.
- Persisted the digest with switching draft metadata without uploading source-file bytes.
- Added server validation for malformed digests.
- Added a read-only `/api/switching/drafts/{id}/review-evidence` projection with Packet 13 evidence fields and terminal non-release semantics.
- Added explicit canonical asset ID, topology snapshot/revision, authority procedure ID/revision, and qualification-evidence reference fields.
- Made those identity/evidence fields mandatory before `READY FOR QUALIFIED REVIEW`.
- Preserved the existing drafting-only and `REVIEW RECORDED - NOT RELEASE` boundary.

## Remaining work, prioritized

1. **Contain the public perimeter:** force the operator gate on in hosted configuration, verify JWTs rather than trusting a forwarded header, protect worker record capabilities, minimize public health output, and pin CORS.
2. **Complete controlled review evidence:** the dashboard now exposes a Packet 13-compatible read-only evidence projection backed by its append-only switching event store. Remaining work is repository retention policy and, if required, replacement with the shared Packet 13 service/store.
3. **Bind engineering identity:** validate the recorded Packet 12 asset ID and canonical topology revision against a live registry; reject stale or mismatched bindings. The dashboard fields are now present, but the registry adapter is still open.
4. **Integrate training:** replace the dashboard Training placeholder with Packet 14 session creation, scenario isolation, learner outcome evidence, and explicit training-only labeling.
5. **Operational resilience:** configure encrypted off-host backups, complete a restore drill, and replace shadow notifications with a delivery/acknowledgement connector.
6. **Authority decisions:** obtain the authoritative UWPC/EUSR procedure revision, qualified-person role/credential policy, source retention requirements, and competency acceptance criteria.

## Current gate

The dashboard remains a controlled pilot. Local regression is green, but public perimeter, durable controlled source evidence, restore testing, notification delivery, and external procedural approval remain open.
