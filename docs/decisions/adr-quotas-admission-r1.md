# ADR: Release-1 minimum quotas / admission (U10)

- **Status:** Accepted
- **Date:** 2026-09-09 (America/Sao_Paulo)
- **Decision:** Ship self-host **minimum quotas** that fail closed with a typed
  Effect error before expensive work; document limits in this ADR and
  `server/operations/quotas.ts`.
- **Worker:** U10 — Release-1 minimum quotas / admission

## Context

P11 (`docs/companion-blueprint.md`) requires per-user and installation budgets
for model tokens, tools, sandbox time, storage and proactive work, plus
concurrency/fairness so one user cannot starve the service. Real-user admission
must not bypass operations gates (`docs/product-direction.md`).

No admission/quota Effect module existed on `origin/main` @ bc139c1. Media
attachment byte caps already live in `server/channels/media/policy.ts` and stay
there.

## Decision

Add `server/operations/quotas.ts`:

1. Named Release-1 limits (`release1QuotaLimits`).
2. `admitQuota(usage, demand)` — pure Effect gate; over-limit →
   `QuotaAdmissionError` with `reason: "exceeded"` (fail closed).
3. `reserveQuota` / `settleConcurrentTurns` — reserve before expensive work,
   settle concurrent turns after completion.
4. Callers supply observed usage (Postgres/metering ownership can land later);
   this slice proves enforcement without inventing dual-write billing.

### Limits chosen (self-host first)

| Scope        | Resource                     | Limit        | Rationale                                        |
| ------------ | ---------------------------- | ------------ | ------------------------------------------------ |
| user         | concurrent turns             | 2            | Fairness; avoids single-user turn storms         |
| user         | daily model tokens           | 500_000      | Bounded LLM spend before operator review         |
| user         | daily tool calls             | 200          | Caps tool loops without blocking normal chats    |
| user         | daily proactive messages     | 24           | ~hourly ceiling; respects notification restraint |
| user         | storage bytes                | 100 MiB      | Memory/artifact growth control                   |
| user         | sandbox active seconds / day | 900 (15 min) | Browser/compute cost bound                       |
| installation | concurrent turns             | 20           | Multi-user headroom under small self-host        |
| installation | daily model tokens           | 5_000_000    | Installation-wide spend ceiling                  |
| installation | active users / day           | 100          | Soft pilot scale before load proof               |

Operators may raise limits later; unlimited usage is not claimed.

## Consequences

- Over-limit work must not proceed; surfaces `QuotaAdmissionError` /
  `quotaFailureMessage`.
- Persistence of usage counters and dispatch wiring are follow-ups; tests prove
  the gate itself.
- Hosted billing/entitlements remain a separate capability (blueprint P11/P14).
