# Companion PostgreSQL with Alchemy and Effect

This stack provisions PostgreSQL 17 for documented application stages
(`local`, `dev`, `staging`, and `prod`). It uses `alchemy@2.0.0-beta.76`, Effect
`4.0.0-rc.112`, and the active Docker CLI context. Select a local Docker
context before deploying. It creates three Alchemy resources: a cached image
reference, a named volume, and a running container with a healthcheck. The
published port is chosen by Docker and binds to `127.0.0.1`.

Stage policy lives in an Effect layer (`companion-stage.ts` →
`CompanionStagePolicy`): database name, env-file hint, tier
(`ephemeral` / `shared-preprod` / `production`), and whether destroy retains the
Postgres data volume (`prod` only). Staging and prod share the same resource
graph; they differ by that policy layer, not by a second stack program.

## Stage isolation

Alchemy stages are isolated instances of the same stack program:

| Stage     | Database name           | Tier           | Destroy retains volume |
| --------- | ----------------------- | -------------- | ---------------------- |
| `local`   | `open_instinct_local`   | ephemeral      | no                     |
| `dev`     | `open_instinct_dev`     | ephemeral      | no                     |
| `staging` | `open_instinct_staging` | shared-preprod | no                     |
| `prod`    | `open_instinct_prod`    | production     | **yes**                |

- Each `--stage` gets its own state under `infrastructure/.alchemy`.
- Docker **physical names** for the container and volume include the stage, so
  stages never share Docker resources.
- Destroying one stage does not touch another stage's container or volume.
- `POSTGRES_DB` is `open_instinct_<stage>` (hyphens become underscores).

Always pass an explicit `--stage`. Do not run two deploys of the same stage
concurrently. Do not adopt unrelated containers or volumes.

## Deploy

From the repository root, with Node 24 and Docker running:

```sh
pnpm install --frozen-lockfile
pnpm --dir infrastructure install --frozen-lockfile
cp infrastructure/.env.example infrastructure/.env
chmod 600 infrastructure/.env
```

Set `COMPANION_POSTGRES_PASSWORD` in `infrastructure/.env` before deployment
(name only in docs — never commit or print real values). The example password is
only for a disposable local database. The deployment prints stage metadata,
database, container, volume, and selected port **without** printing the password.

Plan / deploy / destroy per stage:

```sh
# local
pnpm --dir infrastructure plan --stage local
pnpm --dir infrastructure run deploy --stage local --yes
# or from root: pnpm infra:deploy:local

# dev
pnpm --dir infrastructure plan --stage dev
pnpm --dir infrastructure run deploy --stage dev --yes
# or from root: pnpm infra:deploy:dev

# staging
pnpm --dir infrastructure plan --stage staging
pnpm --dir infrastructure run deploy --stage staging --yes
# or from root: pnpm infra:deploy:staging

# prod (same Docker program; retain-on-destroy for the data volume)
pnpm --dir infrastructure plan --stage prod
pnpm --dir infrastructure run deploy --stage prod --yes
# or from root: pnpm infra:deploy:prod
```

Confirm readiness with
`docker inspect <container> --format '{{.State.Health.Status}}'`; wait for
`healthy` before migrating. Deployment completion alone does not wait for the
healthcheck.

## Promote local → dev → staging → prod

Stages are **isolated**. Promoting does **not** copy Docker volumes or row data
between stages. Promotion means: deploy the target stage, point an env file at
its `DATABASE_URL`, run migrations, build+start paired Next+Eve, then (for
public channels) durable ingress + the D01 webhook script.

Recommended forward path:

1. **`local`** — day-to-day operator loop. Env file hint: `.env.local`.
2. **`dev`** — separate disposable stack when you need isolation from local.
   Env file hint: `.env.dev`.
3. **`staging`** — shared pre-prod on the same host/Docker. Env file hint:
   `.env.staging`. Validate migrations, `pnpm start` pairing, and
   `pnpm ingress:set-webhooks -- --dry-run` here before touching prod webhooks.
4. **`prod`** — production tier. Env file hint: `.env.prod`. Destroy retains the
   Postgres volume so a mistaken `destroy --stage prod` does not wipe data
   (Alchemy forgets tracking; the volume remains — re-adopt carefully).

Per-stage cutover checklist (env **names** only; no secret values):

```sh
# 1) Deploy Alchemy Postgres for the target stage (example: staging)
pnpm infra:deploy:staging

# 2) Wire DATABASE_URL / DATABASE_URL_UNPOOLED in the stage env file
#    (.env.staging / .env.prod / …) using the returned loopback port + database.

# 3) Migrate app + workflow against that database
pnpm db:migrate
pnpm workflow:migrate

# 4) Pair Next + Eve on matching ports (rewrite port baked at build)
EVE_NEXT_PRODUCTION_PORT=4274 pnpm build
pnpm start --port 3000 --eve-port 4274

# 5) For standing Telegram/Kapso: named tunnel (D01) then webhook script
pnpm ingress:set-webhooks -- --dry-run
# apply only after durable HTTPS is stable for COMPANION_PUBLIC_BASE_URL
# pnpm ingress:set-webhooks
```

Do **not** redirect production Telegram/Kapso webhooks from staging validation
until prod ingress and ownership binding for _this_ install are understood.
See [`ingress/README.md`](ingress/README.md) (D01 durable ingress +
`scripts/set-channel-webhooks.sh`).

## Wire DATABASE_URL

Use the returned `5432/tcp` port and the stage database name. Examples only —
replace `<url-encoded-password>` and `<port>` with your values; do not commit
real secrets.

`.env.local` (stage `local`, database `open_instinct_local`):

```dotenv
DATABASE_URL=postgresql://postgres:<url-encoded-password>@127.0.0.1:<port>/open_instinct_local
DATABASE_URL_UNPOOLED=postgresql://postgres:<url-encoded-password>@127.0.0.1:<port>/open_instinct_local
```

`.env.dev` (stage `dev`, database `open_instinct_dev`):

```dotenv
DATABASE_URL=postgresql://postgres:<url-encoded-password>@127.0.0.1:<port>/open_instinct_dev
DATABASE_URL_UNPOOLED=postgresql://postgres:<url-encoded-password>@127.0.0.1:<port>/open_instinct_dev
```

`.env.staging` (stage `staging`, database `open_instinct_staging`):

```dotenv
DATABASE_URL=postgresql://postgres:<url-encoded-password>@127.0.0.1:<port>/open_instinct_staging
DATABASE_URL_UNPOOLED=postgresql://postgres:<url-encoded-password>@127.0.0.1:<port>/open_instinct_staging
```

`.env.prod` (stage `prod`, database `open_instinct_prod`):

```dotenv
DATABASE_URL=postgresql://postgres:<url-encoded-password>@127.0.0.1:<port>/open_instinct_prod
DATABASE_URL_UNPOOLED=postgresql://postgres:<url-encoded-password>@127.0.0.1:<port>/open_instinct_prod
```

Continue with `pnpm db:migrate`, `pnpm workflow:migrate`, `pnpm build`, and
`pnpm start` from the root [runtime setup](../docs/local-runtime-setup.md)
(pointing the launcher at the matching env file). The separate
benchmark/development supervisors still own their existing Compose databases.

## Always-on Next + Eve ports

Channel routes rewrite Next → Eve at **build** time. Keep ports paired:

| Process | Default loopback | How to change                                                   |
| ------- | ---------------- | --------------------------------------------------------------- |
| Eve     | `4274`           | `EVE_NEXT_PRODUCTION_PORT` at **build** + `--eve-port` at start |
| Next    | `3000`           | `pnpm start --port <n>`                                         |

```sh
EVE_NEXT_PRODUCTION_PORT=4274 pnpm build
pnpm start --port 3000 --eve-port 4274
```

`scripts/start.ts` rejects Eve port mismatches against
`.next/routes-manifest.json`. For Mac reboot survival, install the LaunchAgent
examples under [`ingress/`](ingress/README.md) (`companion-runtime` +
`companion-cloudflared`). Full pairing notes and the D01 webhook setter:
[`ingress/README.md`](ingress/README.md).

## State and destroy

Alchemy stores ownership and resource state in the ignored
`infrastructure/.alchemy` directory, including the serialized database password.
The package commands set a restrictive umask and create/protect this directory
with mode `0700` before invoking Alchemy. Use these package commands for local
state operations. Keep the directory while the resources exist, and use the
same stage for later commands. A container replacement retains the unchanged
volume but can change the published port; update the application URLs when that
happens.

To remove a non-prod stage, including its database contents:

```sh
pnpm --dir infrastructure destroy --stage local --yes
pnpm --dir infrastructure destroy --stage dev --yes
pnpm --dir infrastructure destroy --stage staging --yes
```

For `prod`, destroy drops Alchemy tracking but **retains** the Docker data
volume (`RemovalPolicy.retain`). Do not treat that as a wipe. Re-adopting or
manually removing a retained volume is an operator action outside the default
destroy path.

The image cache is retained by Alchemy's Docker provider. Destroy removes the
owned container (and, except for prod, the data volume) for that stage only. It
does not reverse application migrations in another database or another stage.

## Compatibility and evidence

The infrastructure package has its own lockfile and workspace boundary. Alchemy's
optional Drizzle peers differ from the application's versions. Its optional
Cap'n Proto compiler also declares an older TypeScript peer. Neither integration
is installed here. `types:check` uses the root's sole TS7 compiler; this package
does not install another compiler or override peer ranges.

The installed Docker API requires `{}` for the volume properties in this stack.
Its healthcheck command is a shell string; copying `CMD-SHELL` from a Compose
array into that string causes an unhealthy container. The initial failing plan
and healthcheck were retained during validation and corrected using the published
API, without patching Alchemy.

Local validation exercised a healthy loopback-only container, an actual PostgreSQL
write, container replacement preserving the row and volume, an unchanged redeploy,
and removal of the owned container and volume. A fresh final stack accepted both
application and Workflow migrations. These are local infrastructure checks, not
cloud deployment, backup, concurrent-deployment, or production qualification.

Sources: [Docker provider](https://alchemy.run/docker/),
[stages](https://alchemy.run/environments/stages),
[published package manifest](https://github.com/alchemy-run/alchemy/blob/v2.0.0-beta.76/packages/alchemy/package.json).

## Durable public HTTPS (Telegram / Kapso)

Alchemy here provisions Postgres only. For always-on public HTTPS to
`/api/channels/telegram` and `/api/channels/kapso`, use the named Cloudflare
Tunnel + LaunchAgent recipe under [`ingress/`](ingress/README.md) (D01). Prefer
that path over ephemeral `trycloudflare` tunnels. Webhook URL updates:
`pnpm ingress:set-webhooks` → `scripts/set-channel-webhooks.sh` (env names only;
never prints secrets).
