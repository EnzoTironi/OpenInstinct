# Enzo-only live actions (R2 blockers)

These cannot be completed by workers (no Meta / DNS / BotFather authority in CI).
Ship docs/scripts; Enzo executes.

## 1. DNS — Companion hostname → named tunnel

**Done (interim, 2026-09-10):** Companion channel ingress is live at
`https://companion.tironi.xyz` (named tunnel `openinstinct-companion`, LaunchAgent
`com.openinstinct.companion-cloudflared`). Telegram + Kapso webhooks already use
that origin. Mac runtime: `COMPANION_PUBLIC_BASE_URL=https://companion.tironi.xyz`.

`app.zoen.space` still resolves to **Fly** for the Zoen **product** site — leave
it alone. A zoen.space Companion hostname cutover is **deferred**.

If / when replacing the interim hostname:

1. Choose the next Companion hostname (dedicated name; do **not** hijack Fly
   `app.zoen.space` product DNS unless intentionally migrating that site).
2. In Cloudflare Zero Trust / DNS: point that hostname (orange-cloud / tunnel
   route) at the Companion named tunnel → `COMPANION_INGRESS_SERVICE`
   (default `http://127.0.0.1:3000`).
3. Set `COMPANION_PUBLIC_BASE_URL` / `BETTER_AUTH_URL` / optional
   `COMPANION_INGRESS_HOSTNAME` to that HTTPS origin (names only in docs).
4. Confirm public HTTPS reaches Next (unsigned channel POST → **401**, not 525).
5. Only then run `pnpm ingress:set-webhooks` for Telegram/Kapso.

Details: [infrastructure/ingress/README.md](../../infrastructure/ingress/README.md).

Off-Mac always-on compute (Fly + Alchemy unmanaged PG option C / Docker A/B, keep this hostname):
[hosted-fly.md](hosted-fly.md) + `scripts/fly-alchemy-pg.sh`.

## 2. Telegram — add `@ZoenOSBot` to group + mention (live G03)

For live G03 group mention → accept → bind proof:

1. Add **`@ZoenOSBot`** to the target Telegram group/supergroup (admin as needed
   for privacy-mode bots).
2. Send a message that **@mentions** the bot (or reply to the bot) so privacy
   mode delivers the update.
3. Run / collect artifacts from the G03 harness path documented in
   [ADR G03](../decisions/adr-g03-groups-live-e2e.md)
   (`scripts/groups-live-e2e.ts`, artifacts under `/tmp/companion-groups-live-e2e/`
   when executed with local env — **never commit secrets or raw live dumps**).

Workers may ship harness/docs; Enzo performs the live add + mention.
