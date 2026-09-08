# Durable messaging store

`Messaging.layer` requires `PgClient.PgClient`. Provide one application SQL layer
at the framework boundary; every method returns an Effect. This service does not
start a dispatcher, call Eve, send provider requests, or create another runtime.

The caller must resolve and authorize `identityId` before invoking the service.
It is not an identity supplied directly by an untrusted HTTP body. Acceptance,
enqueueing, claims and fenced mutations lock `channel_identity` and check its
revocation state. Inspection also works for revoked identities, so their owner
can still see unresolved work; the caller remains responsible for read access.

## API

- `accept({ identityId, eventId, payload })` and
  `enqueue({ identityId, deliveryKey, payload })` return a `MessageReceipt` after
  their SQL transaction completes. Send the provider ACK only after this effect
  succeeds. Do not wrap acceptance in a still-uncommitted outer transaction.
- `claimInbox({ identityId, leaseSeconds })` and `claimOutbox(...)` return
  `MessageClaim | null`. Lease duration is 1–300 seconds. Inbox order is its
  database sequence; outbox order is creation time with ID as a tie-breaker.
- `checkInboxLease(lease)` / `checkOutboxLease(lease)` revalidate immediately
  before adapter I/O. `lease` is `{ identityId, id, leaseToken }`.
- `markAccepted({ lease, receipt: { status: "accepted", sessionId } })` and
  `markSent({ lease, receipt: { status: "sent", providerMessageId } })` record
  confirmed adapter responses. These checks cannot establish that a caller
  actually contacted a provider; only the adapter can supply that evidence.
- `markInboxUncertain({ lease, reason })` / `markOutboxUncertain(...)` record
  ambiguous handoffs. Reasons are categorical and never contain raw errors.
- `markInboxFailed({ lease, reason: "adapter_rejected" })` and its outbox
  counterpart are for confirmed terminal rejection with no external effect.
- `inspectInbox(identityId)` / `inspectOutbox(identityId)` return all status
  counts and up to 100 oldest uncertain receipts for account/operator views.

Payload is `{ text?, attachments?: [{ id, mediaType, name? }], replyToMessageId? }`.
It requires nonblank text or at least one attachment. Attachment IDs are stored
references, not fetched URLs. The adapter must enforce attachment ownership.
Limits are 16,384 text characters, ten attachments and bounded reference strings.
Unknown fields are rejected, including caller-supplied hashes. Canonicalization
fixes object key order and normalizes absent attachments to an empty array while
preserving attachment order. Replay with a changed digest raises `PayloadConflict`.

## Uncertainty and revocation

Each lane permits one dispatching item per identity. Claims turn expired leases
into `uncertain`; both dispatching and uncertain items block subsequent claims.
Nothing automatically resets an uncertain item to queued. Reconciliation and
explicit resolution are intentionally outside this increment.

For a revoked identity, an outbox claim cancels queued output and returns null.
Completion and preflight checks reject revoked identities. Revocation after the
last check can race an external operation: the service never holds a database
transaction open across provider I/O. An adapter timeout, crash or expired lease
does not prove failure and does not authorize a resend.

Eve continuation does not expose message idempotency. An inbox ID may be used as
`operationId` for its separate create-once API, but this store never creates Eve
sessions or treats an accepted candidate ID as proof of canonical ownership.

`messaging.integration.ts` uses real PostgreSQL in `companion_messaging_test`.
Its synthetic receipt IDs exercise storage transitions, not provider delivery.
