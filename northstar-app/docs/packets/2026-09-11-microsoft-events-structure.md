# Outlook and Teams → Events integration structure

## Delivered

This is a permission-independent scaffold, not an active Microsoft connection. No Graph request, login, subscription, external import, or outbound message is performed.

- `northstar_microsoft.py` maps Outlook Graph message and Teams chatMessage records to the existing append-only event envelope.
- `MicrosoftSource` identifies an exact approved source and defaults to disabled. Configuration does not report a successful connection.
- `ingest_message` refuses disabled sources and resource mismatches, and writes through the existing audit-event writer in the caller's database transaction. An external source/revision identity prevents duplicate retries. Edits and deletions append new events under the same message identity. Thread correlation connects replies.
- Message previews are bounded to 500 characters. Teams HTML is converted to text with script/style content excluded. Full email bodies and attachment bytes are not copied. Original links are retained only for recognized HTTPS Microsoft hosts.
- `microsoft-sources.example.json` documents the disabled configuration contract. It has no sources or credentials and is not a live configuration loader.
- The Events panel has a Communications category and an explicit setup-pending notice. ALL now includes system events. The notice remains static until a future collector/status endpoint is implemented.

No database migration is required: the scaffold writes to audit_events, already used by `/api/events`. No new public HTTP endpoint was added. Existing operator-host authorization is unchanged.

## Collector contract for later implementation

1. Load approved source records from protected configuration. Verify the tenant and granted source access. Resolve exact mailbox/folder, team/channel or chat IDs. The source label is for display; the resource is the exact allowlist identity.
2. Authenticate Microsoft Graph on the server through approved Microsoft app registration and token storage. Never put tokens or secrets in the browser, the example JSON, the source ZIP, or Drive.
3. For Outlook, use per-folder incremental synchronization. Request stable message IDs. Complete all nextLink pages, then save deltaLink. Inbox and Sent Items are separate sources; record direction explicitly when the collector is implemented. The existing mapper labels source message changes without claiming sent/delivered status.
4. For Teams, collect the approved channel/chat messages and replies with their original IDs and timestamps. Microsoft change notifications can cover channel messages and replies. Build authenticated notification validation, lifecycle renewal, reconciliation and throttling before enabling live ingestion. The scaffold contains none of that network code.
5. Supply the source occurrence timestamp for deletions. Do not substitute a retry's current clock time. Preserve timestamps and provider IDs consistently so retries deduplicate correctly.
6. Run ingest_message inside the existing serialized database transaction. Commit ingested events and the collector checkpoint together. Unique event IDs defend against duplicates; a concurrent unique-key conflict should be retried/reconciled by the collector, not treated as successful ingestion blindly.
7. Expose operator-only connection state: not configured, awaiting connection, connected, stale or failed, plus last successful synchronization. Replace the static UI setup notice only after this exists.

The internal ingestion function trusts its future authenticated collector; it is not a public webhook authentication mechanism. A source marked enabled permits internal ingestion but still reports awaiting_connection, never connected.

## Tests and limits

Six new tests cover disabled/mismatched sources, retry deduplication, separate edits/deletions, transaction rollback, Teams reply correlation, HTML stripping, unsafe URLs, timestamp validation and bounded previews. Existing dashboard script compilation and layout migration checks also pass. The release commit records the full regression count.

No real Microsoft account or source has been tested. Microsoft permissions, live collectors, checkpoint storage, retry scheduling, notification endpoints, attachment retrieval and historical backfill remain future work. No sending capability is included. This matches the owner's request to build the structure before permissions are available.

## Microsoft references

- [Outlook incremental message synchronization](https://learn.microsoft.com/en-us/graph/delta-query-messages): changes are tracked per mail folder using returned continuation/delta links.
- [Teams message change notifications](https://learn.microsoft.com/en-us/graph/teams-changenotifications-chatmessage): subscriptions can track messages and replies in selected channels and messages in chats. Select the permission model after approved source scope is known.

## Delivery

The ZIP contains the scaffold, disabled configuration example, UI changes, tests and this handoff. It applies to the canonical NorthStar runtime; it is not a standalone deployed service. Pre-existing unrelated working-tree changes are preserved and credentials are excluded.
