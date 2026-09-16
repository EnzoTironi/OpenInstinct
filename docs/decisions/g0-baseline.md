# G0 baseline — current main, live door, protected targets

Date: 2026-09-15. Gate: G0 (P00). Status: adopted for the first implementation
slice. This is not live qualification of memory, Gmail, WhatsApp, or the
P04–P10 replacement cut.

Builds on the Zoen + Operon plan. Does not reopen Mem0 coexistence.

## Current source

| Item                   | Value                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Repository             | `github.com/enzotironi/tryzoen`                                                                                                   |
| Branch recorded        | `main`                                                                                                                            |
| Commit                 | `07b32839f346c1e37534f714699c74c4de9019d9`                                                                                        |
| Message                | Merge P07 full deletion onto main                                                                                                 |
| Operon extract peer    | `github.com/enzotironi/operon` @ `ec7f26386171d2eec24cf49eb425e22fa9b82fcf`                                                       |
| Vellum source material | `github.com/vellum-ai/vellum-assistant` @ `4f7c8744acb4d7f4f7c6e8f1eacdf90538dfac2f` (MIT). Algorithms/tests only; not a runtime. |

The supplied zip snapshots used in planning are not this commit. Treat this SHA
as the implementation baseline. No historical review is live proof.

## Adopted product decisions (G0)

- One product: Zoen (Eve + Executor + Next + Effect). Operon enters as
  `packages/operon` (`@zoen/operon`), not a second authenticated service.
- **Live proof door:** authenticated `/chat` on the same application
  PostgreSQL. Telegram and WhatsApp share the existing channel contract; they
  do not block this slice.
- Release-scope names A–D in the plan are not the spec's A–F fatias. G0 is
  door + toolchain + setup, not the kernel cut.
- Compile-time section recall lives in `@zoen/operon` (`src/recall`). It is not
  a production memory writer and is not mounted in `server/runtime.ts`.
- Forget unit (for G1, not this slice): retract claim/remember and bump epoch
  `(userId, workspaceId)`. Deleting a source or account is a different act.
- Sentinel is a host/Executor intercept on audience crossing, not an
  Eve-invocable tool. It is out of G0.

## What `@zoen/operon` must not import or start

Cell / Alchemy cell, MCP stdio, cell-auth, CLI `--workspace` snapshot JSON,
Generated UI, mission scheduler, provider dispatch, package migrators /
DDL-on-connect. The legacy `server/operon` MCP adapter stays until P10 removes
it with Mem0.

## Source / authority inventory (today)

| Authority                     | Owner today                        | G0 change                      |
| ----------------------------- | ---------------------------------- | ------------------------------ |
| Accounts, memberships, grants | Zoen host (Better Auth + PG)       | Unchanged                      |
| Turns, sessions, cancellation | Eve                                | Unchanged; `/chat` is the door |
| Learned memory                | Mem0 via `LearnedMemory.layer`     | Unchanged (removed in P10)     |
| Workspace ontology            | Git `ontology/workspace.json`      | Unchanged (removed in P10)     |
| Domain types / OCC store      | `@zoen/operon` (new, compile-only) | Added; not a writer            |
| Message outbox                | Existing messaging schema          | Unchanged                      |
| Operon MCP / `operon.lock`    | Legacy bridge                      | Not the embedded package       |

## Protected targets — never reset or wipe

These are not disposable development databases. A failed migration must not
fall back to reset.

| Kind                                          | Identity                                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Hosted app PG                                 | `open_instinct_prod` on Fly `companion-pg-prod` (machine `48e7799a470d28`, volume `vol_re1kyz6p1q5el734`) |
| Hosted web                                    | Fly `companion-tironi`, hostname `zoen.tironi.xyz`                                                        |
| Hosted Mem0                                   | Fly `zoen-memory-tironi`                                                                                  |
| Hosted Matrix / WhatsApp bridge / Vaultwarden | `zoen-matrix-tironi`, `zoen-whatsapp-tironi`, `zoen-vault-tironi`                                         |
| Pilot credentials                             | Live Google, Telegram, WhatsApp, and other provider accounts already paired                               |

## Disposable targets (explicit only)

`companion_runtime_test` (runtime/CI), local Compose `open_instinct`, Alchemy
stages `open_instinct_local` and `open_instinct_dev`. Staging/prod Alchemy
names are not implied deletion targets. The executable allowlist is
`server/database/reset-target.ts`.

## Provider / license / processor register (G0)

Prerequisites to start, not completed reviews:

- Google OAuth and Gmail restricted-scope assessment: open (P12 / P30)
- Kapso vs personal WhatsApp bridge policy: open (P13 / P30)
- Model processors and data-boundary review: open (P30)
- Operon MIT notices retained on extracted files
- Book figures/assets: not redistributed

Enzo still confirms live-account authorization, measurement procedure, and
J1 baseline effort. See [J1 canvas](j1-decision-canvas.md).
