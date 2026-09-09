# Private durable attachments

`Artifacts` stores bounded attachment bytes in PostgreSQL `private_artifact`.
The application migration is owned by root (`0024_light_magma.sql`). There is no
Blob fallback or provider URL used as storage. Files have an immutable UUID and
SHA-256 content revision; repeated names or equal contents in different source
events do not merge files.

`put` accepts a trusted identity/inbox/media binding and bytes. It derives the
filename, declared MIME, original event and message IDs from the persisted inbox,
requiring exactly one matching attachment. Callers cannot override those fields.
Exact replay returns the same artifact; changed content or source metadata fails.
Reads recompute the digest and length. A deleted source never becomes a cache miss
and cannot be restored by delivery retry.

The byte limit is 1–10 MiB inclusive. Stored derived text/transcripts are limited
to 64 KiB of UTF-8 and bound to the expected content digest. `mediaType` in metadata
is the source-declared MIME, not a claim of successful parsing. The existing media
policy independently validates signatures and supported content before extraction.

## Authority and deletion

Every operation resolves the current channel identity and canonical personal
workspace on the server. The current identity and workspace membership are checked
inside the database transaction. Reads and processing also require the original
source identity to remain active and owned by that same account/workspace. Another
linked channel does not bypass revocation of the source. Listing omits revoked
sources. Database row locks serialize those checks with revocation and deletion.

An active owner can erase an artifact after disconnecting its source channel.
`delete` removes bytes and stored derived text, retaining the source/metadata
record as a tombstone. Repeated deletion is idempotent. Workspace, source identity
and source inbox foreign keys cascade when their owning records are deleted.
This operation does not erase text already delivered into Eve history, external
provider copies or backups; it does not claim complete account erasure.

## Consumers

`loadChannelContent(identity, payload, sourceInboxId)` loads persisted bytes first,
or downloads and stores them before extraction/model capability checks. It stores
the batch before transformation, so rejecting image/PDF input does not remove the
saved files. Its return preserves `content` and `transcripts` and adds
`artifacts: ArtifactReference[]`; supported text handed to Eve includes the stable ID.
The caller passes the authoritative inbox receipt ID. No provider request is needed
for a cache hit. A failure during the batch can leave already-saved artifacts,
which exact retries reuse rather than overwrite.

Private interactive tools list recent metadata, read bounded text or an existing
transcript, and delete an exact attachment through the existing approval gate.
Their arguments contain no actor, workspace or destination. Binary content without
a qualified reader is returned as metadata with `content: null`, never fabricated
image/document understanding. No upload or download URL is exposed.

## Evidence

The focused PostgreSQL tests cover exact/concurrent replay, changed sources,
same-name separation, ownership, source/current identity revocation, revoked
membership, byte corruption, UTF-8 limits, SQL constraints, tombstones and cascades.
One process writes an artifact and exits; a new process reads its exact bytes.
Intake tests use the real storage and channel services with cached bytes and no
provider configuration. These are not fresh provider download or delivery proofs.
The tool tests exercise actual public input validators and approval configuration.

```sh
node --env-file=.env.runtime.local node_modules/vitest/vitest.mjs run \
  --config vitest.runtime.config.ts \
  tests/runtime/artifacts.integration.ts tests/runtime/artifacts-intake.integration.ts
pnpm exec vitest run server/artifacts/tools.test.ts server/channels/media
```
