# Switching / Engineering / UWPC Remaining Work

## Completed through Packet 27

- Diagram and governing-procedure bytes are stored with the operator-gated SQLite draft and covered by SHA-256 metadata and the source-manifest digest.
- One-line schematics are append-only server revisions that can link to outages and switching packages.
- `/api/switching/drafts/{id}/review-evidence` exposes Packet 13 evidence with terminal non-release semantics.
- A controlled ZIP export contains the exact stored sources, package, audit, evidence, and hash manifest; export itself is audited.
- Reviewed records remain immutable. Starting a server revision copies sources under new IDs and clears revision, qualification, reviewer, and checklist evidence.
- The workflow remains `DRAFT` → `READY FOR QUALIFIED REVIEW` → `REVIEW RECORDED - NOT RELEASE`.
- One-line symbols use catalogue `northstar-ieee-compat-2026.3`: client and server share the same profile id, conductors snap to terminals, switching devices record a drafting OPEN/CLOSED position, workplace line switches/breakers/circuit switchers/fuses use the shop glyph set, Figure A-1 circuit notation is in the palette, and the utility-critical set includes recloser, sectionalizer, load-break, grounding switch, ATS, three-winding transformer, autotransformer, and PT. This remains a compatibility profile, not a certified utility legend.

## Remaining work, prioritized

1. **Complete individual identity and permissions:** verify Access JWTs, adopt per-person identities and roles, and require the approved qualified-person grant before review recording.
2. **Bind engineering identity:** validate the recorded Packet 12 asset ID and topology revision against a live registry; reject stale or mismatched bindings.
3. **Set controlled retention:** approve source/review retention and legal-hold policy, then bind bundle records to the controlled repository or shared Packet 13 service if required.
4. **Integrate training:** replace the Training placeholder with isolated sessions, learner outcome evidence, and explicit training-only labeling.
5. **Operational resilience:** configure encrypted off-host backups, complete a restore drill, and replace shadow notifications with a delivery/acknowledgement connector.
6. **Authority decisions:** obtain the authoritative UWPC/EUSR procedure revision, qualified-person credential policy, source retention requirements, and competency acceptance criteria.

## Current gate

The dashboard remains a controlled pilot. Durable source evidence and safe revisioning are present, but verified individual roles, registry binding, approved retention, restore testing, notification delivery, and external procedural approval remain open.
