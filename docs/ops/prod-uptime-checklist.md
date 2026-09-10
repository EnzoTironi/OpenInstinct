# Prod uptime + backup (companion.tironi.xyz)

Operator checklist after Mac → Fly compute cutover (H01 option C). **Never print
secrets.** F01 rotation is **Partial** (2026-09-10 authorized execute); remaining families stay Enzo-gated — see [credential-rotation.md](credential-rotation.md).

## Live topology (ponytail)

```
TG / Kapso webhooks
       │
       ▼
Cloudflare named tunnel (Mac LaunchAgent companion-cloudflared)
  companion.tironi.xyz
       │
       ▼
Fly app companion-tironi (Next :3000 + Eve :4274)
       │
       ▼
Alchemy unmanaged PG — Fly app companion-pg-prod
  Machine postgres:17-alpine + volume pgdata @ /data/pgdata
  DB name: open_instinct_prod  (private .internal)
```

Mac `companion-runtime` LaunchAgent should stay **unloaded** while Fly serves
traffic. Keep `companion-cloudflared` loaded while the tunnel still terminates
on the Mac.

## Minimal uptime / health (every check)

Run from any laptop with `fly` + network:

```sh
# 1) Compute
fly status -a companion-tironi
# expect: machine started, health checks passing

# 2) Public welcome (tunnel → Fly)
curl -sS -o /dev/null -w "%{http_code}\n" https://companion.tironi.xyz/welcome
# expect: 200  (response headers include via: fly.io + fly-request-id)

# 3) Channel auth rejection (unsigned)
curl -sS -o /dev/null -w "tg=%{http_code}\n" \
  -X POST https://companion.tironi.xyz/api/channels/telegram \
  -H "Content-Type: application/json" -d '{"update_id":1}'
curl -sS -o /dev/null -w "kapso=%{http_code}\n" \
  -X POST https://companion.tironi.xyz/api/channels/kapso \
  -H "Content-Type: application/json" -d '{}'
# expect: both 401 (body "rejected") — proves Next+rewrite path, not CF 525/502

# 4) Postgres (unmanaged)
./scripts/fly-alchemy-pg.sh status --stage prod
fly ssh console -a companion-pg-prod -C "pg_isready -U postgres"
# expect: accepting connections

# 5) Mac tunnel agent (only while CF tunnel terminates on Mac)
launchctl print "gui/$(id -u)/com.openinstinct.companion-cloudflared" | head -8
# expect: state = running
# companion-runtime should NOT be loaded when Fly owns compute
```

Helpers: `./scripts/fly-companion.sh status`, `./scripts/fly-alchemy-pg.sh verify --stage prod`.

## Backup — companion-pg-prod

App: `companion-pg-prod` · Volume: `pgdata` (10GB, `gru`) · Image: `postgres:17-alpine`.

### A) Fly volume snapshots (fast disaster recovery)

Scheduled snapshots may be empty right after first provision — create one
explicitly after cutover and after any schema-heavy migrate:

```sh
VOL_ID=$(fly volumes list -a companion-pg-prod -j | jq -r '.[0].id')
fly volumes snapshots create "$VOL_ID" -a companion-pg-prod
fly volumes snapshots list "$VOL_ID" -a companion-pg-prod
```

Restore is an operator action: create a new volume from a snapshot, attach it to
a replacement Machine (or re-run Alchemy carefully). **Do not** `fly volumes
destroy` the live `pgdata` volume. Prod Alchemy policy retains volume on
destroy tracking — still treat destroy as dangerous.

### B) Logical `pg_dump` (portable)

Dump from inside the PG Machine (password stays on the Machine — do not echo
it). Example shape:

```sh
# On companion-pg-prod (fly ssh). Writes a custom-format dump under /tmp.
fly ssh console -a companion-pg-prod -C \
  "bash -lc 'pg_dump -U postgres -d open_instinct_prod -Fc -f /tmp/open_instinct_prod.dump && ls -lh /tmp/open_instinct_prod.dump'"

# Copy out (operator machine). Prefer sftp/scp via fly ssh / fly proxy — never
# paste dump contents into chat or git.
# fly sftp get -a companion-pg-prod /tmp/open_instinct_prod.dump ./open_instinct_prod.dump
```

Restore into a **new** empty database / staging Machine first:

```sh
# Illustrative only — target must already exist and be reachable:
# pg_restore -U postgres -d open_instinct_prod --clean --if-exists open_instinct_prod.dump
```

Prefer restoring to a scratch DB name, run `pnpm db:migrate` drift checks, then
cut `DATABASE_URL*` — never overwrite prod blindly.

## Rollback — tunnel → Mac 127.0.0.1:3000

If Fly compute misbehaves and Mac must take traffic again:

1. Ensure Alchemy / local Postgres still reachable for the Mac runtime, and
   `~/Library/LaunchAgents/com.openinstinct.companion-runtime.plist` exists.
2. Load Mac runtime:
   `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.openinstinct.companion-runtime.plist`
   (or `kickstart -k` once loaded). Confirm local `:3000` serves `/welcome`.
3. In Cloudflare Zero Trust → named tunnel `openinstinct-companion`, set the
   public hostname `companion.tironi.xyz` origin back to
   `http://127.0.0.1:3000` (keep `companion-cloudflared` running).
4. Verify: `https://companion.tironi.xyz/welcome` → 200; unsigned channel POST →
   **401**. Prefer headers **without** `via: fly.io` once origin is Mac-only.
5. Do **not** destroy `companion-tironi`, `companion-pg-prod`, or the `pgdata`
   volume during rollback.

Forward cutover (Mac → Fly) remains documented in [hosted-fly.md](hosted-fly.md).

## Remaining human gates (not worker-executable)

| Gate                                                    | Status                                                                                                                | Who                     |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| **F01 credential rotation**                             | **Partial** (2026-09-10) — see [credential-rotation.md](credential-rotation.md); do not re-rotate from this checklist | Enzo                    |
| **Meta / Kapso template** `companion_account_notice_v1` | Still **PENDING** (O02 incomplete)                                                                                    | Enzo + Meta review      |
| **Live Telegram private reply proof**                   | Optional spot-check — cleared as stale automation blocker in [enzo-live-actions](enzo-live-actions.md)                | Enzo                    |
| **G03 group mention**                                   | Live add `@ZoenOSBot` + mention (see [enzo-live-actions](enzo-live-actions.md))                                       | Enzo                    |
| Billing / Stripe secrets                                | Out of scope for this hardening pass (ignored per operator)                                                           | Enzo / Stripe dashboard |

Workers may update this doc and run unsigned 401 / welcome / Fly status checks.
Workers must **not** rotate F01, unload `companion-cloudflared`, destroy volumes,
apply live webhook URL changes (dry-run only), or invent Stripe keys.

## Deploy note

- Fly Codex/ChatGPT auth persistence via entrypoint merged as **#50** (2026-09-10) on `companion-tironi`.

## Related

- [Hosted Fly cutover (H01)](hosted-fly.md)
- [Enzo live blockers](enzo-live-actions.md)
- [WhatsApp Meta activation (O02)](whatsapp-meta-activation.md)
- [Credential rotation (F01 / O01)](credential-rotation.md)
- [Ingress](../../infrastructure/ingress/README.md)
