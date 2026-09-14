# Zoen launch validation

Status: Executor ownership is merged and deployed; final native CI and channel
journey verification remain in progress. This is not a blanket launch approval.
Baseline: `601014ec894fb7ae482373495400cfe796c860af`.
This ledger tracks the launch work after the verified team-agents release.
A passing component test is not a completed user journey or a live-provider proof.

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
- CI now starts the built application and native Eve server in addition to
  compiling them. Early hosted eval attempts failed before scoring: the runner
  needed its build port aligned, Eve's own credential file prepared, and runtime
  queue grants applied after migrations. These failures are retained; they are
  not counted as passing evaluations.

Local validation on 2026-09-13:

- `pnpm check`: 1,355 tests passed, 3 skipped; type, lint, formatting and unused-code
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
