<p align="center"><img src="public/marketing/zoen-avatar.webp" width="88" alt="Zoen mascot" /></p>

# Zoen

**Less on your mind. More in your life.**

Zoen is an open-source assistant for personal and team workspaces. Talk to it in
the web app or a connected messenger, give it useful skills, and keep control of
the accounts, files and actions it can access.

[![Checks](https://github.com/EnzoTironi/tryzoen/actions/workflows/checks.yml/badge.svg)](https://github.com/EnzoTironi/tryzoen/actions/workflows/checks.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Stage: free closed beta.** This repository is actively developed. The
[launch ledger](docs/decisions/zoen-launch-validation.md) separates passing tests,
live-provider evidence and remaining launch gates. It is the source of truth for
qualification; a green badge alone does not mean every integration is available.

## What it does

- A visual web app in English, Spanish and Brazilian Portuguese, with personal
  and work spaces, conversations, recipes, connections and account controls.
- Google sign-in through Better Auth; Telegram and WhatsApp use short-lived
  requests confirmed in the user's private messenger conversation.
- An owned Executor catalog for tools, plugins and Git-backed skills. Eve uses
  Code Mode to discover capabilities and performs mutations through exact-input
  approvals and current workspace permissions.
- Versioned files and agent instructions, personal memory through Mem0, scheduled
  work, browser tasks and explicit Google Workspace connections.
- Operational traces, scoped diagnostics and configurable beta telemetry to
  investigate failed journeys without making private workspaces public.

Telegram group support is being qualified. Ordinary WhatsApp groups are **not
enabled** by the current Kapso Cloud API setup. iMessage and paid checkout are
unavailable during this beta. Vaultwarden and Beeper are evaluations, not shipped
integrations. Reference catalogs under `docs/recipe-integrations/` are research,
not a list of activated product capabilities.

## Architecture

| Layer                      | Responsibility                                              |
| -------------------------- | ----------------------------------------------------------- |
| Next.js + React            | App, onboarding and authenticated browser interface         |
| Better Auth + PostgreSQL   | Identity, sessions, memberships and access boundaries       |
| Eve + owned Executor       | Durable agent execution, discovery, approval and tool calls |
| Git + Mem0                 | Versioned durable content and scoped memory                 |
| Matrix + A2A adapters      | Collaboration and agent interoperability boundaries         |
| Alchemy + Fly + Cloudflare | Declared deployment, private services, TLS and operations   |

Git branches are not authorization boundaries. Personal credentials and memories
do not become team or group data just because the same person uses both spaces.
Secrets stay outside Git. Operon is not required for the current architecture.

## Run locally

Use **Node.js 24**, **pnpm 11.24.0** and PostgreSQL. Docker is needed for the
isolated infrastructure and integration tests.

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
chmod 600 .env.local
```

Set the database URLs, application URL and independent authentication/encryption
keys in `.env.local`. Choose and authenticate a supported model provider. Never
reuse production credentials or a production database for local tests.

Follow [self-hosting](docs/self-host.md) and the
[Alchemy infrastructure guide](infrastructure/README.md) to provision PostgreSQL,
roles, optional services and provider configuration. With that environment ready:

```sh
node --env-file=.env.local --run db:migrate
node --env-file=.env.local --run workflow:migrate
node --env-file=.env.local --run build
pnpm start --port 3000
```

The launcher owns both Next and Eve and stops the sibling if either exits. Eve's
internal interface stays on loopback. Connectors need their own credentials and
verified webhook setup. Provider subscriptions, terms and quotas still apply when
you bring an existing model account.

Production deployment uses the **Zoen infrastructure** GitHub workflow and
Alchemy. Promotion requires successful checks and native evaluations on the exact
source revision, then performs an isolated recovery drill and live health checks.
See the [operations guide](docs/ops/README.md). The Vercel CLI is not part of this
installation's deployment toolchain.

## Validate and contribute

```sh
pnpm check --concurrency=1
pnpm db:check
pnpm audit
pnpm --dir infrastructure audit
```

`pnpm test:runtime` requires the dedicated `companion_runtime_test` database and
an ignored `.env.runtime.local`. It must never run against production. Native
agent evaluations additionally need isolated fixtures and authorized model/browser
credentials; see [reproduction instructions](docs/decisions/zoen-launch-validation.md#reproducing-native-evaluations).

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change. Use issue forms
for reproducible bugs and feature proposals, and keep credentials and real
customer conversations out of public reports. Security concerns go through
[private vulnerability reporting](SECURITY.md), not public issues.

## Project policies

- [Security and supported versions](SECURITY.md)
- [Contribution guide](CONTRIBUTING.md) and [community conduct](CODE_OF_CONDUCT.md)
- [Hosted beta terms](TERMS.md) and [privacy notice](PRIVACY.md)
- [Architecture decisions](docs/decisions/) and [current launch evidence](docs/decisions/zoen-launch-validation.md)

## License

Code is distributed under the [MIT license](LICENSE), with required copyright
notices preserved. Dependencies and artwork may have separate terms; consult
[third-party notices](THIRD_PARTY_NOTICES.md) before redistributing them. Product
names and third-party brand assets are not granted by the code license.
