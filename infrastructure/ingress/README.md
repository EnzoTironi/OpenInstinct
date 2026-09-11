# Durable public HTTPS ingress (Telegram + Kapso)

Operator recipe for **always-on** public HTTPS that terminates on this Mac (or another self-host / **Fly** compute) and forwards to Companion Next, which rewrites:

| Public path              | Eve destination      |
| ------------------------ | -------------------- |
| `/api/channels/telegram` | `/channels/telegram` |
| `/api/channels/kapso`    | `/channels/kapso`    |

Mac LaunchAgent pairing remains the default **prosumer/local** always-on path. For consumer always-on **off-Mac**, use Fly compute + Alchemy Docker Postgres ([hosted-fly.md](../../docs/ops/hosted-fly.md)); keep this tunnel hostname (`companion.tironi.xyz`) so TG+Kapso webhooks do not need a URL change.

Rewrites are generated at build time (`next.config.ts` + `scripts/start.ts` route checks). **Next alone without Eve on the baked rewrite port fails channel webhooks.** Prefer `pnpm start`, which pairs Eve + Next in one Effect scope.

## What already exists in this repo

| Piece | Role |
| --- | --- |
| Alchemy (`../alchemy.run.ts`) | **Preferred** Postgres for `local` → `dev` → `staging` → `prod` |
| Named Cloudflare Tunnel | **Preferred** durable public HTTPS on Mac (not `trycloudflare`) |
| Fly DNS (`app.zoen.space`) | Zoen **product** site DNS only — leave alone; not Companion ingress |
| Interim Companion hostname | `https://companion.tironi.xyz` (live TG+Kapso; zoen cutover deferred) |
| Fly compute (H01) | Optional always-on **off-Mac** Next+Eve (`fly.toml` + Dockerfile); Alchemy Docker PG — [`hosted-fly.md`](../../docs/ops/hosted-fly.md) |

Alchemy in this package provisions Postgres only. Public HTTPS uses a **Cloudflare named tunnel** (token file + KeepAlive LaunchAgent). Do **not** use ephemeral `cloudflared tunnel --url` / `*.trycloudflare.com` for standing webhooks — R1 left Telegram/Kapso pointed at dead quick tunnels.

## Required env **names** (no values here)

App (`.env.local`):

| Name | Role |
| --- | --- |
| `COMPANION_PUBLIC_BASE_URL` | Public HTTPS origin (interim: `https://companion.tironi.xyz`) |
| `BETTER_AUTH_URL` | Should match the same public origin |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram `secret_token` verification |
| `KAPSO_PHONE_NUMBER_ID` | Kapso / Meta phone number id |
| `KAPSO_API_KEY` | Kapso platform API key |
| `KAPSO_WEBHOOK_SECRET` | Kapso HMAC secret (`x-webhook-signature`) |
| `KAPSO_WEBHOOK_ID` | Optional; when set, PATCH this webhook id only |

Ingress helper (`infrastructure/ingress/.env` — local only, chmod `600`):

| Name | Role |
| --- | --- |
| `CLOUDFLARED_TUNNEL_TOKEN_FILE` | Path to named-tunnel token file (mode 600) |
| `COMPANION_INGRESS_SERVICE` | Tunnel origin, default `http://127.0.0.1:3000` |
| `COMPANION_INGRESS_HOSTNAME` | Optional CF hostname for this install |

Never commit tokens, print them in logs/PRs, or embed them inline in plists checked into git. Use the token **file** path in LaunchAgents.

## Always-on Next + Eve pairing

Promote Alchemy stages (`local` → `dev` → `staging` → `prod`) and migrations first; then keep Next+Eve paired on every standing host (see [`../README.md`](../README.md) promotion section).

| Process | Default | Must match |
| --- | --- | --- |
| Eve | `4274` | `EVE_NEXT_PRODUCTION_PORT` at **build** and `--eve-port` at start |
| Next | `3000` | `pnpm start --port` and tunnel origin (`COMPANION_INGRESS_SERVICE`) |

1. Build with the Eve port you will run:  
   `EVE_NEXT_PRODUCTION_PORT=4274 pnpm build` (default `4274`).
2. Start the **paired** launcher: `pnpm start --port 3000 --eve-port 4274`.  
   The launcher waits for Eve HTTP health, fails if either child exits, and stops the sibling. Channel routes require Eve on the rewrite port baked into `.next/routes-manifest.json`.
3. For Mac reboot survival, install the example LaunchAgent  
   `com.openinstinct.companion-runtime.plist.example` (points at `pnpm start`) **and** `com.openinstinct.companion-cloudflared.plist.example`.
4. LaunchAgents must set `HOME` and a `PATH` that includes `pnpm`, Node 24, and (when using `COMPANION_MODEL_PROVIDER=codex-local`) the `codex` CLI (`~/.local/bin`). Missing `codex` on PATH breaks model turns under launchd.
5. Do **not** leave Eve KeepAlive on a port that no longer matches a rebuild, and do **not** front standing webhooks with a throwaway trycloudflare URL.
6. After HTTPS is stable, use the D01 webhook script (`pnpm ingress:set-webhooks` → `scripts/set-channel-webhooks.sh`). Dry-run prints channel + public path + hostname only — never secrets.

## Named tunnel setup (automated as far as credentials allow)

1. Create a Cloudflare named tunnel in Zero Trust (or reuse an existing Companion tunnel). Save the tunnel token to a mode-`600` file named by `CLOUDFLARED_TUNNEL_TOKEN_FILE` — never into git.
2. In the Cloudflare dashboard, route `COMPANION_INGRESS_HOSTNAME` → the tunnel → `http://127.0.0.1:3000` (or set `COMPANION_INGRESS_SERVICE`). Optionally copy `cloudflared.config.example.yml` for credentials-file mode.
3. Install the cloudflared LaunchAgent from the example plist (replace `/Users/REPLACE/...` paths). Load:  
   `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.openinstinct.companion-cloudflared.plist`
4. Confirm public HTTPS reaches Next (unsigned webhook POSTs should **401**, not hang or 525). Then set provider webhooks (next section).

### DNS / tunnel status (Enzo)

**Interim live hostname (2026-09-10):** `companion.tironi.xyz` on the EnzoTironi Cloudflare account (named tunnel `openinstinct-companion`, LaunchAgent `com.openinstinct.companion-cloudflared`). Standing Telegram + Kapso webhooks already target `https://companion.tironi.xyz`. Set Mac `COMPANION_PUBLIC_BASE_URL=https://companion.tironi.xyz`.

Public DNS for `app.zoen.space` still resolves to **Fly** for the Zoen product site — **do not** point Fly `app.zoen.space` at this Companion tunnel. A zoen.space Companion hostname cutover is **deferred**.

Before changing the public base again:

- named tunnel HTTPS is stable for the new `COMPANION_PUBLIC_BASE_URL`,
- `pnpm start` (or equivalent paired KeepAlive) is always-on,
- ownership binding for _this_ install is understood,
- then re-run `pnpm ingress:set-webhooks` (never `*.trycloudflare.com`).

## Always-on connector on Fly (remove Mac SPOF)

As of **2026-09-10**, the `openinstinct-companion` named tunnel **origin** already points at `https://companion-tironi.fly.dev`. The remaining Mac dependency was the **cloudflared connector** (`com.openinstinct.companion-cloudflared` LaunchAgent).

**Preferred off-Mac path:** run the same tunnel token on Fly app `companion-cf-tunnel` (image `cloudflare/cloudflared`, region `gru`):

| Piece | Role |
| --- | --- |
| [`fly-tunnel/fly.toml`](fly-tunnel/fly.toml) | Connector-only Fly app (no HTTP service) |
| [`scripts/fly-companion-tunnel.sh`](../../scripts/fly-companion-tunnel.sh) | `validate` / `status` / `deploy` / `set-token-from-file` |
| Fly secret `TUNNEL_TOKEN` | Same named-tunnel token as Mac file `~/.cloudflared/openinstinct-companion.token` |

```sh
# One-time (token file mode 600; value never printed):
TUNNEL_TOKEN_FILE="$HOME/.cloudflared/openinstinct-companion.token" \
  ./scripts/fly-companion-tunnel.sh set-token-from-file
./scripts/fly-companion-tunnel.sh deploy

# Verify public hostname (unsigned channel POST → 401; /welcome → 200):
curl -sS -o /dev/null -w '%{http_code}\n' https://companion.tironi.xyz/welcome
# Preferred recurring probe (push alert on fail — see docs/ops/prod-uptime-checklist.md):
# ./scripts/companion-uptime-probe.sh
curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://companion.tironi.xyz/api/channels/telegram \
  -H 'content-type: application/json' -d '{}'

# Only after verify: unload Mac connector (plist file may stay for rollback):
launchctl bootout "gui/$(id -u)/com.openinstinct.companion-cloudflared"
```

**Option B (DNS CNAME → `companion-tironi.fly.dev`, retire tunnel)** was not used: hostname already rides the named tunnel; CF API/wrangler OAuth was unavailable for a safe DNS rewrite during this cutover. Revisit if you want to drop the tunnel hop.

### Rollback (restore Mac connector)

1. Keep Fly compute `companion-tironi` running (origin still `https://companion-tironi.fly.dev`).
2. Reload Mac LaunchAgent (plist still on disk):  
   `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.openinstinct.companion-cloudflared.plist`
3. Confirm Mac `cloudflared` registers; optional: `fly machines stop -a companion-cf-tunnel` only after Mac is healthy.
4. Verify `https://companion.tironi.xyz/welcome` → 200 and unsigned telegram POST → 401.

Do **not** delete the named tunnel or change webhook URLs for rollback.

## Set provider webhook URLs (env names only)

From the repo root, with secrets already in `.env.local` (never printed):

```sh
# Dry-run: prints channel + public path + hostname only (no secrets).
pnpm ingress:set-webhooks -- --dry-run

# Apply Telegram and/or Kapso when the corresponding env names are set.
pnpm ingress:set-webhooks
pnpm ingress:set-webhooks -- --telegram
pnpm ingress:set-webhooks -- --kapso
```

Targets:

- Telegram → `{COMPANION_PUBLIC_BASE_URL}/api/channels/telegram`
- Kapso → `{COMPANION_PUBLIC_BASE_URL}/api/channels/kapso`

The script refuses empty secrets, refuses `*.trycloudflare.com` unless `COMPANION_ALLOW_EPHEMERAL_WEBHOOK=1`, and logs only hostnames / HTTP status / ok|fail — never tokens or webhook secrets.

Kapso: lists webhooks for `KAPSO_PHONE_NUMBER_ID`, PATCHes `KAPSO_WEBHOOK_ID` when set, otherwise updates the first active `kapso` webhook or POSTs a new one with `whatsapp.message.received`.

Telegram: Bot API `setWebhook` with `secret_token` from `TELEGRAM_WEBHOOK_SECRET`.

## Related

- [Hosted Fly cutover (H01)](../../docs/ops/hosted-fly.md)
- [Self-host / ops](../../docs/self-host.md)
- [Alchemy Postgres](../README.md)
- [Local runtime evidence](../../docs/local-runtime-setup.md)
- [Kapso path ADR](../../docs/decisions/adr-kapso-path-r1.md)
- [R2 ops checklists O01/O02](../../docs/ops/README.md)
