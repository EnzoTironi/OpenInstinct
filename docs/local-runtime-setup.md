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

`pnpm test:runtime` runs the separate real-Postgres profile and fails if its database is unavailable. It does not use the unit suite's environment defaults or service mocks. The CI storage job migrates the application, runs workflow setup twice to check repeatability, exercises storage, and builds both servers. Its database and random installation keys are ephemeral.

## Credential readiness

| Variable             | Current use                                       | Verification                                                                                                                                         |
| -------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KERNEL_API_KEY`     | Existing browser worker, loaded only when invoked | Authenticated browser-list request returned HTTP 200. No browser session was created.                                                                |
| `TELEGRAM_BOT_TOKEN` | Reserved for the planned Telegram channel         | `getMe` confirmed ZoenOSBot; `getWebhookInfo` reported an existing webhook and zero pending updates. Channel is not yet wired into this checkout.    |
| `KAPSO_API_KEY`      | Reserved for the planned WhatsApp channel         | Dedicated companion-development key; read-only phone-number and webhook requests returned HTTP 200. Number reported CONNECTED; one webhook exists.   |
| `OPENCODE_API_KEY`   | Local OpenCode CLI experiments                    | Free Muse Spark 1.3 and Nemotron 3.5 Lightning each returned READY through OpenCode 1.17.20, with reported cost zero. Not an Eve runtime credential. |
| `AI_GATEWAY_API_KEY` | Current upstream Eve model routing outside Vercel | Not configured in this checkout.                                                                                                                     |

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
