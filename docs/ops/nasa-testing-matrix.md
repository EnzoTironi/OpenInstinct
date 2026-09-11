# NASA-level testing matrix (OpenInstinct)

Campaign branch: `test/nasa-battery` (separate from complexity/lint ultracite work).

## Goals

| # | Track | Script / gate | Target |
| --- | --- | --- | --- |
| 1 | Effect health | `pnpm agent-doctor` | **100/100** (no toml silencing of `prefer-effect-fn` / `max-function-parameters`) |
| 2 | Unit + integration | `pnpm test:app`, `pnpm test:runtime` | Green; `@effect/vitest` `it.effect` + Layers (no `vi.mock`) |
| 3 | Coverage | `pnpm test:coverage` / `pnpm test:coverage:report` | **100%** lines/functions/branches/statements on scoped prod source |
| 4 | Declarative titles | suite-wide | `does X` / `does X if Y` (not `should X`) — treat tests as behavior blueprint |
| 5 | Mutation | `pnpm test:mutation` (Stryker) | High score on channels, messaging, billing, auth |
| 6 | Chaos | `pnpm test:chaos` | Deterministic fault injection (DB down, webhook delay/dup, Effect interrupt, outbox poison, clock skew) |
| 7 | E2E | Playwright (expand) | welcome/get-started, auth, vault, chat, channel connect — fixtures when secrets unavailable |

## Coverage scope

**Include:** `agent/`, `app/`, `server/`, `db/`, `web/`, `shared/` production TS/TSX.

**Exclude:** `*.test.*`, `*.integration.ts`, `**/tests/**`, `tools/oxlint/anti-slop/**`, `scripts/**`, `evals/**`, `infrastructure/**`, `web/components/ui/**`, `web/components/ai-elements/**`.

Thresholds live in `vitest.config.ts`. Baseline (non-gating) report: `pnpm test:coverage:report` → `coverage/coverage-summary.json` + HTML. Committed snapshot: `docs/ops/coverage-baseline.md`.

## Inventory (starting point)

- **Vitest projects:** `test:app` (`vitest.config.ts`, maxWorkers 2), `test:runtime` (`vitest.runtime.config.ts`, `tests/runtime/*.integration.ts`, serial).
- **CI:** `.github/workflows/checks.yml` → `pnpm check` (lint/types/test/format/knip) + runtime Postgres job (`pnpm test:runtime` + build).
- **Playwright / e2e:** not yet a first-class package script — expand in later commits.
- **Mutation / chaos:** scripts stubbed; configs land in follow-up commits on this branch.

## Execution order

1. Restore agent-doctor 100 (Effect.fn + options objects) ✅
2. Coverage tooling + baseline report ✅ (this commit)
3. Declarative rename pass (suite already mostly declarative; sweep remaining)
4. Fill coverage to 100% package-by-package (prefer TestServices / Layers)
5. Stryker on critical packages + CI path (gate or document)
6. Chaos harness + seeds
7. Playwright journeys + fixtures

## Constraints

- Ultracite / oxlint complexity ≤ 6, agent-doctor 100, react-doctor 100.
- Never print secrets; use `.env.*.proof*` / fixtures only.
- Anti-slop `no-module-mocking` ON — dependency injection / Layers only.


## Baseline snapshot (2026-09-11)

See [`coverage-baseline.md`](./coverage-baseline.md).

| Metric | Before fill |
|--------|-------------|
| Statements | 43.57% |
| Branches | 38.47% |
| Functions | 37.8% |
| Lines | 44.53% |

Declarative titles: suite already uses behavior-style names (`does`/`keeps`/`rejects`/`…`); no `should X` title sweep required beyond ongoing new tests.
