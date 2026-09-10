# O01 — Credential rotation checklist (F01)

**Status:** **Partial** live rotation (2026-09-10, Enzo-authorized) — not Deferred.
Checklist remains the operator source of truth for **environment variable names**,
**rotation order**, and **verify steps**. **Never print, paste, commit, or log
secret values.**

**Live rotation (2026-09-10):** **Partial execute** (Enzo-authorized). Fly app
`companion-tironi` + local `.env.prod` / `.env.local` (worktree
`companion-tironi-prod`) updated for rotatable families below. **Never print,
paste, commit, or log secret values.**

| Family                                                       | Result                                                                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                                         | **Rotated** (Fly + local env); sessions invalidated                                      |
| `TELEGRAM_WEBHOOK_SECRET`                                    | **Rotated**; `setWebhook` re-applied to `companion.tironi.xyz`                           |
| `KAPSO_WEBHOOK_SECRET`                                       | **Rotated**; Kapso webhook patched (id retained)                                         |
| `SECRET_ENCRYPTION_KEY`                                      | **Retained** — rotating would break ciphertext without re-encrypt                        |
| `TELEGRAM_BOT_TOKEN`                                         | **Skipped** — needs BotFather `/revoke` (interactive)                                    |
| `KAPSO_API_KEY`                                              | **Skipped** — dashboard-only project key rotation                                        |
| `GOOGLE_CLIENT_SECRET`                                       | **Skipped** — `gcloud` not authenticated this session                                    |
| `OPENROUTER_API_KEY` / `KERNEL_API_KEY` / `OPENCODE_API_KEY` | **Skipped** — provider console / management key required                                 |
| Postgres (`DATABASE_URL*`)                                   | **Skipped** — no backup+cutover this session                                             |
| Named tunnel token                                           | **Skipped** — Mac file retained; also Fly secret `TUNNEL_TOKEN` on `companion-cf-tunnel` |
| Stripe                                                       | **Ignored** (out of scope)                                                               |

Post-rotation verify (2026-09-10): `https://companion.tironi.xyz/welcome` → 200;
unsigned Telegram/Kapso channel POST → 401; Telegram `getMe` → `ZoenOSBot`;
Kapso phone GET → CONNECTED; Fly machine health check passing.

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

## `SECRET_ENCRYPTION_KEY` rotation plan (P1 crypto — docs only)

**Do not rotate `SECRET_ENCRYPTION_KEY` in this change / session.** This section
is the standing operator plan for when Enzo authorizes a real cutover.

### Current crypto shape (as of 2026-09-10)

| Fact               | Detail                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| Key env            | `SECRET_ENCRYPTION_KEY` — base64 → **exactly 32 bytes** (`shared/environment/env.ts`)                |
| Algorithm          | AES-256-GCM via `db/services/vault.ts` (`encryptVaultSecret` / `decryptVaultSecret`)                 |
| Ciphertext format  | `v1.<iv_b64url>.<tag_b64url>.<ciphertext_b64url>` — `v1` is **format** version, **not** a key id     |
| AAD                | `workspaceId \0 vault \0 id`                                                                         |
| Storage            | Postgres table `encrypted_secrets` (`namespace = 'vault'` only today)                                |
| Dual-key / keyring | **Not implemented** — runtime loads a single key from env (or Blob-provisioned installation secrets) |

Consequence: flipping the env to a new key **without** rewriting every
`encrypted_secrets.encrypted_value` makes vault secrets permanently unreadable.

### Preconditions (gate before any live rotate)

1. **Authorized** by Enzo for a maintenance window.
2. **Backup** companion-pg-prod: Fly volume snapshot **and** logical `pg_dump`
   (see [prod-uptime-checklist.md](prod-uptime-checklist.md)). Verify restore to
   a scratch DB once.
3. **Inventory** (status only — never print ciphertext or plaintext):
   `SELECT count(*) FROM encrypted_secrets WHERE namespace = 'vault';`
4. **Tooling** — prefer shipping (separate PR) either:
   - **(A) Dual-key read** — env `SECRET_ENCRYPTION_KEY` (new) +
     `SECRET_ENCRYPTION_KEY_PREVIOUS` (old) so decrypt tries new then previous; or
   - **(B) Offline re-encrypt** — one-shot operator script that decrypts with old
     key and rewrites `v1…` rows with new key **before** Fly secret cutover.
5. Until (4) exists, treat rotation as **blocked** except on empty vaults /
   disposable installs.

### Recommended procedure (when tooling exists)

1. Generate new key offline: `openssl rand -base64 32` → keep only in a `chmod 600`
   temp file (never chat / PR / CI logs).
2. Take PG snapshot + `pg_dump`; record row count.
3. Prefer path **A** (dual-key):
   1. Set Fly secret `SECRET_ENCRYPTION_KEY_PREVIOUS` = current key (if/when
      code supports it), then `SECRET_ENCRYPTION_KEY` = new key; restart
      `companion-tironi`.
   2. Run re-encrypt job / script to rewrite all vault rows under the new key.
   3. Confirm sample vault reads (browser login vault item or known test item).
   4. Remove `SECRET_ENCRYPTION_KEY_PREVIOUS` after soak; shred temp files.
4. Path **B** (offline, single-key):
   1. Quiesce writers (maintenance / scale to zero briefly).
   2. Re-encrypt all rows with old→new using the offline tool against a
      connection that never logs secret values.
   3. Set Fly `SECRET_ENCRYPTION_KEY` (and matching local `.env.prod` /
      `.env.local` if used) to the new key; restart compute.
   4. Verify vault decrypt; only then revoke/shred the old key material.
5. **Verify** (no secret output): app boots; welcome → 200; unsigned channel
   POST → 401; at least one previously stored vault secret decrypts in-product.
6. **Rollback** — restore volume / `pg_dump` **and** put the previous key back
   on Fly if verify fails before shredding the old key.

### Explicit non-goals for this docs PR

- No live `fly secrets set SECRET_ENCRYPTION_KEY=…`
- No ciphertext rewrite
- No dual-key code in this change

## Related Enzo blockers

Secret rotation does **not** unblock DNS or Meta product gates. See
[enzo-live-actions.md](enzo-live-actions.md) and
[whatsapp-meta-activation.md](whatsapp-meta-activation.md).
