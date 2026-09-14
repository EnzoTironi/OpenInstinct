# Zoen launch validation

Status (2026-09-14): the Google-first onboarding release is deployed. Existing
Google and WhatsApp accounts have completed real sign-in, and a WhatsApp reply is
visible in both the native app and web history. Telegram group isolation fixes
are merged; their production promotion and a real group reply remain pending.
Explicit consolidation of the separate pilot accounts is not yet qualified.
This ledger is evidence, not launch approval.
Deployed baseline: `94b1f1e117ea7e3d49d1ff923097bd0883d2d8aa`.
This ledger tracks the launch work after the verified team-agents release.
A passing component test is not a completed user journey or a live-provider proof.

## Current functional qualification

- [Onboarding PR #96](https://github.com/EnzoTironi/tryzoen/pull/96) passed
  [main checks](https://github.com/EnzoTironi/tryzoen/actions/runs/34873440706),
  [15/15 native scenarios](https://github.com/EnzoTironi/tryzoen/actions/runs/34873442312)
  and [Alchemy deployment](https://github.com/EnzoTironi/tryzoen/actions/runs/34874759715),
  including isolated PostgreSQL recovery and live health verification.
- Actual Google sign-in requested only OpenID, email and profile. It returned to
  the existing pilot account with its personal/team spaces and linked Telegram
  identity intact. This proves an existing-account round trip, not a new invitee's
  full onboarding or new Gmail/Calendar consent.
- Actual WhatsApp login delivered an interactive confirmation, consumed it in
  the originating browser and opened the existing account. A later ordinary
  message received an agent reply visible in WhatsApp and the web history. The
  provider's registered phone number is valid; no number or database was reset.
- The pilot's Google/Telegram account and legacy WhatsApp account are separate.
  A normal link challenge correctly refuses this conflict. The browser currently
  waits until expiry while the native chat reports refusal; this is not a passed
  recovery journey. Consolidation still requires the explicit archive flow.
- An old native approval interrupted the legacy WhatsApp conversation. The
  cancellation was followed by successful ordinary replies. This observation
  does not establish automatic approval expiry or universal stuck-session recovery.
- [Group PR #97](https://github.com/EnzoTironi/tryzoen/pull/97) is merged at
  `b8e121d340e1009f10471b760a2cba253e9b9996`; its
  [main checks](https://github.com/EnzoTironi/tryzoen/actions/runs/34880079345) passed.
  Five live-model group replies passed through real signed webhook, Eve and
  PostgreSQL paths with only outbound Telegram HTTP replaced. Two senders share
  group context; private DM and other-group canaries remain isolated. Unmentioned
  and revoked messages are rejected or ignored. This is a provider fixture, not
  actual Telegram delivery.
- The [group native evaluation](https://github.com/EnzoTironi/tryzoen/actions/runs/34880453682)
  passed 14/15 cases. Its browser inspection succeeded through `browser_snapshot`,
  but the assertion recognized only the older DOM tool or a screenshot. The
  matcher now includes the current DOM snapshot tool; every other outcome and
  authorization assertion is retained. A new exact-commit run must pass before
  deployment; this failed run is not reclassified as a pass.
- Messenger launch buttons now use native application links, preserving the exact
  challenge token, with a separate HTTPS web fallback. Rendering tests cover both
  messengers. Automated browser policy prevented native-scheme navigation, so
  those tests do not claim a successful OS handoff.
- The owner cancelled the recording requirement. Functional provider evidence
  remains required. WhatsApp ordinary groups are not supported by the current
  Kapso Cloud API configuration; no WhatsApp Web bridge is deployed.
- Fresh dependency audits initially found four application production advisories
  and additional development/infrastructure advisories. Patched parser releases
  and compatible infrastructure dependency overrides remove the reported issues;
  the unused Vercel CLI and its dependency tree were removed. Both full dependency
  audits now report zero advisories. CI audits application and infrastructure
  lockfiles without severity exclusions. This is an advisory-database check, not
  proof that all application code is free of security flaws.
- The public repository now has a Zoen README, contribution/security/conduct
  policies, beta terms/privacy notice, PR and issue templates, and automated
  dependency-update configuration. Private vulnerability reporting is enabled.
  Existing copyright and third-party license notices remain intact.

The dated sections below retain earlier evidence and failures. Their historical
deployment and provider-quota statements do not supersede this current status.

## 2026-09-14 launch candidate: requested points 1, 3, 4 and 5

- Recovery requires an explicit browser choice, a fresh Better Auth session and
  an exact native approval in the existing messenger session. The previous account
  remains a private archive. New channel identity IDs prevent old continuations
  and approvals from acquiring the target account's authority. Old browser sessions,
  routines and agent grants are revoked or paused; team permissions are not copied.
- Automatic recovery refuses verified email/phone accounts, Google/credential
  accounts, vaults, web conversations and organization/team memberships. The current
  pilot's WhatsApp account has no Google connection, organization, vault or web chat;
  Telegram and WhatsApp still belong to separate accounts in production.
- Tests cover missing recovery consent, stale or substituted sessions, a changed
  eligibility state at consumption, deliveries in flight, concurrent consumption,
  native confirmation without the recovery flag, old native addresses, duplicate
  provider events, altered replay payloads, archive ownership and session revocation.
- Actual 390 × 844 browser flows passed in PT-BR, English and Spanish: sign-in,
  username, company creation, invitation, acceptance, personal/work switching,
  archive recovery, reading preserved history, and removing a member. Messenger
  confirmations in these isolated flows are simulated through the real native-auth
  service; this does not claim a completed live WhatsApp/Telegram journey. Google
  sharing/revocation and refresh races pass against real PostgreSQL with a provider
  fixture; a fresh live Google journey remains separate evidence.
- `pnpm check`: 1,360 passing tests, three intentional skips, types/lint/format/dead
  code checks passed. Runtime: 137 passing tests, including a real isolated Synapse
  homeserver. `pnpm build` passed. No production database was used for these tests.
- A warm local production build served 480 read-only requests across readiness,
  Eve health, welcome and sign-in, at concurrency 1/5/20, with zero failures. At 20
  concurrent requests, throughput was 360.61 requests/s, p95 92.79 ms and p99 134.15 ms.
  These are local application/storage measurements, not production capacity or LLM
  response latency. After an abrupt SIGKILL of the isolated PostgreSQL container,
  readiness correctly returned 503, recovered to 200 after restart, and retained
  all 24 identities, three archives and nine invitations in that fixture database.
- Production inspection: backup repository and WAL archiving healthy; 26 backups,
  3% database disk usage, 9,402,148 KiB available. Available VM memory was about
  1.13 GB for web and 0.70/0.66/0.69 GB for PostgreSQL/Mem0/Matrix respectively.
  This is one observation at idle, not a sustained production load claim.
- A new Alchemy restore drill passed against an isolated temporary machine,
  including PostgreSQL `amcheck`:
  [recovery run](https://github.com/EnzoTironi/OpenInstinct/actions/runs/34807631468).
  The uptime workflow now maintains an assigned incident issue on failure and closes
  it after recovery. The live [alert drill](https://github.com/EnzoTironi/OpenInstinct/actions/runs/34808229422)
  opened assigned [incident #90](https://github.com/EnzoTironi/OpenInstinct/issues/90),
  and the following [healthy run](https://github.com/EnzoTironi/OpenInstinct/actions/runs/34808443382)
  commented and closed it automatically. This proves the GitHub incident path,
  not receipt of an email or push notification on the owner's device.
- Migration `0040` is additive except for allowing historical revoked identities
  alongside one active provider address. Once recovery has been used, deploy only
  versions which prefer the active identity; older lookup code is not a safe rollback
  target. Preserve both source data and archive records during a forward repair.
- Spark quota is available again. The models remain unchanged. A successful native
  evaluation on the exact merged commit is still required by the Alchemy deploy
  workflow; no gate or provider limit has been bypassed.

### Fresh hosted and live evidence

- [Recovery PR #89](https://github.com/EnzoTironi/OpenInstinct/pull/89) is merged as
  `4b050e85143845aeae37fdd9f41a0c80a33ee737`. Its [main checks](https://github.com/EnzoTironi/OpenInstinct/actions/runs/34808180699)
  and [Alchemy plan](https://github.com/EnzoTironi/OpenInstinct/actions/runs/34808540182)
  passed. A plan does not deploy the application.
- The [native run on that exact commit](https://github.com/EnzoTironi/OpenInstinct/actions/runs/34808227600)
  passed four of five scenarios. Browser execution failed before tool use because
  OpenRouter rejected the configured output budget for insufficient credits.
  The release gate remains failed; models, token budget and approval requirements
  have not been weakened to obtain a passing score.
- A short public production probe completed 600 requests at concurrency five,
  with zero errors, p95 86.40 ms and p99 138.15 ms. It exercised `/welcome`,
  `/sign-in` and Eve health through Cloudflare over 6.84 seconds. This is neither
  a sustained model benchmark nor proof of messenger throughput. The new database
  readiness route is not yet deployed; the old release redirects it to sign-in.
- The actual pilot's Google credentials were connected while the workspace's
  Google plugin was disabled, leaving native discovery without Google tools.
  After explicit activation through the UI, production receipts show successful
  `gmail-search` (1,018 ms) and `calendar-list-events` (650 ms). The queries used a
  synthetic message ID and a one-minute window in 2099, returned zero records and
  performed no external mutations. Connection and mail screens now distinguish
  paused authorization; the connect action enables the personal plugin, and can
  resume an existing grant without another OAuth redirect. Reads never reactivate
  an explicitly disabled plugin or share credentials with a team.
- Live team sharing failed before storing a team credential. Google's tokeninfo
  endpoint supplied `email_verified` as the string `"true"`, despite the SDK's
  boolean declaration. The fix accepts only boolean `true` or exact string `"true"`,
  verifies the subject and OAuth audience, and rejects false/string-false/other
  truthy values. Provider-fixture regressions include revocation and token-refresh
  races; successful live sharing/revocation still requires the fixed deployment.
- The served application remains `5c18eaaa5da24039350e683f6da22e18242f7e86`.
  No production identities were consolidated or source histories rewritten during
  these checks. The archived-account flow must be exercised after promotion.
- Google follow-up validation: `pnpm check` passed with 1,361 tests and three
  intentional skips; all 149 runtime tests passed against isolated PostgreSQL
  and Matrix; the production build passed. In the built UI, a synthetic account
  with an existing OAuth grant showed Google as paused, then reactivated it with
  one click while retaining the open connections sheet and avoiding another OAuth
  redirect. This UI fixture is distinct from the live-provider receipts above.

## Release gates

- [x] Executor: one owned product catalog, Code Mode search and schema discovery,
      Git-backed skill loading, live scope checks, exact-argument native approval,
      and no business tool bypass through Eve's authored surface.
- [ ] WhatsApp: current provider readiness, login/link, inbound/outbound delivery,
      interruption, media, duplicate webhooks and proactive-send policy.
- [x] iMessage: excluded from the closed beta by the owner; keep its activation
      unavailable until the future Linq integration is configured and validated.
- [ ] Onboarding: new personal account, company invitation/acceptance, explicit
      Google sharing, revocation, and all three languages in the built UI.
- [x] Billing: free closed beta, paid checkout and upgrades locked. No Stripe
      account or real financial operation is required for this release.
- [ ] Operations: sustained concurrent workload, recovery under interruption,
      delivery latency, resource headroom and an observable alert path.
- [x] Native Eve evals: current tool inventory, deterministic outcome assertions,
      negative permission cases, held-out variants and independent sessions.
- [x] Benchmarks: repetitions, per-case receipts, p50/p95 latency, observed usage,
      failure classification, explicit unsupported cases and reproducible commands.
- [ ] Publish: checks, build, hosted CI, review, merge, Alchemy deployment and
      production smoke verification against the released revision.

## Benchmark reference

[Assistant Benchmark](https://assistantbenchmark.com/dimensions) publishes one
task per scored dimension and separates untested from inapplicable capabilities.
Its scorecard contains different evidence types and different observation windows;
our automated results are not directly comparable to its published rankings.

The following reference scenarios inform independent Zoen cases:

| Reference                                                                    | Zoen proof                                                                                                                                          |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Routines](https://assistantbenchmark.com/dimensions/running_routine)        | Persist, deliver, change and stop a routine; measure actual delivery and missed-run recovery. Accelerated tests do not claim a week of observation. |
| [Memory](https://assistantbenchmark.com/dimensions/memory)                   | Apply a saved preference in a new session, notice contradictory context, and honor forgetting.                                                      |
| [Permissions](https://assistantbenchmark.com/dimensions/permissions_privacy) | Respect a read-only grant and approval boundary; deny access immediately after revocation.                                                          |
| [Chained tasks](https://assistantbenchmark.com/dimensions/chained_tasks)     | Finish a multi-tool request with persisted artifacts and a verifiable user-facing receipt.                                                          |
| [Restraint](https://assistantbenchmark.com/dimensions/proactive_restraint)   | Stop after cancellation, avoid unsolicited mutations, and suppress duplicate delivery.                                                              |

Do not give a score for an unexecuted case. Keep external failures and product
failures visible. A safety violation cannot be averaged away by fast successful
requests. Model fixtures, provider fixtures and live services are different
evidence tiers and must remain identifiable in the report.

## External activation

The current installation has Kapso and Google configuration. On 2026-09-13 the
owner excluded iMessage (future Linq) and requested a free closed beta with billing
locked. No production credentials or personal conversation contents belong in
public benchmark artifacts.

## Executor ownership

`server/executor/catalog.ts` resolves the current workspace's product capabilities.
`agent/tools/execute.ts` and the declared browser worker's `tools/execute.ts` are
thin Eve mounts. The model cannot select its own coordinator/browser surface.
Business implementations and schemas live in `server/executor/tools` and
`server/executor/browser`; native message, question, approval and memory adapters
live in `server/executor/native` and `server/executor/memory`.

Eve still owns turns, sessions, tasks, approval continuations and memory refresh.
Its framework controls remain native; there is no second agent loop or scheduler.
The former root shell/file/skill built-ins are disabled so they cannot bypass the
workspace catalog. The pinned Executor kernel is documented in
[`vendor/executor/README.md`](../../vendor/executor/README.md).

The discovery contract is progressive: search returns short entries, describe
returns the owning JSON schema and invocation signature, and reading a skill
returns its Git path, revision and procedure. JavaScript/TypeScript composes
bounded reads in QuickJS; mutations use one structured `execute({call:{path,input}})`
per native Eve action. Host policy evaluates the exact arguments and rechecks live
membership, enabled plugins and grants on every invocation. Git procedures grant
no authority. A write requested from code returns `call_required` without running.

Trusted host receipts record completed, failed and deferred calls separately from
model-generated text. File and skill receipts identify the path/revision actually
read. Program text cannot forge an executed operation or source revision.

## Evidence and coverage

Production rollout on 2026-09-13:

- [Executor ownership PR #81](https://github.com/EnzoTironi/OpenInstinct/pull/81)
  is merged. The [Alchemy deployment](https://github.com/EnzoTironi/OpenInstinct/actions/runs/34794922115)
  passed checks, plan, deployment, isolated recovery and public health verification
  for `5c18eaaa5da24039350e683f6da22e18242f7e86`.
- Web, PostgreSQL, Mem0 and Matrix machines are started with immutable image
  digests. The application role remains `zoen_app`, without superuser or public
  schema creation rights. There are 40 application and 23 workflow migrations.
- Telegram reauthentication completed through the actual private bot and browser.
  The production account panel shows the free beta without a checkout action;
  personal connections expose Google, Telegram and WhatsApp, with iMessage absent.
- A real WhatsApp request reached the new endpoint with HTTP 200 on its first
  delivery attempt, and the bot replied. Its initial account-link interpretation
  incorrectly delegated to WhatsApp Web. The coordinator instructions now route
  Zoen account authentication through Executor's native device-auth tools. The
  complete account-link journey is still a separate, unpassed gate.
- A read-only production inspection confirmed that the current Telegram and
  WhatsApp pilot identities belong to different accounts. A prompt or webhook
  correction cannot safely unify them. Explicit account consolidation is still
  required; the conflict check has not been bypassed and no identities were moved.
- The deployed web chat completed a real Code Mode query with two successful
  Executor searches, one for tools and one for skills, then replied normally.
  That workspace has no published skills; the synthetic benchmark provisions
  its own Git procedures. The query performed no file or external mutations.
- CI now starts the built application and native Eve server in addition to
  compiling them. Early hosted eval attempts failed before scoring: the runner
  needed its build port aligned, Eve's own credential file prepared, and runtime
  queue grants applied after migrations. These failures are retained; they are
  not counted as passing evaluations.
- The first hosted run to reach all cases, [34797091226](https://github.com/EnzoTironi/OpenInstinct/actions/runs/34797091226),
  passed 13/15 scenarios. One browser model call failed before invoking tools;
  one approval case ended without a pending approval. All nine skill cases
  passed, with recovered tool attempts. The release gate remains failed. The
  upload action had excluded hidden files, so this run's console evidence is
  retained but its detailed receipts were not uploaded. Explicit hidden-file
  inclusion is limited to the receipt/JUnit paths; subsequent summaries also
  retain event types, failure categories and mandatory assertion counts without
  exporting provider messages or model payloads.
- The next hosted run, [34798930394](https://github.com/EnzoTironi/OpenInstinct/actions/runs/34798930394),
  retained its reports correctly. It passed 7/15 scenarios, then the remaining
  eight were blocked before tool execution by `The usage limit has been reached`.
  It is a failed release gate, not a product pass. The selected models were not
  changed and no reset credit was consumed.
- A separate local approval reproduction passed twice (30 mandatory assertions)
  and then timed out in a provider call after schema discovery, before any
  approval or mutation. The failed run is retained under
  `.eve/launch-0bc3253b-bd18-4307-a100-0f7f2a1fec64/run-3.json`.
  Configured model requests now carry a 90-second abort deadline, including the
  response stream, combined with Eve's existing cancellation signal. Native Eve
  retains retry and action execution ownership. Tests cover a stalled stream,
  user cancellation and model identity/request-option preservation; the new
  deadline still needs a fresh live run after provider quota is available.
- Production deployment now requires both the latest Checks and native eval
  workflows to pass on the exact source commit. A previous successful run cannot
  hide a newer failed run. Plan, backup and recovery operations remain available.
  The deadline and release-gate hardening await the next validated deployment;
  production still runs the `5c18eaaa` release identified above.

Local validation on 2026-09-13:

- `pnpm check`: 1,360 tests passed, 3 skipped; type, lint, formatting and unused-code
  checks passed. The skips remain visible and are not counted as passes.
- Full PostgreSQL/Matrix runtime suite: 137 tests passed in 37 files.
- Isolated infrastructure type check and provider suite: 22 tests passed.
- Production web/agent build passed on Node 24.21.0.
- Native launch benchmark: 3 independent repetitions, 15/15 scenarios passed and
  165/165 mandatory assertions passed. The suite uses the real Eve HTTP/session
  protocol, live models and a real Kernel browser with synthetic workspace data.
- Across these 15 scenarios: 152 native actions, 113 host calls, p50 32.796 seconds,
  p95 46.244 seconds (nearest rank, includes model/provider latency). The sample is
  small; these are observed scenario latencies, not a service SLO.
- The agent recovered from 1 native preflight denial, 3 code errors and 7 failed
  host calls. These categories may overlap within a single action and must not be
  summed into a failure rate. Only 5/9 skill scenarios had no failed attempts.
  Safety and final persistence passed; first-attempt reliability still needs work.
- Models remained `codex/gpt-5.3-codex-spark` and
  `openrouter/openai/gpt-5-mini`. Both input/output usage fields were available.

Local sanitized receipts are under
`.eve/launch-12226012-091b-4df5-b4cb-625e6f6a29f3/run-{1,2,3}.json`.
Earlier failed runs remain in `.eve`; they exposed fixture/assertion defects,
invalid model calls and an asynchronous browser binding issue. They were not
discarded to calculate the final run. `.eve` is excluded from Git because native
traces can contain sensitive data outside the synthetic launch suite.

| Capability family                                         | Current verification                                                                                | Evidence limit                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Catalog, schemas, skills, Git files                       | Live-model EN/PT-BR/ES procedures; runtime read/write/replay, revoked membership and plugin changes | Synthetic isolated workspaces                                           |
| Ontology actions                                          | Native approve/refuse/re-propose/approve, exact arguments and Git revision                          | One typed project status action; not ontology inference                 |
| Browser, screenshots, computer actions, opaque vault      | Worker schema/boundary tests, runtime traces, live Kernel create/read/delete                        | Live launch case is read-only and does not exercise every website       |
| Gmail, Calendar, Contacts and explicit team Google grants | Owner tool tests and scoped runtime integration tests                                               | No new live Google write in the launch benchmark                        |
| Artifacts, device authorization, schedules                | Complete runtime suite, including duplicate/replay and native scheduled report behavior             | Accelerated tests do not establish week-long delivery reliability       |
| Native personal/profile/workstream memory and Mem0        | Runtime persistence, isolation, cancellation/revocation race tests; private Mem0 CI suite           | Model fixtures and live-model results are distinct evidence tiers       |
| Messaging and questions/approvals                         | Runtime transport/outbox/auth tests and native approval eval                                        | WhatsApp live round-trip still required after deployment                |
| Matrix groups and A2A                                     | Real isolated homeserver/runtime membership, history and scoped grant checks                        | Federation, E2EE attachments and A2A push/streaming remain outside beta |

## Reproducing native evaluations

Use the **Zoen native agent evals** workflow on `main`, with 1, 3 or 5 repetitions.
It creates disposable PostgreSQL roles and databases, builds the native app, runs
the suite, and uploads only sanitized reports/JUnit. `ZOEN_EVAL_PROVIDERS` contains
only the three model/browser credentials; no production database, Google, channel
or billing credentials enter that environment. Credential encoding is checked by
a lossless dotenv round-trip. The production configuration is a different secret.

For an already prepared isolated local instance:

```sh
node --env-file=/path/to/isolated-eval.env --import tsx scripts/run-agent-evals.ts \
  --url http://127.0.0.1:4351 --suite launch --repeat 3 --timeout 240000 \
  --junit .eve/launch.xml
```

The runner rejects a production URL or database; it requires the loopback
`companion_runtime_test` database and authenticates through real ephemeral Better
Auth sessions. Every repetition gets fresh actors, canaries and Git content.
Native tasks/sessions are cancelled/reset before fixture membership is removed.
All requested repetitions run before the aggregate gate exits nonzero on any
failed, errored, skipped, scored or empty result.

## Production corrections and review

WhatsApp inspection found an active webhook on the old Companion domain and a
missing required `KAPSO_PHONE_NUMBER` deployment variable. The existing webhook
was corrected to Zoen; Alchemy now declares the missing configuration and owns
webhook reconciliation/readback for Telegram and WhatsApp. Foreign or ambiguous
webhooks fail explicitly. Missing provider configuration returns retryable HTTP
503 instead of blaming the inbound payload with HTTP 400.

The beta locks paid entrypoints even if Stripe keys are present, rejects new
uninvited channel registrations, preserves existing accounts and allows explicit
linking from a recently authenticated account. iMessage requires the future Linq
connector as well as an address; a marketing phone number alone cannot activate it.

Structural review: extracted channel event acceptance and provider error handling,
and consolidated the paid configuration guard. Remaining ripwire findings are
recent file churn, the existing cohesive ChannelAccounts service growing by its
admission checks, and moved browser implementations flagged as new symbols.
No baseline/ack was added to hide these findings. All affected runtime suites
identified by the test gate passed; dynamic framework callbacks still require
native evals, since static call-graph coverage cannot establish their behavior.
