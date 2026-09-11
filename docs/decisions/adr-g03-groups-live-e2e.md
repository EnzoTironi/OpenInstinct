# ADR: G03 groups live e2e + Kapso mention gate

- **Status:** Accepted
- **Date:** 2026-09-10 (America/Sao_Paulo)
- **Decision:** **proceed** Telegram group mention→accept→bind harness (fixture + preferred live Bot API path); open Kapso/WA group ingress **only** when explicit mention / reply-to-business signals are present; document remaining WA product gap when signals are absent.
- **Worker:** G03 — after G01 `@ 01d3148` / G02 `#30 @ 629dcfb`

## Context

G01 mention-gated Telegram groups and closed Kapso groups; G02 memory boundary. G03 owns live proof and Kapso/WA mention/participant ingress.

## Telegram path (complete for Release-1 ingress)

1. `parseTelegramUpdate` already accepts `@mention` / reply-to-bot group messages (privacy-mode bots also only receive those).
2. `runTelegramGroupMentionHarness` proves fixture mention → inbound accept → `bindGroupChannelIdentity` (`conversationScope` / `deliveryTargetId = chatId`).
3. Outbound product send now accepts negative group/supergroup `chat_id`s and non-private receipt chat types (login confirmations remain private-scoped by callers).
4. Live preference: Enzo Telegram Web + `.env.local` bot (`ZoenOSBot`). Artifact directory: `/tmp/companion-groups-live-e2e/`.

## Kapso / WhatsApp path

### What we opened

`extractKapsoGroupMentionSignals` + `evaluateGroupMentionPolicy` open a group envelope when **any** of these explicit signals exist:

| Signal | Source field(s) |
| --- | --- |
| Mentioned business | `message.kapso.mentioned`, `message.kapso.mentioned_business` |
| Mention list hits install phone | `message.mentions[]` / `message.mentioned_ids[]` |
| Reply to business | `message.kapso.reply_to_business` or `message.context.from_me` |

Group `chatId` prefers `message.group_id`, then `conversation.id`.

### Remaining product gap (why typical WA groups stay blocked)

Verified against Kapso docs (message events / extensions, 2026-09-10) and Meta Groups messaging references:

1. **Kapso v2 webhook examples do not document** `is_group` mention flags, `mentions`, `mentioned_ids`, `mentioned_business`, or `context.from_me`.
2. **Meta Groups inbound webhooks** expose `group_id` + participant `from`, but **no mention-gate field** equivalent to Telegram entities / reply-to-bot. Delivering all group chatter would violate G01 no-spam policy.
3. Kapso **send** remains `recipient_type: "individual"` in this PR (group JID send still deferred) — outbound WA groups are not product-complete even if a future inbound signal appears.

Therefore: **closed-until-mention remains the default** for real Kapso payloads today; the code path is ready the moment provider payloads carry the signals above. Fixture `kapso-group-mention.redacted.json` locks the forward-compatible contract.

## Alternatives considered

- **Accept all Kapso `is_group` messages:** rejected — spam risk; no provider mention gate in docs.
- **Heuristic `@` text matching on WA body:** rejected — unreliable vs business display names / locale; not an authz signal.
- **Defer Telegram outbound group schema:** rejected — blocks live group reply proof through the product send helper.

## Evidence

- Unit/fixture: `server/channels/groups-e2e-harness.test.ts`, `group-policy.test.ts`, Kapso/Telegram channel tests.
- Live artifacts (when run): `/tmp/companion-groups-live-e2e/REPORT.md`.
