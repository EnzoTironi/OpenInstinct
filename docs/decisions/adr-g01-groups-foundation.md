# ADR: G01 groups foundation (Telegram + Kapso/WA)

- **Status:** Accepted (foundation only)
- **Date:** 2026-09-10 (America/Sao_Paulo)
- **Decision:** **proceed** Effect-safe group/supergroup detection, private `channel_identity` binding skeleton, and mention/policy gate (no spam).
- **Worker:** G01 — inventory + foundation PR (skip live group e2e G03 / deep shared-memory G02 unless hooks required)

## Inventory (verified on `origin/main` @ 16a5859)

| Surface | Private behavior | Group behavior before G01 | Gap |
| --- | --- | --- | --- |
| `server/channels/telegram.ts` parse | Accepts only `chat.type === "private"` and `chat.id === sender.id` | Hard-drop non-private | No group/supergroup detect; no mention gate; no chat scope on inbound |
| Telegram send receipt schema | `chat.type` literal `"private"`; `targetId` positive digits | Cannot address negative group chat ids | Outbound group send deferred (no spam) |
| Telegram login callbacks | Private-only confirm | N/A | Must stay private-only |
| `server/channels/kapso.ts` parse | Ignores `is_group` / `type === "group"` | Hard-drop groups | No shared detect helper; WA mention/participant signals not normalized |
| Kapso send | `recipient_type: "individual"` | No group JID send | Deferred with G03 |
| `channel_identity` | Unique `(channel, installation_id, sender_id)` | No chat/thread column | Group conversation must not invent a second sender row; bind actor identity + group scope |
| Blueprint | Private workspaces first | Group-chat disabled until membership/approval proved | `docs/companion-blueprint.md` |

## Decision

1. **Detect** Telegram `group`/`supergroup` and Kapso group flags through `server/channels/group-policy.ts` (Effect-safe pure helpers + binding Effect).
2. **Ingress policy (no spam):** Telegram group messages are accepted **only** when the bot is `@mentioned` or the message replies to the bot. Bare group chatter stays `[]`. Kapso/WA groups remain closed until provider mention signals exist (G03).
3. **Identity bind skeleton:** `bindGroupChannelIdentity` maps a linked private `channel_identity.id` + group `chatId` to `conversationScope = group:<channel>:<installation>:<chatId>` and `deliveryTargetId = chatId`. **No schema migration / DB writes** in G01.
4. **Inbound coordinates** gain optional `chatKind` + `chatId`. Private events set `chatKind: "private"` and `chatId` to the private peer id. Login `/start`/`/confirm` never mint from group scope.
5. **Out of scope here:** live group e2e (G03), shared group memory (G02), outbound group sends, Kapso group acceptance, membership/admin grants.

## Alternatives considered

- **Keep hard-drop forever until full membership model:** rejected — blocks mention-gated foundation and identity-scope design proofs.
- **New `channel_identity` row per group chat:** rejected — would conflate conversation scope with actor identity; blueprint keeps sender identity `(installation, provider, external sender ID)`.
- **Accept all group messages then filter downstream:** rejected — spam risk and contradicts blueprint “disabled until properties proved.”

## Follow-ups

- **G02** shared-memory / workspace membership for group scopes (policy + stub landed in `adr-g02-groups-memory-policy.md`).
- **G03** see `adr-g03-groups-live-e2e.md` (TG harness/live; Kapso open-if-mention; WA gap).
- Outbound WA group JID send still deferred after G03.
- Principal `conversationId` currently equals `identity.id` (private); group delivery must switch to `conversationScope` when enqueue is wired.
