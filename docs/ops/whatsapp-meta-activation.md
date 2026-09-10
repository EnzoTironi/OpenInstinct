# O02 — WhatsApp Meta activation (Kapso path)

**Status:** Operator checklist (R2). Enzo completes Meta / Kapso console work.
Workers only document the path — **no secret values**, no webhook redirects until
durable HTTPS is up (D01).

Companion reaches WhatsApp **through Kapso** (Effect adapter + HMAC webhook).
Product activation still needs Meta display-name approval and at least one
**UTILITY** template approved. Adapter decision:
[ADR Kapso path R1](../decisions/adr-kapso-path-r1.md).

## Preconditions

1. Kapso env **names** present in `.env.local` (values never in git):
   `KAPSO_PHONE_NUMBER_ID`, `KAPSO_PHONE_NUMBER`, `KAPSO_API_KEY`,
   `KAPSO_WEBHOOK_SECRET` (optional `KAPSO_WEBHOOK_ID`).
2. Number shows CONNECTED in Kapso / WhatsApp Manager (credential readiness only —
   not e2e delivery).
3. Prefer completing [display name](#1-meta-display-name-approval) before relying
   on template capacity / quality gates.

## 1. Meta display-name approval

Enzo (Meta Business / WhatsApp Manager):

1. Open the WABA tied to the Kapso-connected number.
2. Submit or confirm the **business display name** for the phone number.
3. Wait until Meta shows the display name as **approved** (not pending/rejected).
4. Record approval status in your private ops notes only — not in this repo.

If display name is rejected, fix naming/docs mismatch in Meta and resubmit;
do not invent a Companion code workaround.

## 2. Create and approve ≥1 UTILITY template

Enzo creates templates via **Kapso → Meta WhatsApp templates** (or WhatsApp
Manager). Kapso API reference:

- [Create or update message template](https://docs.kapso.ai/api/meta/whatsapp/templates/create-or-update-message-template)

Checklist:

1. Category **`UTILITY`** only for transactional / account / support follow-ups
   (no promos, discounts, or upsells — Meta may reclassify to MARKETING).
2. Name: lowercase + underscores (example shape only): `companion_account_notice_v1`.
3. Language appropriate for the pilot (e.g. `pt_BR` and/or `en_US`).
4. Body is identifiable (business context); variables have realistic **examples**.
5. Submit and wait for status **`APPROVED`** (not `PENDING` / `REJECTED`).
6. Keep **at least one** APPROVED UTILITY template before claiming O02 done.

Do **not** paste template secrets, API keys, or full live payloads into PRs.

## 3. Point product traffic at Kapso + durable webhook (D01)

Companion public path: `/api/channels/kapso` → Eve `/channels/kapso`.

1. Confirm named Cloudflare Tunnel HTTPS for `COMPANION_PUBLIC_BASE_URL`
   ([ingress README](../../infrastructure/ingress/README.md)). Interim live:
   `https://companion.tironi.xyz`. **Not** `*.trycloudflare.com`, and **not**
   Fly `app.zoen.space` (product site; zoen Companion cutover deferred).
2. Dry-run the D01 setter (prints channel + hostname + path only):

   ```sh
   pnpm ingress:set-webhooks -- --dry-run
   pnpm ingress:set-webhooks -- --kapso
   ```

3. Script: `scripts/set-channel-webhooks.sh` (`pnpm ingress:set-webhooks`).
   Refuses empty secrets; never prints `KAPSO_API_KEY` / `KAPSO_WEBHOOK_SECRET`.
4. Verify: wrong/missing HMAC → HTTP 401; Kapso phone GET still CONNECTED.

**Do not** redirect production Kapso webhooks until DNS → named tunnel is done
([enzo-live-actions.md](enzo-live-actions.md)) and ownership binding for _this_
install is understood.

## 4. Honest remaining gaps

Even after display name + one UTILITY template:

- Live private e2e bind on the redirected webhook may still be open.
- Templates / 24h window / opt-in UX for proactive sends may still be product
  follow-up ([Kapso ADR](../decisions/adr-kapso-path-r1.md)).
- WA group mention gate remains limited by provider signals
  ([G03 ADR](../decisions/adr-g03-groups-live-e2e.md)).

## Status snapshot (2026-09-10, Kapso API — no secrets)

Evidence from Kapso Platform phone GET + Meta Proxy templates list (operator
Mac; secret values not logged):

| Gate | Result |
| ---- | ------ |
| Phone connection | `CONNECTED` · quality `GREEN` · account mode `LIVE` |
| Display name | `name_status=AVAILABLE_WITHOUT_REVIEW` · verified name present (`Zoen`) |
| UTILITY templates | `companion_account_notice_v1` (`pt_BR`) still **`PENDING`** — none `APPROVED` yet |
| Durable webhook | Interim `https://companion.tironi.xyz` (unsigned POST → 401) |

Re-check with Kapso (env **names** only): Platform
`GET /whatsapp/phone_numbers/{KAPSO_PHONE_NUMBER_ID}` for `status` /
`name_status`; Meta Proxy
`GET /{business_account_id}/message_templates?name=companion_account_notice_v1`.

## Done when

- [x] Meta display name usable for the Kapso number (`AVAILABLE_WITHOUT_REVIEW`)
- [ ] ≥1 **UTILITY** template **APPROVED** (still blocked on Meta review of
      `companion_account_notice_v1`)
- [x] Kapso webhook aimed at durable interim `https://companion.tironi.xyz`
      via D01 script (zoen.space Companion hostname deferred)
