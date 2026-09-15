# Companion R2 ops checklists

Operator-facing checklists for remaining Release-2 (R2) ops toward 100%.
**Enzo executes secrets / Meta / DNS / live Telegram group actions.** Workers ship
docs and scripts only — never secret values in git, PRs, logs, or chat.

| ID  | Checklist                                                                                                              | Owner             |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ----------------- |
| O01 | [Credential rotation (F01)](credential-rotation.md) — names, order, verify; **SECRET_ENCRYPTION_KEY plan (docs only)** | Enzo (secrets)    |
| O02 | [WhatsApp Meta + Kapso activation](whatsapp-meta-activation.md)                                                        | Enzo (Meta/Kapso) |
| —   | [Enzo live blockers](enzo-live-actions.md) (DNS + G03 Telegram group)                                                  | Enzo only         |
| H01 | [Hosted Fly cutover](hosted-fly.md) — Alchemy Docker PG + Fly compute                                                  | Enzo (deploy/DNS) |
| —   | [Prod uptime + backup](prod-uptime-checklist.md) — **push alert** + health, pg_dump, rollback                          | Ops / Enzo        |

**Ingress status (2026-09-10 ~16:50 PT):** Companion channel public base is interim
`https://companion.tironi.xyz` (named tunnel still Mac `companion-cloudflared`;
compute on Fly `companion-tironi`; Mac `companion-runtime` unloaded). TG+Kapso
unsigned POST → 401. Fly `app.zoen.space` product DNS unchanged; zoen Companion
cutover deferred.

**O02 / Meta (2026-09-10 Kapso API):** Display name `AVAILABLE_WITHOUT_REVIEW`
(verified name present). UTILITY template `companion_account_notice_v1` still
`PENDING` — O02 not complete. **F01 credential rotation is Partial** (2026-09-10 Enzo-authorized execute for rotatable families; remaining skipped — see [credential-rotation.md](credential-rotation.md)). Not Deferred.

Related:

- [Customer-platform release map](../decisions/adr-customer-platform-release.md)
  (REL01 gates, REL02 Alchemy publication blocked on later SHAs)
- [Hosted Fly cutover (H01)](hosted-fly.md)
- [Prod uptime + backup](prod-uptime-checklist.md) (external probe + push alert)
- [Self-host / ops](../self-host.md)
- [Durable ingress (D01)](../../infrastructure/ingress/README.md)
- [Kapso path ADR](../decisions/adr-kapso-path-r1.md)
- [G03 groups live e2e ADR](../decisions/adr-g03-groups-live-e2e.md)
- [Ops ADR O01/O02](../decisions/adr-o01-o02-ops-r2.md)
