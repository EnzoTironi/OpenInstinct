# Companion Release-1 self-host / ops

Operator recipe for running Companion (this OpenInstinct fork) on your own host.
End users on the hosted product should follow [consumer first-run](consumer-first-run.md), not this page.
This is an **implementation-in-progress** install path, not a finished release or
admitted user pilot. For deeper evidence and limits, see
[local runtime setup](local-runtime-setup.md). Product contracts live in the
[blueprint](companion-blueprint.md).

**Requirements:** Node.js 24, pnpm `11.24.0`, Docker (for Alchemy Postgres), and
a local Docker context selected before deploy.

Do **not** commit `.env*`, paste secrets into docs/PRs/logs, or redirect an
existing Telegram/Kapso webhook to an unqualified installation.

## 1. Alchemy Postgres (`local` → `dev` → `staging` → `prod`)

Preferred Postgres for documented stages is the Alchemy + Effect stack under
[`infrastructure/`](../infrastructure/README.md). Stages are isolated; staging and
prod share one composition with an Effect stage-policy layer (prod retains the
data volume on destroy):

| Stage     | Database name           | Tier           | Notes                                      |
| --------- | ----------------------- | -------------- | ------------------------------------------ |
| `local`   | `open_instinct_local`   | ephemeral      | Day-to-day operator / developer            |
| `dev`     | `open_instinct_dev`     | ephemeral      | Separate stack; does not share Docker vols |
| `staging` | `open_instinct_staging` | shared-preprod | Pre-prod validation on local Docker        |
| `prod`    | `open_instinct_prod`    | production     | Retain-on-destroy for the data volume      |

Each `--stage` gets its own Alchemy state under `infrastructure/.alchemy`, and
Docker container/volume **physical names** include the stage. Destroying one
stage does not touch another. Always pass an explicit `--stage`. Do not run two
deploys of the same stage concurrently. **Promotion does not copy volumes** —
redeploy + migrate on the target stage (see infra README promotion section).

```sh
pnpm install --frozen-lockfile
pnpm --dir infrastructure install --frozen-lockfile
cp infrastructure/.env.example infrastructure/.env
chmod 600 infrastructure/.env
# Set COMPANION_POSTGRES_PASSWORD in infrastructure/.env (name only here).
```

Plan / deploy / destroy:

```sh
pnpm --dir infrastructure plan --stage local
pnpm --dir infrastructure run deploy --stage local --yes
# Root shortcuts: infra:deploy:local | :dev | :staging | :prod

pnpm --dir infrastructure destroy --stage local --yes
# prod destroy retains the Docker volume; see infrastructure/README.md
```

Confirm readiness with
`docker inspect <container> --format '{{.State.Health.Status}}'` and wait for
`healthy` before migrating. Deployment completion alone does not wait for the
healthcheck. The published port binds to `127.0.0.1` and is chosen by Docker;
update application URLs if a container replacement changes the port.

Legacy `compose.yaml` remains available for disposable Compose databases
(benchmarks / older loops). Prefer Alchemy stages for Release-1/R2 ops.

## 2. Install, migrate, run

```sh
cp .env.example .env.local
chmod 600 .env.local
# Fill DATABASE_URL / DATABASE_URL_UNPOOLED for the Alchemy stage (see infra README).
# Generate independent BETTER_AUTH_SECRET and SECRET_ENCRYPTION_KEY locally.

pnpm db:migrate
pnpm workflow:migrate
pnpm build
pnpm start --port 3000
```

`pnpm build` builds Eve and Next. `pnpm start` launches both in one Effect
scope: Eve on loopback `4274`, Next default loopback `3000`. Use
`--hostname 0.0.0.0` only behind your own TLS proxy. The launcher waits for Eve
HTTP health before starting Next, fails if either child exits, and stops the
sibling. To change Eve's port, set `EVE_NEXT_PRODUCTION_PORT` at **build** and
the same value at start (`--eve-port`); mismatches against the compiled route
manifest are rejected.

### Always-on Next + Eve pairing

Channel webhooks are rewritten from Next to Eve at build time
(`/api/channels/telegram|kapso` → Eve `/channels/...`). **Next without Eve on
the baked rewrite port cannot serve Telegram or Kapso.** Prefer `pnpm start`,
which launches both in one Effect scope, waits for Eve health, and stops the
sibling if either exits.

Default paired ports: Next `3000`, Eve `4274`. Keep them matched across build
and start:

```sh
EVE_NEXT_PRODUCTION_PORT=4274 pnpm build
pnpm start --port 3000 --eve-port 4274
```

For a Mac that must survive logout/reboot:

1. Keep Eve's listen port identical to `EVE_NEXT_PRODUCTION_PORT` used at
   **build** (default `4274`; `scripts/start.ts` rejects mismatches).
2. Install the KeepAlive LaunchAgent examples under
   [`infrastructure/ingress/`](../infrastructure/ingress/README.md)
   (`companion-runtime` → `pnpm start`, `companion-cloudflared` → named tunnel).
3. Put `pnpm`, Node 24, and (for `codex-local`) the `codex` CLI on the agent's
   `PATH`, and set `HOME`. Ephemeral `*.trycloudflare.com` URLs are not durable
   ingress — R1 left webhooks on dead quick tunnels.
4. After durable HTTPS is up, set provider webhooks with the D01 script
   (`pnpm ingress:set-webhooks`, env names only — never prints secrets). Dry-run
   first: `pnpm ingress:set-webhooks -- --dry-run`.

Workflow state defaults to `DATABASE_URL` unless `WORKFLOW_POSTGRES_URL` is set.
Run `pnpm workflow:migrate` against that database before workers start.

Validation (does **not** prove live provider delivery):

```sh
pnpm check
pnpm db:check
pnpm test:runtime   # needs companion_runtime_test + ignored .env.runtime.local
pnpm build
```

## 3. `.env.local` variable **names** (no values)

Copy from [`.env.example`](../.env.example). Documented names only — never put
real secrets in this file or in commits.

| Name                                   | Role                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                   | Auth signing secret                                                          |
| `BETTER_AUTH_URL`                      | Public application origin                                                    |
| `COMPANION_PUBLIC_BASE_URL`            | Public HTTPS origin (webhooks; interim live: `https://companion.tironi.xyz`) |
| `DATABASE_URL`                         | App Postgres URL                                                             |
| `DATABASE_URL_UNPOOLED`                | Unpooled / migrate-friendly Postgres URL                                     |
| `WORKFLOW_POSTGRES_URL`                | Optional Eve Workflow DB (else `DATABASE_URL`)                               |
| `WORKFLOW_LOCAL_BASE_URL`              | Internal Eve origin for Workflow callbacks                                   |
| `WORKFLOW_POSTGRES_MAX_POOL_SIZE`      | Workflow pool size                                                           |
| `WORKFLOW_POSTGRES_WORKER_CONCURRENCY` | Workflow worker concurrency                                                  |
| `SECRET_ENCRYPTION_KEY`                | Installation encryption (base64 32-byte)                                     |
| `KERNEL_API_KEY`                       | Optional; required when browser execution runs                               |
| `AI_GATEWAY_API_KEY`                   | Gateway model profile outside Vercel                                         |
| `COMPANION_MODEL_PROVIDER`             | `gateway` \| `codex-local` \| `openrouter-free`                              |
| `OPENROUTER_API_KEY`                   | OpenRouter profile                                                           |
| `TELEGRAM_BOT_ID`                      | Telegram bot identity                                                        |
| `TELEGRAM_BOT_USERNAME`                | Telegram bot username                                                        |
| `TELEGRAM_BOT_TOKEN`                   | Telegram Bot API token                                                       |
| `TELEGRAM_WEBHOOK_SECRET`              | Telegram webhook verification                                                |
| `KAPSO_PHONE_NUMBER_ID`                | Kapso / WhatsApp phone number id                                             |
| `KAPSO_PHONE_NUMBER`                   | Kapso / WhatsApp E.164 number                                                |
| `KAPSO_API_KEY`                        | Kapso API key                                                                |
| `KAPSO_WEBHOOK_SECRET`                 | Kapso webhook HMAC secret                                                    |
| `BLOB_STORE_ID`                        | Optional Blob store id                                                       |
| `BLOB_READ_WRITE_TOKEN`                | Blob token outside Vercel OIDC                                               |
| `GOOGLE_CLIENT_ID`                     | Self-hosted Google OAuth client id                                           |
| `GOOGLE_CLIENT_SECRET`                 | Self-hosted Google OAuth client secret                                       |
| `LINQ_CONNECTOR`                       | Optional Vercel Connect Linq connector                                       |
| `LINQ_PHONE_NUMBER`                    | Optional Linq click-to-message (E.164)                                       |
| `BROWSER_BENCH_LABEL`                  | Dev benchmark label only                                                     |
| `BROWSER_BENCH_REPETITIONS`            | Dev benchmark repetitions only                                               |

Infrastructure-only (under `infrastructure/.env` / `infrastructure/ingress/.env`, not the app file):

| Name                            | Role                                             |
| ------------------------------- | ------------------------------------------------ |
| `COMPANION_POSTGRES_PASSWORD`   | Alchemy Postgres password                        |
| `CLOUDFLARED_TUNNEL_TOKEN_FILE` | Path to named-tunnel token file (mode 600)       |
| `COMPANION_INGRESS_HOSTNAME`    | Optional Cloudflare hostname for this install    |
| `COMPANION_INGRESS_SERVICE`     | Tunnel origin (default `http://127.0.0.1:3000`)  |
| `KAPSO_WEBHOOK_ID`              | Optional Kapso webhook id for PATCH-only updates |

## 4. Channel / IdP setup pointers

### Telegram

1. Create a bot via [@BotFather](https://core.telegram.org/bots#botfather); set
   `TELEGRAM_BOT_ID`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_BOT_TOKEN`, and
   `TELEGRAM_WEBHOOK_SECRET`.
2. Public ingress is rewritten to Eve:
   `/api/channels/telegram` → Eve `/channels/telegram` (see `scripts/start.ts`
   route checks).
3. Sign-in / link uses a **browser-bound challenge** confirmed in the user's
   **private** bot chat. See [accounts README](../server/accounts/README.md)
   and [native onboarding](native-onboarding.md).
4. Bot API reference: [Telegram Bot API](https://core.telegram.org/bots/api).
5. Set the Bot API webhook only after durable HTTPS is up:
   `pnpm ingress:set-webhooks -- --telegram` (uses
   `COMPANION_PUBLIC_BASE_URL` + `TELEGRAM_*`; never prints secrets). See
   [durable ingress](../infrastructure/ingress/README.md).
6. **Do not** point an existing production webhook at this host until ownership
   binding and durable ingress are wired for _this_ install. Credential
   `getMe` / `getWebhookInfo` checks are not e2e delivery evidence
   ([local runtime setup](local-runtime-setup.md#credential-readiness)).

### Google (self-hosted OAuth)

1. Create a Google OAuth **web** client; set `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`.
2. Authorized redirect URI: `{BETTER_AUTH_URL}/api/auth/callback/google`.
3. Enable Gmail, Calendar, and People APIs; configure consent audience for the
   accounts that will connect. Follow Google's
   [web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
   for offline access / verification.
4. Linking starts from Home or a native authorization challenge; Better Auth
   owns callback persistence and refresh. Focused DB check:
   `pnpm test:google-membership` (against `companion_runtime_test`).
5. Details and known SDK limits:
   [Self-hosted Google Workspace](local-runtime-setup.md#self-hosted-google-workspace).

### Kapso (WhatsApp)

1. Set `KAPSO_PHONE_NUMBER_ID`, `KAPSO_PHONE_NUMBER`, `KAPSO_API_KEY`, and
   `KAPSO_WEBHOOK_SECRET`.
2. Public ingress: `/api/channels/kapso` → Eve `/channels/kapso`.
3. Webhooks must verify HMAC-SHA256 over **original request bytes** (not
   re-serialized JSON). Kapso docs:
   [webhook security](https://docs.kapso.ai/docs/platform/webhooks/security),
   [phone numbers](https://docs.kapso.ai/api/platform/v1/phone-numbers/get-phone-number),
   [personal agent](https://docs.kapso.ai/docs/whatsapp/personal-agent).
4. Set / update the Kapso WhatsApp webhook only after durable HTTPS is up:
   `pnpm ingress:set-webhooks -- --kapso` (uses `COMPANION_PUBLIC_BASE_URL` +
   `KAPSO_*`; optional `KAPSO_WEBHOOK_ID` for PATCH-only). See
   [durable ingress](../infrastructure/ingress/README.md).
5. Release-1 adapter path decision:
   [ADR Kapso path R1](decisions/adr-kapso-path-r1.md). Adapter/webhook private
   delivery may proceed; full WhatsApp product activation (templates, messaging
   window, live redirect, login parity) remains follow-up work.
6. R2 Meta gates (Enzo): display-name approval + ≥1 APPROVED **UTILITY**
   template via Kapso — see [O02 checklist](ops/whatsapp-meta-activation.md).

## 5. Always-on hosting modes (Mac vs Fly)

| Mode                                          | When                                   | Postgres                                                                           | Public HTTPS                                               |
| --------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Mac LaunchAgent** (optional prosumer/local) | Desktop stays on; trusted local Docker | Alchemy Docker stages                                                              | Named Cloudflare tunnel → `127.0.0.1:3000`                 |
| **Fly compute** (H01 consumer always-on)      | Mac may sleep; off-Mac critical path   | Alchemy Docker (reachable via WireGuard / colocated Docker host) — **not** Fly MPG | Same `companion.tironi.xyz` tunnel; retarget origin to Fly |

Full Fly cutover (secrets names, validate/deploy-dry, rollback):
→ **[docs/ops/hosted-fly.md](ops/hosted-fly.md)**

## 6. Durable public HTTPS ingress (not trycloudflare)

Preferred stack for Release-1 self-host on Mac:

| Layer        | Choice                                                               |
| ------------ | -------------------------------------------------------------------- |
| Postgres     | **Alchemy** stages (`local` → `dev` → `staging` → `prod`) — in-repo  |
| Public HTTPS | **Cloudflare named tunnel** + KeepAlive LaunchAgent (token **file**) |
| App process  | **`pnpm start`** pairing Next + Eve (see above)                      |
| Webhook URLs | `pnpm ingress:set-webhooks` from env **names** only                  |

Do **not** use ephemeral `cloudflared tunnel --url` / `*.trycloudflare.com` for
standing Telegram or Kapso webhooks. Full recipe, plist examples, and DNS
blocker notes:

→ **[infrastructure/ingress/README.md](../infrastructure/ingress/README.md)**

**Current interim public base (2026-09-10):** `https://companion.tironi.xyz`
(named Cloudflare Tunnel on the EnzoTironi account). Telegram + Kapso standing
webhooks already target that origin via `pnpm ingress:set-webhooks`. Set
`COMPANION_PUBLIC_BASE_URL=https://companion.tironi.xyz` on the Mac runtime.

`app.zoen.space` remains **Fly DNS for the Zoen product site** — do **not**
point it at the Companion tunnel. A zoen.space Companion hostname cutover is
**deferred**. Enzo checklist: [enzo-live-actions.md](ops/enzo-live-actions.md)
(DNS status + `@ZoenOSBot` group mention for live G03).

## 7. Graphile lease fencing / SIGKILL

Native `@workflow/world-postgres` uses renewable worker leases with **generation
fencing** and owner-aware Graphile completion. Expired generations are retired
on the PostgreSQL clock **before** `force_unlock_workers`, so a SIGKILL'd worker
cannot leave jobs locked for the old multi-hour Graphile default, and a stale
SIGSTOP'd owner cannot complete/fail a job held by another worker.

Companion SIGKILL second-reply recovery is recorded as **pass** (2026-09-09) in
[local runtime setup — Graphile worker lease fencing](local-runtime-setup.md#graphile-worker-lease-fencing-2026-09-09):
after lease expiry/restart, fencing unlocked the dead worker **without** manual
`forceUnlockWorkers`, the dispatcher accepted the same input on attempt 2, and
the second model reply was stored. Manual Graphile unlock is **not** part of the
qualified path. Groups remain paused.

Defaults (package): `workerLease: { leaseMs: 30000, heartbeatMs: 10000, reclaimIntervalMs: 5000 }`.

## 8. Quotas (Release-1 admission)

Fail-closed minimum quotas live in `server/operations/quotas.ts`. Over-limit work
must not proceed (`QuotaAdmissionError`). Full decision record and limit table:

→ **[ADR: Release-1 minimum quotas / admission](decisions/adr-quotas-admission-r1.md)**

Summary (operators may raise later; unlimited usage is not claimed):

| Scope        | Resource                     | Limit     |
| ------------ | ---------------------------- | --------- |
| user         | concurrent turns             | 2         |
| user         | daily model tokens           | 500_000   |
| user         | daily tool calls             | 200       |
| user         | daily proactive messages     | 24        |
| user         | storage bytes                | 100 MiB   |
| user         | sandbox active seconds / day | 900       |
| installation | concurrent turns             | 20        |
| installation | daily model tokens           | 5_000_000 |
| installation | active users / day           | 100       |

Media attachment byte caps remain in `server/channels/media/policy.ts`. Usage
meter persistence / dispatch wiring may still be landing; the gate itself is
tested.

## 9. Account export / delete limits

Routes (browser session + canonical membership required; fail closed):

| Route                 | Method | Behavior                                                 |
| --------------------- | ------ | -------------------------------------------------------- |
| `/api/account/export` | GET    | Partial privacy export (stored personal memory)          |
| `/api/account/delete` | POST   | Online personal-memory wipe + browser session invalidate |

**Not full account deletion.** Export and delete cover stored personal memory
only. See [`server/accounts/README.md`](../server/accounts/README.md) and
`server/accounts/privacy.ts`.

Delete **does wipe:** personal-memory surface for the scope; Better Auth
`session` rows for the user.

Delete **does not erase:** conversation history, artifacts, connected accounts,
schedules, unbound memory documents, channel identities, backups, workspace row,
or user row. Restore reconciliation and a deletion ledger remain separate P06
gates. Do **not** claim full account deletion or backup erasure to users.

## 10. Live qualification gaps (honest)

These remain **unqualified** for Release-1 admission even when local installs
build and synthetic tests pass:

| Gap                        | What is missing                                                                                                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Telegram e2e bind**      | Real private-bot journey: first sign-in / link challenge, ownership bind, and durable delivery on a webhook pointed at _this_ install (not credential-only `getMe`)                       |
| **Google IdP interactive** | Live consent, refresh, provider revocation, and native suspend/resume with real Google OAuth credentials (local checks stop at redirect)                                                  |
| **Kapso live number**      | Real WhatsApp number journey: live webhook redirect, private delivery, templates / messaging window / opt-in as product requires ([Kapso ADR follow-ups](decisions/adr-kapso-path-r1.md)) |

Also still separate from this recipe: native approvals UX, voice/files media on
live channels, hosted billing/entitlements, and any claim of production pilot
readiness. Track evidence in [local-runtime-setup.md](local-runtime-setup.md)
and [product direction](product-direction.md).

## 11. R2 ops checklists (O01 / O02)

Remaining R2 operator work toward 100% (Enzo executes secrets / Meta / DNS):

| ID  | Doc                                                      | What                                                               |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------ |
| O01 | [Credential rotation (F01)](ops/credential-rotation.md)  | Env **names**, rotate order, verify — never secret values          |
| O02 | [WhatsApp Meta + Kapso](ops/whatsapp-meta-activation.md) | Display-name approval, ≥1 UTILITY template, D01 webhook script     |
| —   | [Enzo live blockers](ops/enzo-live-actions.md)           | DNS hostname→named tunnel; add `@ZoenOSBot` + mention for live G03 |

Index: [docs/ops/](ops/README.md). ADR:
[adr-o01-o02-ops-r2.md](decisions/adr-o01-o02-ops-r2.md).

## Related

- [Hosted Fly cutover (H01)](ops/hosted-fly.md)
- [Infrastructure / Alchemy README](../infrastructure/README.md)
- [Durable ingress (named tunnel + webhooks)](../infrastructure/ingress/README.md)
- [Local runtime setup & evidence](local-runtime-setup.md)
- [Companion blueprint](companion-blueprint.md)
- [Quotas ADR](decisions/adr-quotas-admission-r1.md)
- [Kapso path ADR](decisions/adr-kapso-path-r1.md)
- [R2 ops checklists (O01/O02)](ops/README.md)
- [Ops ADR O01/O02](decisions/adr-o01-o02-ops-r2.md)
- [G03 groups live e2e ADR](decisions/adr-g03-groups-live-e2e.md)
- [Account controls](../server/accounts/README.md)
- Root [README](../README.md) quickstart
