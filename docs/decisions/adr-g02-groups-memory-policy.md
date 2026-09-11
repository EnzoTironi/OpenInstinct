# ADR: G02 shared vs personal memory boundary (group chats)

- **Status:** Accepted (policy + hooks; shared storage stub)
- **Date:** 2026-09-10 (America/Sao_Paulo)
- **Decision:** **proceed** Effect-safe shared-vs-personal memory boundary for G01 `group:<channel>:<installation>:<chatId>` scopes. Group sessions must not freely read personal memory; personal forget/wipe must not poison or leak across group scope. Shared-group memory model is documented with stub storage.
- **Worker:** G02 — memory boundary after G01 merge `@ 01d3148`

## Context

G01 (`adr-g01-groups-foundation.md`) introduced mention-gated group ingress and `bindGroupChannelIdentity` → `conversationScope = group:<channel>:<installation>:<chatId>`. Personal memory today is workspace- scoped (`PersonalMemory` bind/inspect/wipe + Eve `fileMemory` recall). Without an explicit boundary, a future group session minted from a linked private identity could otherwise reuse the same personal recall/bind path and leak unrelated private profile notes into a shared chat, or a personal wipe could be mistaken for erasing group-shared state.

## Decision

1. **Classify** conversation memory kind from `conversationScope` / `chatKind` in `server/personal-memory/group-memory-policy.ts` (Effect-safe pure helpers + admit Effects).
2. **Deny personal surfaces in group scope:** recall/bind/inspect/mutate paths call `admitPersonalMemoryFromSession` before `authorizePersonalMemoryPrincipal` / `PersonalMemory.bind` (`agent/lib/personal-memory-access.ts`, `personal-memory-controls.ts`, `agent/tools/personal-memory.ts`). Failure reason: `PersonalMemoryError` `cross_scope`.
3. **Personal wipe isolation:** `admitPersonalWipeTarget` rejects group conversationScope targets; `PersonalMemory.wipe` remains private-workspace only and reports `neverWiped` including `shared-group-memory`.
4. **Shared-group model (stub):** keys = G01 `conversationScope`; namespace `shared-group-memory`; `readSharedGroupMemoryStub` returns empty projection with `personalProjection: null`. Cross-group reads fail closed via `admitSharedGroupMemoryRead`. No schema migration / persistence in G02.
5. **Session hook:** `groupSessionMemoryAttributes(binding)` is the attribute shape group principals should carry when enqueue wires `conversationScope` (G03 / delivery follow-up).

## Alternatives considered

- **Reuse personal workspace memory inside groups with redaction:** rejected — redaction is not isolation; fail-closed deny is the Release-1 bar.
- **Full shared-group Postgres store in this PR:** rejected — membership/grants and live group e2e are G03 / later workspace work; stub + policy is enough to lock the boundary.
- **Silent no-op on group recall:** rejected — callers must see `cross_scope` rather than empty personal projection that looks like “no memories.”

## Out of scope

- Live Telegram/Kapso group e2e (G03).
- Persisted shared-group documents, membership, or admin grants.
- Outbound group send schemas.
- Changing private `channelPrincipal.conversationId` (still identity id until group enqueue switches to `conversationScope`).

## Evidence

`server/personal-memory/group-memory-policy.test.ts` — negative cross-read, wipe isolation, shared stub emptiness, private regression, G01 bind round-trip.
