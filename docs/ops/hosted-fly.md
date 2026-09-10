# Hosted Fly cutover (H01) — Mac → always-on off-Mac

Operator recipe so Companion can leave **Mac-only** hosting for consumer /
prosumer installs, while keeping the **Mac LaunchAgent** path as an optional
local / prosumer mode.

| Layer              | Choice                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Compute            | **Fly Machines** (`fly.toml` + root `Dockerfile`) running `pnpm start`                                                                                                         |
| Postgres           | **Alchemy unmanaged** — Docker (`alchemy.run.ts`) **or** Fly.Machine+volume (`alchemy.fly-postgres.run.ts`) + stage policy — **not** Fly Managed Postgres / `Fly.Postgres` MPG |
| Public HTTPS / DNS | **Cloudflare** named tunnel for `companion.tironi.xyz` (TG + Kapso)                                                                                                            |
| Local optional     | Mac LaunchAgent + Alchemy on Docker Desktop (`scripts/launch-companion-prod.sh`)                                                                                               |

Never commit secrets, print secret values, force-push `main`, destroy Mac prod
blindly, or rotate F01 from this recipe.

## Why not Fly Managed Postgres?

Release-2 ops keep **Alchemy** as the Postgres provisioner so stage names,
database names (`open_instinct_<stage>`), env-file hints, and prod volume
retain-on-destroy stay consistent with
[`infrastructure/companion-stage.ts`](../../infrastructure/companion-stage.ts).
Alchemy's `Fly.Postgres` resource is **Managed Postgres (MPG)** and is
**out of scope** here.

## Architecture (ponytail)

```
Telegram / Kapso
       │
       ▼
Cloudflare named tunnel  →  companion.tironi.xyz
       │
       ▼
Fly Machine (this repo Dockerfile)
  Next :3000 (0.0.0.0)  ──rewrite──►  Eve :4274 (127.0.0.1)
       │
       ▼
DATABASE_URL ──► Alchemy unmanaged Postgres
                 (Docker A/B on host, or Fly.Machine+volume option C)
```

- Channel webhooks still hit Next `/api/channels/{telegram,kapso}` and rewrite
  to Eve. **Next without Eve on the baked rewrite port fails webhooks.**
- Prefer `pnpm start` (already the image `CMD`). Do not run Next alone.
- Zoen product DNS `app.zoen.space` stays on the existing Fly product app —
  **do not** point it at Companion.

## Alchemy Docker Postgres — reachable from Fly

Use the **same** Alchemy stack and stages as Mac
(`local` → `dev` → `staging` → `prod`). Deploy Postgres with:

```sh
pnpm --dir infrastructure plan --stage prod
pnpm infra:deploy:prod
```

Fly Machines cannot talk to Mac `127.0.0.1`. Pick **one** topology:

### A) Preferred for first cutover — Docker host + Fly WireGuard

1. Keep Alchemy Docker Postgres on an always-on Docker host (Mac is fine for
   prosumer; for true off-Mac DB, use a small always-on Linux Docker host in
   the same metro as `primary_region`).
2. Install a [Fly WireGuard peer](https://fly.io/docs/networking/private-networking/)
   on that host (or use `fly proxy` / `fly mpg proxy` is **not** used — we are
   not on MPG).
3. From the peer, reach Alchemy's published loopback port (Alchemy binds
   `127.0.0.1:<ephemeral>→5432`). Set Fly secrets `DATABASE_URL` /
   `DATABASE_URL_UNPOOLED` to the stage database name
   (`open_instinct_prod`, …) using that reachable host/port.
4. Confirm `pg_isready` / migrate from a one-off Fly machine or WireGuard
   laptop before pointing webhooks at Fly compute.

### B) Colocated Docker host in the Fly region

Same Alchemy program; Docker context is a VPS/host near `gru` (or your
`primary_region`). Publish Postgres only on a private interface / WireGuard /
Tailscale — not the public Internet. Wire `DATABASE_URL*` the same way.

### C) Preferred for true off-Mac — Alchemy `Fly.Machine` + volume

Alchemy-managed **unmanaged** Postgres on the Fly private network:

| Piece          | Choice                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Stack entry    | [`infrastructure/alchemy.fly-postgres.run.ts`](../../infrastructure/alchemy.fly-postgres.run.ts)                                     |
| Resources      | `Fly.App` + `Fly.Secret(POSTGRES_PASSWORD)` + `Fly.Machine` (`postgres:17-alpine`) + volume mount at `/data` (`PGDATA=/data/pgdata`) |
| Database names | Same `CompanionStagePolicy` as Docker (`open_instinct_<stage>`)                                                                      |
| Network        | **No** public proxy services — reachable only via 6PN / `.internal`                                                                  |
| Explicitly not | Fly Managed Postgres / `fly mpg` / Alchemy `Fly.Postgres` MPG                                                                        |

Operator commands (secrets never printed):

```sh
# One-time: infrastructure/.env has COMPANION_POSTGRES_PASSWORD (name only in docs).
# Auth: FLY_API_TOKEN or `alchemy login` / `fly auth`.
# Optional overrides: COMPANION_FLY_PG_REGION=gru (default), COMPANION_FLY_PG_VOLUME_GB=10,
# COMPANION_FLY_PG_APP_NAME=companion-pg-prod (default companion-pg-<stage>).

pnpm --dir infrastructure install --frozen-lockfile
./scripts/fly-alchemy-pg.sh plan --stage prod
./scripts/fly-alchemy-pg.sh deploy --stage prod
# or: pnpm infra:fly-pg:deploy:prod

./scripts/fly-alchemy-pg.sh status --stage prod
./scripts/fly-alchemy-pg.sh url-shape --stage prod
# → DATABASE_URL shape:
# postgresql://postgres:<url-encoded-password>@companion-pg-prod.internal:5432/open_instinct_prod?sslmode=disable

# After companion-tironi Machines exist (same Fly org):
./scripts/fly-alchemy-pg.sh verify --stage prod
```

Wire compute secrets (values from your store — do not paste into git/PRs):

```sh
# Shape only — replace password locally; host/db from url-shape:
# fly secrets set -a companion-tironi \
#   DATABASE_URL='postgresql://postgres:<url-encoded-password>@companion-pg-prod.internal:5432/open_instinct_prod?sslmode=disable' \
#   DATABASE_URL_UNPOOLED='postgresql://postgres:<url-encoded-password>@companion-pg-prod.internal:5432/open_instinct_prod?sslmode=disable'
./scripts/fly-companion.sh secrets-check
```

Migrate from a host that can reach the PG app (WireGuard peer, or `fly ssh`
on compute after secrets are set):

```sh
pnpm db:migrate
pnpm workflow:migrate
```

**A/B remain valid** for prosumer / Mac-local Docker. Use C when Fly compute
must not depend on Mac `127.0.0.1` and you want Alchemy stage naming without MPG.

Honest limits: this is a single-node unmanaged Postgres Machine (you operate
restarts/disk). Alchemy `RemovalPolicy.retain` applies on destroy for `prod`
the same policy idea as Docker volumes — still treat destroy as dangerous.
Scheduled Fly volume snapshots default on for the mount.

## Fly app recipe (compute)

Repo files:

| File                                                                                             | Role                                                                                     |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| [`fly.toml`](../../fly.toml)                                                                     | Always-on HTTP service on port 3000, region `gru`                                        |
| [`Dockerfile`](../../Dockerfile)                                                                 | Multi-stage Node 24; Eve+Next build; runtime `--hostname ::` (Fly IPv6 health)           |
| [`scripts/fly-companion.sh`](../../scripts/fly-companion.sh)                                     | `validate` / `status` / `deploy-dry` / `secrets-check`                                   |
| [`scripts/fly-alchemy-pg.sh`](../../scripts/fly-alchemy-pg.sh)                                   | Option C: Alchemy Fly unmanaged PG `plan` / `deploy` / `status` / `url-shape` / `verify` |
| [`infrastructure/alchemy.fly-postgres.run.ts`](../../infrastructure/alchemy.fly-postgres.run.ts) | Alchemy stack: Fly.App + Machine + volume (not MPG)                                      |

### One-time app create (operator)

```sh
# Choose a free app name; fly.toml currently uses companion-tironi
fly apps create companion-tironi --org personal
# Optional: edit fly.toml primary_region / app name to match
./scripts/fly-companion.sh validate
```

### Secrets (names only — set values locally; never paste into git/PRs)

Minimum for a standing Companion (see [self-host](../self-host.md) for the full
table):

| Secret name                                      | Notes                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                   | Alchemy stage DB — for option C use `<pg-app>.internal` (see `url-shape`); not Mac loopback |
| `DATABASE_URL_UNPOOLED`                          | Same DB; migrate-friendly                                                                   |
| `BETTER_AUTH_SECRET`                             | ≥32 chars                                                                                   |
| `BETTER_AUTH_URL`                                | `https://companion.tironi.xyz` (keep hostname through cutover)                              |
| `COMPANION_PUBLIC_BASE_URL`                      | Same public origin                                                                          |
| `SECRET_ENCRYPTION_KEY`                          | base64 32-byte; **do not rotate casually** (F01)                                            |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` | Existing bot                                                                                |
| `KAPSO_*`                                        | Existing Kapso phone / webhook secrets                                                      |
| `WORKFLOW_LOCAL_BASE_URL`                        | `http://127.0.0.1:4274` (Eve stays loopback in the Machine)                                 |
| Model / Blob / Google / Kernel                   | As required by the install profile                                                          |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`    | Optional hosted billing ([consumer-billing](../consumer-billing.md))                        |
| `STRIPE_PRICE_PRO` / `STRIPE_PRICE_ORG_SEAT`     | Stripe Price ids for Pro / Org seat                                                         |

```sh
# Example shape only — values come from your secret store, not this doc:
# fly secrets set DATABASE_URL='…' DATABASE_URL_UNPOOLED='…' …
./scripts/fly-companion.sh secrets-check   # lists names only
```

### Migrate, then deploy (still reversible)

```sh
# Against the Alchemy stage URL (from a host that can reach Postgres):
pnpm db:migrate
pnpm workflow:migrate

./scripts/fly-companion.sh validate
./scripts/fly-companion.sh deploy-dry   # build only; does not cut traffic

# When ready for a reversible compute flip (Mac LaunchAgents still installed):
# fly deploy -c fly.toml
```

Prefer **`deploy-dry` + PR** before the first live `fly deploy`. Keep Mac
`launch-companion-prod` / cloudflared LaunchAgents loaded until ingress is
retargeted and health-checked.

## Cutover Mac → Fly (keep `companion.tironi.xyz`)

Goal: **same** public hostname so Telegram + Kapso webhooks do not need a URL
change if the tunnel origin alone moves.

1. **Prep** — Alchemy unmanaged `prod` PG healthy (option C `deploy` + `verify`, or A/B reachable); Fly secrets set;
   `./scripts/fly-companion.sh validate` OK; optional `deploy-dry` OK.
2. **Deploy compute** — `fly deploy` once; confirm `https://<app>.fly.dev`
   returns the app (unsigned channel POST → **401**, not 502).
3. **Retarget Cloudflare tunnel origin** — in Zero Trust / tunnel config, point
   `companion.tironi.xyz` at the Fly Machine instead of Mac
   `http://127.0.0.1:3000`. Options:
   - Tunnel origin → `http://<fly-private-ipv6>:3000` / Flycast, or
   - Origin → public `https://<app>.fly.dev` (extra hop; fine for first cut), or
   - Run `cloudflared` **inside** the Fly Machine (heavier; not required for H01).
4. **Verify hostname** — `https://companion.tironi.xyz` → Next; unsigned
   `/api/channels/telegram` POST → **401**.
5. **Webhooks** — if `COMPANION_PUBLIC_BASE_URL` unchanged, providers can stay.
   Still dry-run: `pnpm ingress:set-webhooks -- --dry-run`. Apply only if the
   public origin or paths changed.
6. **Drain Mac compute** — after soak, unload Mac runtime LaunchAgent
   (`companion-runtime`). Keep `companion-cloudflared` only if the tunnel still
   terminates on the Mac; if the tunnel moved fully to Fly/CF dashboard routing,
   unload cloudflared too.
7. **Rollback** — retarget tunnel origin back to Mac `127.0.0.1:3000`, ensure
   Mac LaunchAgents + Alchemy PG are healthy. Do **not** destroy Alchemy
   `prod` volume.

## Mac path (optional prosumer / local)

Unchanged:

- Alchemy stages + [`infrastructure/README.md`](../../infrastructure/README.md)
- LaunchAgents under [`infrastructure/ingress/`](../../infrastructure/ingress/README.md)
- [`scripts/launch-companion-prod.sh`](../../scripts/launch-companion-prod.sh)

Use Mac when you want always-on on a trusted desktop; use Fly when the Mac
must sleep or leave the critical path.

## Validation helpers

```sh
./scripts/fly-companion.sh validate
./scripts/fly-companion.sh status          # after app exists
./scripts/fly-companion.sh secrets-check   # names only
./scripts/fly-companion.sh deploy-dry      # remote build only

# Option C Postgres (unmanaged Alchemy Fly.Machine — not MPG):
./scripts/fly-alchemy-pg.sh status --stage prod
./scripts/fly-alchemy-pg.sh url-shape --stage prod
./scripts/fly-alchemy-pg.sh verify --stage prod
```

## Remote build memory (Depot OOM)

`deploy-dry` / `fly deploy` build on Fly **Depot** by default. Companion’s
`eve build` + `next build` peak RSS can OOM the default builder (**exit 137**)
during the Next/TypeScript phase.

Mitigations already in-repo:

- [`Dockerfile`](../../Dockerfile) sets `NODE_OPTIONS=--max-old-space-size=2048`,
  `OPEN_INSTINCT_LOW_MEM_BUILD=1`, and runs Eve then Next in **separate** `RUN`
  layers (avoids turbo + stacked peaks).
- Low-mem Next flags (Docker-only): `experimental.cpus=1`,
  `webpackMemoryOptimizations`, skip TS in `next build` (CI still typechecks).

`scripts/fly-companion.sh deploy-dry` defaults to **classic** remote builders
(`--depot=false`, typically ~8GB). Depot still OOMs on the default org builder
for this image; resize at
[Fly dashboard → App Builders](https://fly.io/dashboard/personal/builders)
before `COMPANION_FLY_DEPOT=true`.

## Related

- [Self-host / ops](../self-host.md)
- [Durable ingress](../../infrastructure/ingress/README.md)
- [Alchemy Postgres](../../infrastructure/README.md)
- [Credential rotation F01](credential-rotation.md)
- [Enzo live blockers](enzo-live-actions.md)
