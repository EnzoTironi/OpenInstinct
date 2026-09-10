# Durable public HTTPS ingress (Telegram + Kapso)

Operator recipe for **always-on** public HTTPS that terminates on this Mac (or
another self-host) and forwards to Companion Next, which rewrites:

| Public path              | Eve destination      |
| ------------------------ | -------------------- |
| `/api/channels/telegram` | `/channels/telegram` |
| `/api/channels/kapso`    | `/channels/kapso`    |

Rewrites are generated at build time (`next.config.ts` + `scripts/start.ts`
route checks). **Next alone without Eve on the baked rewrite port fails channel
webhooks.** Prefer `pnpm start`, which pairs Eve + Next in one Effect scope.

## What already exists in this repo

| Piece                         | Role                                                                 |
| ----------------------------- | -------------------------------------------------------------------- |
| Alchemy (`../alchemy.run.ts`) | **Preferred** Postgres for `local` / `dev` / `staging`               |
| Named Cloudflare Tunnel       | **Preferred** durable public HTTPS on Mac (not `trycloudflare`)      |
| Fly DNS (`app.zoen.space`)    | Exists for Zoen product DNS; **not** automatically Companion ingress |

Alchemy in this package provisions Postgres only. Public HTTPS uses a
**Cloudflare named tunnel** (token file + KeepAlive LaunchAgent). Do **not** use
ephemeral `cloudflared tunnel --url` / `*.trycloudflare.com` for standing
webhooks — R1 left Telegram/Kapso pointed at dead quick tunnels.

## Required env **names** (no values here)

App (`.env.local`):

| Name                        | Role                                           |
| --------------------------- | ---------------------------------------------- |
| `COMPANION_PUBLIC_BASE_URL` | Public HTTPS origin, no trailing slash         |
| `BETTER_AUTH_URL`           | Should match the same public origin            |
| `TELEGRAM_BOT_TOKEN`        | Telegram Bot API token                         |
| `TELEGRAM_WEBHOOK_SECRET`   | Telegram `secret_token` verification           |
| `KAPSO_PHONE_NUMBER_ID`     | Kapso / Meta phone number id                   |
| `KAPSO_API_KEY`             | Kapso platform API key                         |
| `KAPSO_WEBHOOK_SECRET`      | Kapso HMAC secret (`x-webhook-signature`)      |
| `KAPSO_WEBHOOK_ID`          | Optional; when set, PATCH this webhook id only |

Ingress helper (`infrastructure/ingress/.env` — local only, chmod `600`):

| Name                            | Role                                           |
| ------------------------------- | ---------------------------------------------- |
| `CLOUDFLARED_TUNNEL_TOKEN_FILE` | Path to named-tunnel token file (mode 600)     |
| `COMPANION_INGRESS_SERVICE`     | Tunnel origin, default `http://127.0.0.1:3000` |
| `COMPANION_INGRESS_HOSTNAME`    | Optional CF hostname for this install          |

Never commit tokens, print them in logs/PRs, or embed them inline in plists
checked into git. Use the token **file** path in LaunchAgents.

## Always-on Next + Eve pairing

1. Build with the Eve port you will run:  
   `EVE_NEXT_PRODUCTION_PORT=4274 pnpm build` (default `4274`).
2. Start the **paired** launcher: `pnpm start --port 3000 --eve-port 4274`.  
   The launcher waits for Eve HTTP health, fails if either child exits, and
   stops the sibling. Channel routes require Eve on the rewrite port baked into
   `.next/routes-manifest.json`.
3. For Mac reboot survival, install the example LaunchAgent  
   `com.openinstinct.companion-runtime.plist.example` (points at `pnpm start`)
   **and** `com.openinstinct.companion-cloudflared.plist.example`.
4. LaunchAgents must set `HOME` and a `PATH` that includes `pnpm`, Node 24, and
   (when using `COMPANION_MODEL_PROVIDER=codex-local`) the `codex` CLI
   (`~/.local/bin`). Missing `codex` on PATH breaks model turns under launchd.
5. Do **not** leave Eve KeepAlive on a port that no longer matches a rebuild,
   and do **not** front standing webhooks with a throwaway trycloudflare URL.

## Named tunnel setup (automated as far as credentials allow)

1. Create a Cloudflare named tunnel in Zero Trust (or reuse an existing
   Companion tunnel). Save the tunnel token to a mode-`600` file named by
   `CLOUDFLARED_TUNNEL_TOKEN_FILE` — never into git.
2. In the Cloudflare dashboard, route `COMPANION_INGRESS_HOSTNAME` → the tunnel
   → `http://127.0.0.1:3000` (or set `COMPANION_INGRESS_SERVICE`). Optionally
   copy `cloudflared.config.example.yml` for credentials-file mode.
3. Install the cloudflared LaunchAgent from the example plist (replace
   `/Users/REPLACE/...` paths). Load:  
   `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.openinstinct.companion-cloudflared.plist`
4. Confirm public HTTPS reaches Next (unsigned webhook POSTs should **401**, not
   hang or 525). Then set provider webhooks (next section).

### DNS / tunnel blocker (Enzo)

As of R2 worker D01, public DNS for `app.zoen.space` still resolves to **Fly**,
while the Mac named-tunnel LaunchAgent cannot receive that hostname until DNS
(or an orange-cloud hostname) is pointed at the Companion tunnel. If live
tunnel credentials / DNS for the Companion hostname are missing, ship this
docs+scripts+config path and leave provider webhooks on their prior targets
until Enzo completes DNS.

**Do not** redirect production Telegram/Kapso webhooks until:

- named tunnel HTTPS is stable for `COMPANION_PUBLIC_BASE_URL`,
- `pnpm start` (or equivalent paired KeepAlive) is always-on,
- ownership binding for _this_ install is understood.

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

The script refuses empty secrets, refuses `*.trycloudflare.com` unless
`COMPANION_ALLOW_EPHEMERAL_WEBHOOK=1`, and logs only hostnames / HTTP status /
ok|fail — never tokens or webhook secrets.

Kapso: lists webhooks for `KAPSO_PHONE_NUMBER_ID`, PATCHes `KAPSO_WEBHOOK_ID`
when set, otherwise updates the first active `kapso` webhook or POSTs a new
one with `whatsapp.message.received`.

Telegram: Bot API `setWebhook` with `secret_token` from
`TELEGRAM_WEBHOOK_SECRET`.

## Related

- [Self-host / ops](../../docs/self-host.md)
- [Alchemy Postgres](../README.md)
- [Local runtime evidence](../../docs/local-runtime-setup.md)
- [Kapso path ADR](../../docs/decisions/adr-kapso-path-r1.md)
