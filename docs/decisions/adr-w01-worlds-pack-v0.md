# ADR: W01 Worlds pack v0 (Operational Ontology OS skeleton)

- **Status:** Accepted (skeleton only)
- **Date:** 2026-09-10 (America/Sao_Paulo)
- **Decision:** **proceed** with a minimal Worlds ontology pack under
  `shared/ontology/`, wired into Companion via a no-op registration layer that
  does **not** change default private chat behavior.
- **Worker:** W01-WORLDS — pack load/validate + ADR (not Foundry/Funnel/Zep)

## Context

Zoen constitution frames an Operational Ontology OS with Language / Engine /
Security planes. Worlds is the first ontology pack (tenancy / semantic cell),
not a product ceiling. Companion remains a standalone assistant; Zoen authority
stays optional and connector-shaped (`docs/companion-blueprint.md` P15). B2B R2
needs a typed pack seam with MCP, receipts, and erasure extension hooks so later
workers do not invent a second substrate.

## Inventory (verified on `origin/main` @ a30730b)

| Surface                       | Behavior before W01                                       | Gap                                          |
| ----------------------------- | --------------------------------------------------------- | -------------------------------------------- |
| `shared/`                     | Identity, chat, schedules, vault — no ontology pack types | No nouns/verbs / pack manifest               |
| Companion `server/runtime.ts` | Messaging/channels/memory layers only                     | No pack registration hook                    |
| MCP / receipts / erasure      | Messaging receipts + account privacy paths exist          | No ontology-scoped extension slots           |
| Blueprint P15 Zoen connector  | Explicitly deferred / optional                            | Must not import unfinished Zoen engine day-1 |

## Decision

1. **Pack location:** `shared/ontology/` — Effect Schema types for nouns/verbs,
   pack manifest, plane ids (`language` \| `engine` \| `security`), and hook
   slots (`mcp`, `receipts`, `erasure`).
2. **Worlds pack v0:** Manifest id `worlds` / version `0` with skeleton noun
   `world` and verb `inspect`. Declares all three planes and all three hooks.
   Hook implementations are intentional **no-ops**.
3. **Validate/load:** `validateOntologyPack` / `loadOntologyPack` enforce schema,
   required planes/hooks, unique noun/verb ids, and verb→noun references
   (Effect-safe, no I/O).
4. **Companion wire-up:** `worldsPackRegistrationLayer` is merged into
   `server/runtime.ts` infrastructure. Registration only records the loaded pack
   in-process. It does **not** add Eve tools, change channel ingress, or alter
   messaging receipts — private chat defaults stay unchanged.
5. **Out of scope:** Foundry OMS/OSS, Funnel indexing/writeback, Zep memory,
   domain product packs, shared Zoen authority DB, live MCP discovery.

## Alternatives considered

- **Import Zoen packages day-1:** rejected — blueprint keeps Zoen as an optional
  connector; unfinished ontology engine must not become Companion's kernel.
- **Defer all ontology types until P15:** rejected — B2B R2 needs a stable pack
  seam for MCP/receipts/erasure without rework.
- **Register via Eve tools / channel policy:** rejected — would change private
  chat behavior; v0 must be load-only.

## Consequences

- Companion boots with Worlds pack v0 validated or fails closed (`Effect.orDie`
  on invalid pack — programmer error).
- Future packs reuse `validateOntologyPack` and may replace no-op hooks without
  relocating the seam.
- C02 SSO/audit/erasure and P15 Zoen connector can bind to the reserved hook
  slots rather than inventing parallel registries.

## Follow-ups

- Bind real erasure policy to `hooks.erasure` (C02) without changing pack id.
- Optional Zoen connector (P15) may project external receipts into
  `hooks.receipts` while keeping authority outside Companion.
- Domain packs (beyond Worlds) remain separate manifests — Worlds is not the
  product ceiling.
