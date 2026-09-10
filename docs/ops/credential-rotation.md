# O01 — Credential rotation checklist (F01)

**Status:** Checklist only (R2). Enzo rotates live secrets; this document lists
**environment variable names**, **rotation order**, and **verify steps**.
**Never print, paste, commit, or log secret values.**

Scope: Companion self-host on Mac (Alchemy Postgres + named Cloudflare Tunnel +
`pnpm start`). See [self-host](../self-host.md) and
[durable ingress](../../infrastructure/ingress/README.md).

## Rules

1. Rotate one family at a time; verify before the next family.
2. Keep `.env.local` and `infrastructure/.env` mode `600`; never commit them.
3. Prefer generating new values offline (`openssl rand -base64 32` for
   `SECRET_ENCRYPTION_KEY` / auth secrets) and swapping files atomically.
4. Do **not** dump env files into PRs, agent transcripts, Slack, or CI logs.
5. Credential checks (`getMe`, Kapso phone GET) are **not** e2e delivery proof.

## Rotation order (names only)

Rotate in this order so dependents break in a controlled, recoverable way.

| Step | Family                     | Env **names** (rotate these)                                                                   | Notes                                                                                        |
| ---- | -------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1    | Model / optional SaaS keys | `AI_GATEWAY_API_KEY`, `OPENROUTER_API_KEY`, `KERNEL_API_KEY`, `BLOB_READ_WRITE_TOKEN`          | Lowest blast radius; optional until those features run                                       |
| 2    | Google OAuth client secret | `GOOGLE_CLIENT_SECRET` (keep `GOOGLE_CLIENT_ID` unless client is recreated)                    | Users must re-consent / refresh after secret change                                          |
| 3    | Telegram Bot API           | `TELEGRAM_BOT_TOKEN`, then `TELEGRAM_WEBHOOK_SECRET`                                           | Regenerate via BotFather / setWebhook; coordinate with durable HTTPS                         |
| 4    | Kapso / WhatsApp           | `KAPSO_API_KEY`, then `KAPSO_WEBHOOK_SECRET` (ids `KAPSO_PHONE_NUMBER_ID`, `KAPSO_WEBHOOK_ID`) | Update Kapso dashboard + webhook HMAC together; see O02                                      |
| 5    | Auth signing               | `BETTER_AUTH_SECRET`                                                                           | Invalidates browser sessions                                                                 |
| 6    | Installation encryption    | `SECRET_ENCRYPTION_KEY`                                                                        | **High risk** — encrypted-at-rest installation payloads become unreadable without re-encrypt |
| 7    | Postgres (Alchemy)         | `COMPANION_POSTGRES_PASSWORD` → rewrite `DATABASE_URL` / `DATABASE_URL_UNPOOLED`               | Stage-scoped; take a backup story before prod                                                |
| 8    | Named tunnel token         | contents of file named by `CLOUDFLARED_TUNNEL_TOKEN_FILE`                                      | File mode 600; never inline in LaunchAgent plists in git                                     |

Do **not** rotate `TELEGRAM_BOT_ID` / `TELEGRAM_BOT_USERNAME` / `KAPSO_PHONE_NUMBER`
unless the bot or WhatsApp number itself changes (identity, not a secret).

Optional identity / URL names (usually unchanged on secret rotation):

- `COMPANION_PUBLIC_BASE_URL`, `BETTER_AUTH_URL` (interim public base: `https://companion.tironi.xyz`; zoen.space deferred)
- `COMPANION_INGRESS_HOSTNAME`, `COMPANION_INGRESS_SERVICE`
- `WORKFLOW_LOCAL_BASE_URL`, `WORKFLOW_POSTGRES_URL`
- `BLOB_STORE_ID`, `LINQ_CONNECTOR`, `LINQ_PHONE_NUMBER`

## Per-family procedure (generic)

For each row above:

1. **Inventory** — confirm the name is set in `.env.local` or
   `infrastructure/.env` (do not print the value).
2. **Issue** — create the replacement in the provider console (BotFather, Kapso,
   Google Cloud, Cloudflare Zero Trust, Alchemy/`psql`, etc.).
3. **Stage** — write the new value into a temp env file (`chmod 600`), keep the
   old file until verify passes.
4. **Cut over** — replace the live env file; restart paired runtime
   (`pnpm start` or LaunchAgent `companion-runtime`).
5. **Re-point webhooks if needed** — after Telegram/Kapso secret or public URL
   changes, use the D01 script (never ephemeral trycloudflare):

   ```sh
   pnpm ingress:set-webhooks -- --dry-run
   # apply only when named-tunnel HTTPS is stable:
   pnpm ingress:set-webhooks -- --telegram
   pnpm ingress:set-webhooks -- --kapso
   ```

6. **Verify** — use the checks below (status / hostname only).
7. **Retire** — revoke the old provider credential after verify; shred temp files.

## Verify steps (no secret output)

| After rotating…               | Verify (operator)                                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model / Kernel / Blob         | Feature smoke that needs that key; confirm HTTP 200/401 expected — do not log Authorization headers                                                      |
| `GOOGLE_CLIENT_SECRET`        | OAuth redirect to `{BETTER_AUTH_URL}/api/auth/callback/google` completes for a test account                                                              |
| `TELEGRAM_BOT_TOKEN`          | Bot API `getMe` returns expected username (e.g. ZoenOSBot); do not log the token                                                                         |
| `TELEGRAM_WEBHOOK_SECRET`     | `getWebhookInfo` shows HTTPS URL under `COMPANION_PUBLIC_BASE_URL`; unsigned POST → 401                                                                  |
| `KAPSO_API_KEY`               | Kapso phone-number GET for `KAPSO_PHONE_NUMBER_ID` → HTTP 200 / CONNECTED ([docs](https://docs.kapso.ai/api/platform/v1/phone-numbers/get-phone-number)) |
| `KAPSO_WEBHOOK_SECRET`        | Unsigned/wrong-signature POST to `/api/channels/kapso` → 401; dry-run webhook script prints hostname only                                                |
| `BETTER_AUTH_SECRET`          | Old browser sessions fail closed; new sign-in works                                                                                                      |
| `SECRET_ENCRYPTION_KEY`       | App boots; installation-encrypted paths that you **re-encrypted** still decrypt; expect failure if old ciphertext was not migrated                       |
| `COMPANION_POSTGRES_PASSWORD` | `pnpm db:check`; Alchemy container health `healthy`; migrate if needed                                                                                   |
| Tunnel token file             | Public HTTPS to Next returns channel webhook 401 (not 525/hang); LaunchAgent stays loaded                                                                |

## `SECRET_ENCRYPTION_KEY` caution

Blueprint expects key versioning for restore; the current self-host path uses a
single env name. **Do not rotate `SECRET_ENCRYPTION_KEY` on a standing install
that already stores encrypted installation secrets unless you have a tested
re-encrypt / restore plan.** Prefer rotating provider tokens (steps 1–4) first.

Generate shape (local only — do not commit output):

```sh
openssl rand -base64 32   # → paste into .env.local as SECRET_ENCRYPTION_KEY
```

Must be base64 decoding to **exactly 32 bytes** (see `shared/environment/env.ts`).

## Related Enzo blockers

Secret rotation does **not** unblock DNS or Meta product gates. See
[enzo-live-actions.md](enzo-live-actions.md) and
[whatsapp-meta-activation.md](whatsapp-meta-activation.md).
