# Local runtime setup and evidence

Status: September 8, 2026. This branch is an implementation increment, not a completed companion release.

Use Node 24 and the pinned pnpm version. Keep secrets in `.env.local`, which Git ignores, and restrict the file to its owner (`chmod 600 .env.local`). Do not paste credentials into tracked examples, test fixtures, review descriptions, or logs.

## Build and run locally

The compiler is pinned to TypeScript 7.0.2. Next 16.3.3 uses its native TypeScript CLI support; no second compiler or ignored build errors are configured.

Set `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, and `SECRET_ENCRYPTION_KEY` for your installation. Generate the keys locally with cryptographic randomness. The browser key is optional. Then run:

```sh
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm workflow:migrate
pnpm build
pnpm start --port 3000
```

`pnpm build` builds both Eve and Next. `pnpm start` owns both Node processes in an Effect scope: Eve stays on loopback port 4274, Next defaults to loopback port 3000. Use `--hostname 0.0.0.0` to expose Next through your TLS proxy. The launcher waits for Eve's HTTP health route before starting Next; this establishes HTTP availability, not completion of an authenticated workflow. Exit of either child fails the launcher and stops its sibling. Shutdown allows 15 seconds before forced termination.

To change Eve's internal port, set `EVE_NEXT_PRODUCTION_PORT` during the build and use the same value at startup (or `--eve-port`). The launcher rejects mismatches against Next's compiled route manifest. Workflow callbacks go directly to the internal Eve origin. Do not expose its workflow callback routes through a public proxy without separately qualifying service authentication.

Eve uses `@workflow/world-postgres@5.0.0-beta.39`, matching its installed Workflow world/protocol dependency line. `WORKFLOW_POSTGRES_URL` can select a separate workflow database; otherwise the adapter uses `DATABASE_URL`. Run `pnpm workflow:migrate` against that database before starting any workers. The launcher defaults to a pool of 10 and concurrency of 4, configurable through the variables in `.env.example`.

`pnpm test:runtime` loads the ignored `.env.runtime.local` and requires a dedicated database named `companion_runtime_test`. Set `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, and `WORKFLOW_POSTGRES_URL` in that file to this database, using your PostgreSQL credentials. The profile checks the connected database name before writing fixtures; it does not load the application's `.env.local` or the unit suite's defaults and mocks. Create the database with your PostgreSQL administrator, then initialize it:

```bash
node --env-file=.env.runtime.local node_modules/drizzle-kit/bin.cjs migrate --config db/drizzle.config.ts
node --env-file=.env.runtime.local node_modules/@workflow/world-postgres/bin/setup.js
pnpm test:runtime
```

The CI storage job supplies the same dedicated database through environment variables, migrates the application, runs workflow setup twice to check repeatability, exercises storage, and builds both servers. Its database and random installation keys are ephemeral. Storage tests use synthetic inputs through real PostgreSQL; they do not establish provider delivery or authenticated Eve replay.

## Scheduled callbacks

Self-hosted report and input callbacks use the existing installation encryption
key. Set `SECRET_ENCRYPTION_KEY` to a base64-encoded 32-byte random value, and use
the same value in the caller and Eve processes. `BETTER_AUTH_URL` must identify
the same public origin in both processes. The callback client permits HTTPS, or
HTTP on `localhost`, `127.0.0.1` and `[::1]` for local use. It rejects redirects.

Next forwards exactly `/internal/scheduled-run/report` and
`/internal/scheduled-run/respond` to Eve. These routes authenticate their own
requests; a browser cookie is not a service credential. The local signature uses
a purpose-specific derived key and binds the configured origin, POST method,
route, timestamp and raw body digest. Signatures expire after 60 seconds, with a
five-second allowance for future clock drift. Keep instance clocks synchronized.

This is time-bounded authentication. Replays within that window remain subject
to the existing run and report claims; the signature does not add a separate
replay journal or a new exactly-once guarantee. Vercel deployments retain native
OIDC authentication and its challenge responses. No development identity bypass
is enabled for local production callbacks.

The distinct `WORKFLOW_LOCAL_BASE_URL` still addresses the internal Workflow
service, not this public callback audience. Signed success through the complete
production routing was verified: unsigned and altered requests returned 401;
valid signatures reached the report and response handlers with nonexistent run
IDs and returned 202 and 409 respectively. These probes dispatched no scheduled
work. Execution across restart remains a separate qualification step.

## Credential readiness

| Variable             | Current use                                       | Verification                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KERNEL_API_KEY`     | Existing browser worker, loaded only when invoked | Authenticated browser-list request returned HTTP 200. No browser session was created.                                                                                                                     |
| `TELEGRAM_BOT_TOKEN` | Verified Telegram ingress and durable delivery    | `getMe` confirmed ZoenOSBot; `getWebhookInfo` reported an existing webhook and zero pending updates. Native channel composition is now wired locally; the existing webhook destination remains unchanged. |
| `KAPSO_API_KEY`      | Verified Kapso ingress and durable delivery       | Dedicated companion-development key; read-only phone-number and webhook requests returned HTTP 200. Number reported CONNECTED; one webhook exists.                                                        |
| `OPENCODE_API_KEY`   | Local OpenCode CLI experiments                    | Free Muse Spark 1.3 and Nemotron 3.5 Lightning each returned READY through OpenCode 1.17.20, with reported cost zero. Not an Eve runtime credential.                                                      |
| `AI_GATEWAY_API_KEY` | Current upstream Eve model routing outside Vercel | Not configured in this checkout.                                                                                                                                                                          |

The existing Telegram and Kapso webhook destinations were not modified. Wire the durable ingress path and ownership binding before redirecting either channel. Credential validity alone is not evidence of end-to-end messaging, media handling, approval safety, or recovery.

## Model qualification

The requested OpenCode Zen model `muse-spark-1.3` rejected a direct Responses API probe with `CreditsError` (insufficient balance). The free variant `muse-spark-1.3-contributor-free` rejected a direct probe with `MissingSessionID`, stating that its free tier can only be used in OpenCode. Nemotron 3.5 Lightning Free returned the same restriction. DeepSeek V4 Flash Free reported model unavailable.

The official OpenCode CLI successfully ran the free Muse and Nemotron models in an empty temporary directory with plugins disabled, sharing disabled, and tool permissions denied. This demonstrates model access through OpenCode only. It does not qualify Eve, tool execution, or a multi-user deployment. Do not fabricate OpenCode session headers to make a direct Eve call appear to originate from that client.

Sources: [Zen endpoints](https://opencode.ai/docs/zen), [OpenCode CLI](https://opencode.ai/docs/cli/), [Kapso phone-number API](https://docs.kapso.ai/api/platform/v1/phone-numbers/get-phone-number).

## Application validation

The principal-scope increment checks personal-workspace ownership for every authenticated principal, including non-Better-Auth IDs. Browser configuration is now lazy and returns a sanitized error when missing or invalid. Native autofill uses the same Kernel client boundary as other browser operations.

After independent review fixes, the repository suite passed 81 files and 708 tests, lint, type checking, and unused-code checks. Formatting failed on native autofill, was corrected, and the full format check then passed. The suite contains inherited mocks; these results are regression evidence, not live provider qualification.

Ripwire reported 17 major short-horizon-churn findings and two minor verbosity deltas for the optional-Kernel change. Those findings remain recorded; the quality gate was not green. The bounded change was independently reviewed with no remaining material findings. Do not treat this as a general architecture or security approval.

The earlier production-build attempt failed during page collection because database configuration was absent. A dedicated local PostgreSQL 17 instance subsequently accepted the real migration chain, and the configured production build passed without cache. The production server returned HTTP 200 for the sign-in page and redirected an unauthenticated root request to sign-in. Full runtime qualification, durable PostgreSQL workflow recovery, channel delivery, and direct Eve model inference remain separate acceptance work.

The self-host runtime increment reproduced a second failure: `next start` alone returned 500 for Eve health because no server listened on port 4274. The explicit launcher corrects this. Real checks returned health 200 through Next and 401 for unauthenticated session creation directly at Eve. Terminating either child stopped the sibling and exited nonzero; SIGINT freed both ports; restart restored HTTP health. A mismatched internal port failed before serving. The Postgres integration test preserved stream bytes and their completion marker across closed/recreated clients. These are separate proofs from an authenticated agent turn, completed/interrupted-step replay, or process-crash recovery of a workflow, which remain unqualified.

The updated regression suite passed all 708 tests and all six check tasks without cache. The first run of the new profile exposed missing Knip config discovery; the next exposed the old runtime environment assertion. Both failures are retained in the local evidence logs, and their fixes preserve explicit configuration and environment coverage. Independent review found no remaining material issue in this bounded runtime increment. CI execution is not established by local checks.

Ripwire's runtime delta reports one major verbosity increase in the CI `jobs` mapping and one minor increase in Turbo's `tasks` mapping. The quality gate is not green; the added real-database CI job accounts for the major increase. No baseline suppression or threshold change was applied.

## Native channel and memory increment

Telegram and Kapso now enter the same verified-account, durable inbox/outbox and
Eve session path. Provider event IDs remain distinct from reply message IDs.
Account linking uses short-lived, browser-bound challenges, and delivery of its
confirmation prompt is encrypted at rest. Dispatch revalidates active identity;
per-item expected failures do not cancel unrelated work. FIFO uses database
sequences, including text chunks created at the same timestamp.

Profile documents now use PostgreSQL through Eve's public memory backend. Reads
return versioned content; creates are conditional, and updates compare the last
read version atomically. Stale writes produce Eve's native conflict error. Empty
content is persisted with a new version. This storage adapter does not establish
the source, export, deletion and retained-summary semantics of P06.

The dedicated runtime profile passed 38 tests across ten files. These exercise
real PostgreSQL and Better Auth, including linking races/replay, delivery leases,
identity revocation, workflow stream persistence, memory CAS, reconnects, and
cancellation of a write blocked by an actual database lock. Native failure and
cancellation handlers persist one fixed, sanitized notice per turn, including
concurrent replay and revoked-identity rejection. The inherited unit
suite separately passed 781 tests across 86 files; inherited mocks remain
regression evidence only. One preceding run timed out because pure model
configuration unnecessarily initialized all database services. Running that
configuration Effect without the database runtime corrected the dependency;
the original lease-validation tests were unchanged.

The composed production HTTP path accepted verified synthetic Telegram messages
and assigned a burst to the same native session in order. It rejected unsigned
webhooks and unauthenticated Eve access. The account flow created an actual Better
Auth cookie after a signed confirmation and rejected premature completion and
replay. Synthetic sender IDs and local test secrets were used; these checks sent
no messages through external providers.

Native execution exposed and corrected two additional startup failures: implicit
file memory had no backend outside Vercel, and Effect's callable schema was not
recognized by Eve's object-only Standard Schema detector. The public backend and
a plain Standard Schema wrapper correct these boundaries. The latter has six
regression cases through the actual installed schema codec, with failure before
the correction and success after it.

Local model selection now supports `COMPANION_MODEL_PROVIDER=codex-local` through
Eve's public `chatgpt` provider and the existing Codex login. It selects exactly
`gpt-5.3-codex-spark`, low reasoning, an explicit 128,000-token context window and
no reasoning summary. The context setting follows the
[documented Spark window](https://openai.com/index/introducing-gpt-5-3-codex-spark/).
The summary option otherwise fails at the provider; the
missing context metadata otherwise fails Eve model selection. Neither failure
falls back to a different model. `gateway` remains the default. The optional
`openrouter-free` profile uses a fixed free model and zero-price provider routing;
its live inference remains unqualified.

A real Better Auth session created through a browser challenge and signed
synthetic confirmation completed a native Spark turn that saved a preference in
PostgreSQL. After restarting the application and Eve, a new session recalled the
exact preference without receiving it in its prompt. Initial runs repeated the
response tool call and failed the single-response oracle. The receipt and shared
instructions now explicitly prohibit repeating the same content through another
tool call and require ending a fulfilled turn. Independent review preserved
channel-specific delivery status and legitimate progress followed by a result.
The corrected save and full-restart recall runs each completed with exactly one
response tool result; the save also performed exactly one memory write. Failure
artifacts remain retained. This finite scenario is not a general guarantee of
model behavior or a real messaging-provider delivery test.

A second authenticated user received `UNKNOWN` for the first user's preference;
the original document remained intact. A subsequent native removal changed the
document version and removed that preference. After another full restart, a new
session for the original user also received `UNKNOWN`. These scenarios exercise
scoped recall and removal, not the complete export, retention or deletion policy.

A native cancellation request was accepted during streamed tool input. The
response tool still completed before `turn.cancelled` and `session.waiting` were
observed, so the stricter no-send-after-request oracle failed and remains recorded.
The asynchronous cancellation boundary did settle. A follow-up on that same
session then completed as a new turn with exactly one `RESUMED` response. Prompt
interruption of model execution is not established by that recovery result.

A native scheduled probe now survives a cold restart before its due time and a
second restart after delivery. The authenticated Spark session created one job;
one worker run completed on its first attempt and delivered one report to the
original session. The second restart retained the same 32 events and did not
repeat the report. This exposed a native Eve defect: persisted dynamic tools
lost their executable callbacks after process restart. The package patch now
skips obsolete turn-callback restoration between completed turns, while retaining
restoration for active continuations and pending approvals. Three installed-package
regression tests cover those cases. This proves the local scheduled report path; external channel
delivery and general interrupted model-step replay still require separate proof.

A crash during an active turn exposed a separate callback boundary: ordinary
turn-scoped dynamic tools are not rebound by Eve after restart. An explicit public
`rebindMissingCallbacks` opt-in now enables Eve's existing rebinding mechanism for
the messaging resolver. The resolver only selects tools; it performs no delivery
while resolving. The default remains disabled, and step-scoped callbacks are not
covered. Installed-package tests check the omitted, false and true settings.

The native Spark crash probe killed Eve after the memory step completed and the
next step started. After restart, the memory document kept the exact same version,
there was one successful memory write, and the resumed turn completed with one
successful response. This required manually releasing the one queue lock owned
by the targeted worker through Graphile Worker's public recovery API. The
installed worker normally retains such locks for four hours; this is evidence of
completed-step replay after manual queue recovery, not automatic crash recovery.
The earlier run without the opt-in failed to restore the response callback.

A different probe killed Eve after a successful memory action but before its step
completed. Manual queue recovery repeated that write and changed the document
version. Its strict duplicate-effect oracle failed and remains recorded. The
completed-step success does not close interrupted-step effect idempotency.

Native approvals, stop/correction UX, voice/files and real channel delivery
remain unqualified. Existing
Telegram/Kapso webhook configuration has not been redirected to this local server.

The latest full lint check passed after converting independent parser cases to
parameterized tests. TS7 and the uncached production build passed. Ripwire still
reports generated migration metadata size, recent code churn and a small
initialization-retry duplication; its quality gate is not green. Those findings
were not suppressed, and local validation does not establish CI execution.

After the shared message schema migration to Effect, the complete uncached unit
suite passed 794 tests in 89 files. The scheduled-report schema oracle now uses
the actual installed Eve Standard Schema contract and checks all three decoded
reply values. Full TS7 and lint checks also passed. Earlier full-suite failures
(two PGlite timeouts during concurrent heavy checks and the obsolete Zod-instance
assertion) remain recorded; the successful suite ran without concurrent heavy
checks.

Running the complete uncached check subsequently reproduced three PGlite timeouts
when Vitest initialized many workers alongside TS7 and lint. Bounding Vitest to
two workers fixed that resource contention without changing assertions or timeout
limits. The same `pnpm check --force` command then passed all six tasks and all
794 tests; the uncached production build also passed. The failed concurrent run
remains recorded.

## Product journey development

Home now leads into conversation, history, personal information and reminders.
First-chat examples populate editable drafts, including review of saved memory;
they never send automatically. Browser checks with a real Better Auth session
confirmed focus and draft editing, a visible native connection error with the
draft preserved, and one real Spark request navigating to its session and showing
the response. Desktop and mobile layouts were inspected.

Google setup now carries a validated local conversation destination through the
existing connection flow. The browser exercised chat → Home → the same chat and
rejected an external return destination. Live Google authorization remains
unqualified because Google OAuth credentials are not configured.

The read-only reminders page consumes existing scheduled jobs and their latest
execution and report states. Three real PostgreSQL cases cover account isolation,
conversation ownership, empty results and the 50/51 row boundary. Schedule
completion is not presented as delivery. The page shows UTC, caps the list at 50,
and keeps changes in the originating conversation; it adds no scheduler or write
endpoint. Full failure recovery and provider delivery remain release gates.


## Self-hosted Google Workspace

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` for a Google OAuth web
application. Register the exact installation URL followed by
`/api/auth/callback/google` as its authorized redirect URI. Enable the Gmail,
Calendar and People APIs and configure the consent audience for the accounts
that will connect. Follow Google's [web-server OAuth setup](https://developers.google.com/identity/protocols/oauth2/web-server)
for consent, offline access and any verification required by the requested scopes.

Google linking starts from Home or the conversation's native authorization
challenge. Better Auth handles the provider callback, account persistence and
refresh. A conversation challenge also binds the signed-in Companion account to
its native return destination. `@vercel/connect` remains only for the existing
Linq integration; Google no longer uses a Vercel connector ID.

The Home connection state reports a stored grant with the required scopes; it is
not a live Google health check. Missing credentials leave Google visibly
unavailable. Browser handoffs preserve Better Auth's state cookies, and a revoked
workspace membership cannot initiate another link. Run the focused database
check with `pnpm test:google-membership` against `companion_runtime_test`.

Better Auth 1.7.2 encrypts access and refresh tokens at rest, but its Google
callback persists the identity ID token without that encryption. The ID token
stays in the linked account row and is removed on unlink; raw account-info and
token HTTP routes are disabled. This SDK limitation remains an explicit
pre-admission gap. Live consent, refresh, provider revocation and native
suspend/resume with Google are still unqualified without Google credentials.
