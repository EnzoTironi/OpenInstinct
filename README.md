# Companion

A personal assistant for Telegram, WhatsApp through Kapso, and web chat. This
private fork of OpenInstinct is being rebuilt around Effect application services,
verified accounts, durable messaging, and Eve's session runtime.

This is an implementation in progress, not a finished release or an admitted
user pilot. The [product direction](docs/product-direction.md) defines the
experience; the [blueprint](docs/companion-blueprint.md) defines package contracts
and acceptance gates. The [runtime evidence](docs/local-runtime-setup.md) records
what has actually been exercised and what remains unqualified.

For recipe and integration work, start with the
[agent research package](docs/recipe-integrations/README.md): agreed experience,
public competitor catalogs, source revisions, reuse constraints and acceptance
patterns.

## Run locally

**Self-host / ops (Release-1):** see [docs/self-host.md](docs/self-host.md) and R2 checklists under [docs/ops/](docs/ops/README.md) for
Alchemy `local`/`dev`/`staging`, install/migrate/run, `.env.local` **names**,
Telegram/Google/Kapso pointers, Graphile fencing / SIGKILL, quotas ADR, account
delete limits, and live qualification gaps.

Use Node.js 24 and pnpm 11.24.0. PostgreSQL stores application records and the
compatible Workflow world. Start with:

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
chmod 600 .env.local
```

For a local PostgreSQL instance, use the [Alchemy and Effect stack](infrastructure/README.md).
It creates a named data volume and exposes PostgreSQL only on loopback.

Configure your PostgreSQL URLs, public application URL, and independent random
Better Auth and encryption secrets in `.env.local`. Follow the exact setup in
[local runtime setup](docs/local-runtime-setup.md#build-and-run-locally), including
both database migrations:

```sh
pnpm db:migrate
pnpm workflow:migrate
pnpm build
pnpm start --port 3000
```

The launcher runs Next and Eve together and stops the sibling if either exits.
Eve stays on loopback. Expose Next through your own TLS proxy when required;
internal Workflow callbacks need a separately qualified authentication boundary.

For the locally exercised model, set `COMPANION_MODEL_PROVIDER=codex-local` and
use an existing authenticated Codex installation. Eve's native provider selects
`gpt-5.3-codex-spark` with low reasoning. The default `gateway` profile uses AI
Gateway credentials. An explicit model profile does not silently fall back to a
different provider. Browser execution, Google connections and messaging delivery
require their own credentials and separate qualification.

Telegram/Kapso sign-in uses a browser-bound challenge confirmed in the user's
private provider conversation. Configure the corresponding bot/number and
webhook credentials before using that flow. Do not redirect an existing webhook
to an unqualified installation.

## Current evidence

Authenticated native Spark turns have saved a PostgreSQL profile note and
recalled it in a new session after a full service restart. The corrected scenario
produced one response per turn. The dedicated PostgreSQL profile exercises
account linking, inbox/outbox leases, identity revocation, memory conflicts and
cancellation. Unit regression, real storage tests and external-provider evidence
are reported separately.

Scheduled execution, interrupted-step recovery, native approvals, media and real
Telegram/Kapso end-to-end delivery are still being qualified. A crash after Eve
acceptance but before the application receipt can leave an entry uncertain; such
entries are not automatically resent. See the blueprint before treating any
package as complete.

## Validation

```sh
pnpm check
pnpm db:check
pnpm test:runtime
pnpm build
```

The runtime test profile requires a dedicated database named
`companion_runtime_test` and its own ignored `.env.runtime.local`; see the setup
instructions before running it. The inherited unit suite includes mocks and is
regression evidence only. Passing it does not establish provider delivery,
restart recovery or production readiness.

## Origin and license

Based on [Merit Systems' OpenInstinct](https://github.com/Merit-Systems/OpenInstinct).
Upstream license and attribution remain in [LICENSE](LICENSE) and
[third-party notices](THIRD_PARTY_NOTICES.md).
