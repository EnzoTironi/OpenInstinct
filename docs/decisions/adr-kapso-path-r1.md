# ADR: Release-1 Kapso / WhatsApp path (U07)

- **Status:** Accepted
- **Date:** 2026-09-09 (America/Sao_Paulo)
- **Decision:** **proceed** (Effect adapter / webhook private-delivery path)
- **Worker:** U07 — compare Kapso on `origin/main` (@ c4258fa, includes #16) to Telegram U06 private-delivery qual bar

## Context

U06 qualifies Telegram private delivery on three contract points:

1. Webhook secret authentication (timing-safe; empty secret rejected).
2. Private-chat-only parse after verified JSON (groups filtered).
3. Outbox-safe 429 handling (`ProviderRetryable` → `scheduleOutboxRetry`).

Release 1 still wants WhatsApp through Kapso as a product destination
(`docs/companion-blueprint.md` P09 / R1). This ADR answers whether the **Kapso
Effect adapter + webhook + tests** may proceed at that engineering bar, or must
be deferred / blocked.

## Evidence (Kapso on main)

| U06 bar item             | Kapso evidence                                                                                                                                                                                 | Verdict                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Webhook auth             | `readVerifiedWebhook` HMAC-SHA256 over **original bytes**; empty secret → 401; whitespace-preserving verify in `webhook.test.ts`                                                               | Meets (Kapso must read body before verify; Telegram can reject pre-body) |
| Private-only ingress     | Groups / system / outbound / non-live origins ignored; installation + contact consistency enforced in `kapso.ts` + `kapso.test.ts`                                                             | Meets; origin allow-list is stricter than Telegram                       |
| Media hygiene            | Opaque media ids only; untrusted URLs stripped in tests                                                                                                                                        | Meets                                                                    |
| Event age / batch bounds | Stale/future rejected; batch 1..100; live redacted fixture accepted                                                                                                                            | Meets                                                                    |
| Send / 429               | `Kapso.sendText` uses shared `requestProviderJson` (HTTP 429 → `ProviderRetryable`). Meta/Kapso expose rate limits as HTTP status, unlike Telegram’s `{ ok:false, error_code:429 }` inside 2xx | Meets via shared HTTP path; no app-envelope mapper required              |
| Auth→parse fixture       | Added `kapso-private-delivery.test.ts` (HMAC → parse → one private message; group → `[]`) plus wrong/length-mismatched HMAC negatives                                                          | Meets after this PR                                                      |

## Decision

**Proceed** with the Kapso Effect adapter / webhook private-delivery path for
Release-1 engineering work. No production adapter change was required; only
qualification fixtures and this ADR landed.

This is **not** a claim that full WhatsApp product activation (P09 acceptance:
templates / messaging windows / live webhook redirect / linking UX) is done.

## Follow-ups (not tiny; do not block adapter proceed)

1. **Browser login / link challenge for Kapso** — `channel-auth/start` returns a
   `wa.me` conversation URL only; no token challenge cookie path like Telegram.
   Confirm whether conversation-first native onboarding remains intentional.
2. **Auth prompt dispatch** — `dispatchAuthPrompt` is Telegram-only; Kapso has no
   `sendLoginConfirmation`.
3. **Inbound `/start`/`/confirm` commands** — `normalizeInbound` parses commands
   only for Telegram; Kapso tests intentionally keep those strings as messages.
4. **WhatsApp templates, 24h window, opt-in** — proactive / out-of-window sends.
5. **Live webhook redirect + real-number journey** — credential checks in
   `docs/local-runtime-setup.md` are not e2e delivery evidence.
6. **Coordinate with U06** — Telegram private-delivery PR may still be landing;
   Kapso fixtures mirror that bar without depending on its merge.

## Alternatives considered

- **Defer adapter work until login parity:** rejected — private ingress/outbox
  contracts are already Effect-shaped and testable; login is a separate slice.
- **Blocked:** rejected — no critical Effect/safety gap found in adapter or
  webhook verification relative to U06.

## Orch `decisions.tsv` row (copy)

```text
U07	kapso-path	proceed	2026-09-09T17:10:00Z	Adapter/webhook meets Telegram U06 private-delivery bar (HMAC, private-only, HTTP 429 via requestProviderJson). Tiny fixture parity landed. Defer WhatsApp login/prompts/templates/live redirect as follow-ups; not blocked.
```
