# Stored personal-memory inspection and export

This slice exposes the current account's stored structured profile and bound Eve
profile documents. It does not export the whole account. Conversation history,
artifacts, connections, schedules and unbound memory documents are explicitly
excluded in every snapshot. `notes.status = "unresolved"` means no trusted binding
has yet been observed; it does not mean the account has no saved notes.

## Composition

Apply `composition.patch` at the application root after this source commit:

- Add `PersonalMemory.layer` to the existing SQL infrastructure in
  `server/runtime.ts`.
- Import and render `PersonalMemorySection` in `/account`.
- Register the new tool filename in the existing exact root-tool inventory.

The coordinator owns the Drizzle schema and migration registration. `binding.sql`
is the exact required table definition, not an independently registered migration.
It was applied manually **only** to the existing `companion_runtime_test` database
for this slice's real storage proof. The table therefore already exists there;
coordinate migration adoption without inventing an applied migration record.
No existing migration or schema file was changed by this worker.

`PersonalMemory.layer` requires `PgClient.PgClient`. Its methods are internal
application operations; routes and tools must resolve authority first:

- `bind(scope, memory)` records the trusted public Eve callback's binding.
- `inspect(scope)` checks canonical membership before and after reading the
  existing profile service and bound note documents.
- `inspectPersonalMemory(headers)` validates Better Auth plus the live session
  row and membership before and after reading.
- `exportPersonalMemory(headers)` serializes that same result with an attachment
  disposition, JSON content type, `nosniff` and `private, no-store`.

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
requires live membership, and checks the resolved value equals that workspace and
the slot equals `profile`. Only then does it register the key. A primary-key plus
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

Independent review and final root integration are pending. This slice does not
claim the remaining P06 correction/forget, deletion or restore acceptance gates.
