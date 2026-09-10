# Stored personal-memory inspection and export

This slice exposes the current account's stored structured profile and bound Eve
profile documents. It does not export the whole account. Conversation history,
artifacts, connections, schedules and unbound memory documents are explicitly
excluded in every snapshot. `notes.status = "unresolved"` means no trusted binding
has yet been observed; it does not mean the account has no saved notes.

## Composition

The application registers `PersonalMemory.layer` in `server/runtime.ts`, renders
`PersonalMemorySection` in `/account`, and includes the inspection tool in the
root tool inventory. `db/schema/memory.ts` defines the binding table; migration
`0026_cooing_thunderbolt.sql` registers it in the normal application chain.

`PersonalMemory.layer` requires `PgClient.PgClient`. Its methods are internal
application operations; routes and tools must resolve authority first:

- `bind(scope, memory)` records the trusted public Eve callback's binding.
- `inspect(scope)` checks canonical membership before and after reading the
  existing profile service and bound note documents.
- `inspectPersonalMemory(headers)` validates Better Auth plus the live session
  row and membership before and after reading.
- `exportPersonalMemory(headers)` serializes that same result with an attachment
  disposition, JSON content type, `nosniff` and `private, no-store`.
- `wipe(scope)` deletes the structured profile row and bound profile notes for
  the canonical workspace inside the same membership-locked transaction. Account
  delete (`server/accounts/privacy.ts`) hooks this wipe; it is not full-account
  erase.

`GET /api/account/personal-memory/export` has no owner, workspace or memory-key
input. URL parameters cannot select another account. The native
`personal-memory-inspect` tool has a strict empty schema, requires the original
private interactive channel context, and revalidates the verified channel identity
before returning the result. Its download link requires browser authentication;
it is not a bearer link.

## Key ownership and existing storage

The installed public `eve/memory` contract supplies
`memory.scope.{key,namespace,value}` and `memory.slot` to provider callbacks.
Eve documents the key as an opaque digest; this implementation never reproduces
its hashing algorithm or accepts it from a client.

`agent/lib/personal-memory-provider.ts` keeps the existing `fileMemory` provider,
PostgreSQL backend, native save/remove tools and cancellation wrapper. Before
recall/tool resolution it derives the canonical owner from `session.auth.current`,
requires current authority, and checks the resolved value equals that workspace
and the slot equals `profile`. Only then does it register the key. Each native
save/remove invocation resolves authority again from its actual execution context.
Every document read or write holds the relevant channel identity, exact Better
Auth session and membership locks in the same PostgreSQL transaction as storage
access. Signing out the captured web session invalidates its tools even if another
session for the same account remains active. A primary-key plus
workspace/namespace/slot uniqueness constraint prevents reassigning an existing
binding. Registration works before the first document is written, so there is no
foreign key from the binding to `memory_document`.

Existing opaque documents become inspectable when their actual Eve profile
callback is next observed. No speculative backfill, fallback key, new namespace,
duplicate note backend or memory-policy engine was introduced. Exports include all
profile documents already bound to this canonical workspace. They preserve raw
stored contents and versions; the UI omits a leading Markdown metadata comment
for readability. Notes remain untrusted text and cannot inject HTML into the page.

The profile and document reads are individually current observations, followed by
fresh authorization checks. This is not a transactionally atomic full-account
backup, restore contract, or deletion implementation.

## Evidence (2026-09-09)

The focused test is `tests/runtime/personal-memory.integration.ts`:

```sh
node --env-file=.env.local --env-file=.env.runtime.local \
  node_modules/vitest/vitest.mjs run --config vitest.runtime.config.ts \
  tests/runtime/personal-memory.integration.ts
```

It uses the actual Better Auth channel-auth plugin, actual account provisioning,
existing profile service, actual PostgreSQL memory backend, public Eve provider
callbacks, native private tool and export route. Two synthetic accounts receive
distinct profiles/documents. The test verifies own-only output, conflicting key
binding rejection, URL owner/key injection resistance, anonymous rejection,
revoked membership rejection and real Better Auth sign-out. A new OS process
reads identical stored profile/documents, then independently rejects each revoked
credential with `unauthenticated`. No service or provider mocks are used.

The test's Eve callback contexts and stored notes are synthetic input to the real
provider; this establishes callback/storage integration, **not** an actual model
turn or a messenger-provider delivery. The scope-to-key derivation is Eve's
responsibility and must also be exercised in the coordinator's native application
acceptance after composition and migration integration.

A local production Next server on port 3085 was exercised through the browser:
channel sign-in was confirmed using synthetic input through the actual account
service, the browser completed its real Better Auth session, `/account` showed
the unresolved state and then a stored profile/note, and the JSON link triggered
a download. No Telegram or WhatsApp message was sent.

`pnpm check` passed lint, TS7, formatting, Knip and 1,038 inherited regression
tests (110 files); inherited mock tests are regression evidence only. `pnpm build`
passed Eve and Next production compilation and registered `/account` plus the
export route. The browser presentation adjustment was rebuilt separately.

Failures found and retained in the work record: the first PG test failed because
the binding table was absent; a fresh-process test then exposed a construction
cycle through the auth module. Keeping web-session validation at the export
boundary removed that cycle. The corrected fresh-process proof passes.

Independent review identified a write/revocation race in an earlier guard that
checked authority outside the storage transaction. The retained baseline fails
both channel revocation and exact web-session sign-out cases. The corrected
implementation passes `personal-memory-revocation-race.integration.ts`: actual
PostgreSQL locks force revocation to commit before a captured native tool attempts
its write, which is rejected without modifying the document. Review of the
transactional guard and shared principal helpers passed. Full checks and browser
proof must be repeated after the pending native runtime package correction.

An actual private-channel application input also observed and bound Eve's opaque
profile key. That run then failed before the model call because of a schema
compatibility error in the native package; it does not establish a successful
model turn, recovery, or messenger delivery for the current package cohort.

## Native unstructured forget + recall-refresh (P06)

After Eve `fileMemory` `save_memory` / `remove_memory` persists a profile document,
the recalled projection is refreshed **before** the next model step so forgetting
an unstructured note cannot leave stale projected content. There is no second
memory engine: storage and recall stay on Eve `fileMemory` plus the existing
PostgreSQL document backend.

### Order

1. **Storage** — Eve `fileMemory` mutates the scoped document (CAS write).
2. **Refresh** — the same provider `recall["turn.started"]` reads the document and
   builds the keyed `file-memory-document` projection.
3. **Next model step** — the Eve harness applies that refresh (stable id
   supersession / drop-if-absent) before the following model call. A dirty fence
   refuses to treat the pre-mutation projection as authoritative.

### Fail closed

If the process crashes or errors after storage and before refresh is applied to the
session projection, the mutation is not treated as model-visible success for the
next step: either the tool fails (refresh error) or the step fails closed when a
mutating memory tool result is present without a pending refresh. A later
`turn.started` recall still reads storage truth.

### Limits (documented, not claimed complete)

- **Model-history / summaries:** ordinary conversation messages and prior summaries
  may still mention a forgotten fact. This slice prevents stale **recalled note
  projection** after `remove_memory`; it does not rewrite chat history.
- **PG races:** native save/remove linearization and revocation races are covered
  by the existing personal-memory PostgreSQL suites; this Effect path fail-closes
  when refresh cannot apply rather than serving a dirty projection.
- **Full account erase/restore:** export today is not full-account backup. Account
  delete online wipe covers personal memory + browser sessions only; channel
  identities, schedules, artifacts, history, user/workspace rows and backups are
  not erased. Restore reconciliation remains a separate P06 gate.

### Code

- `agent/lib/personal-memory-recall-refresh.ts` — Effect-native order helpers.
- `agent/lib/personal-memory-provider.ts` — wraps mutating tools with refresh.
- Companion Eve `0.52` patch — enqueues/applies mid-turn recall refresh in the
  memory tool callbacks and tool loop (`PendingMemoryToolRefresh`).

Evidence: `agent/lib/tests/personal-memory-recall-refresh.test.ts`.

## Group vs personal memory boundary (G02)

Group-scoped sessions use G01 `conversationScope =
group:<channel>:<installation>:<chatId>`. Those sessions **must not** freely
read or bind personal profile memory. Gates live in
`group-memory-policy.ts` and are wired into `authorizePersonalMemoryContext`,
profile recall/update controls, the native inspect tool, and personal wipe.

Shared-group memory is a **stub** keyed by `conversationScope` (empty
projection, `personalProjection: null`). Personal wipe covers only
structured profile + bound profile notes and explicitly never shared-group
keys. See `docs/decisions/adr-g02-groups-memory-policy.md`.
