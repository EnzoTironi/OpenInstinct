# ADR: Release-1 Ripwire / architecture structural-debt triage (U11)

- **Status:** Accepted
- **Date:** 2026-09-09 (America/Sao_Paulo)
- **Decision:** **Defer** structural remediations for Release-1. Record a severity ledger only. Do **not** block R1. Do **not** silently relax or write Ripwire quality/arch baselines.
- **Worker:** U11 — Ripwire structural debt triage
- **Tree:** `origin/main` @ `f2dadf944cf433a6caba34f1f16fdb4ef9814228`

## Context

Release-1 still needs a truthful picture of architecture and quality debt without turning that debt into a merge gate or a silent baseline. Prior increments already recorded Ripwire deltas in `docs/local-runtime-setup.md` and `docs/companion-assessment.md` with the explicit rule that findings stay recorded and thresholds are not suppressed.

This ADR consolidates those notes with a fresh read on `f2dadf9` using:

| Lens | Command / source | Result snapshot |
| --- | --- | --- |
| Dependency health | `ripwire . --deps` | `nccd=0.75`, `acd=6.2`, `shape=horizontal`, `dep_files=573` |
| Godfiles | `--deps` `<godfiles>` | Top afferent: `server/runtime.ts` 41, `server/accounts/index.ts` 33, `shared/identity/access-scope.ts` 30 |
| Stable-deps instability | `--deps` `<stabledeps>` | 12 high-gap edges (listing capped in the run) |
| Declared oxlint layers | `tools/oxlint/architecture` + mirrored `--arch` rules | **0** violations (agent/app/db/shared/web only) |
| Proposed agent→server boundary | aspirational `--arch` deny `agent -> server` | **85** new edges; exit 2; **no** `.ripwire_arch_baseline` written |
| Quality panel | `ripwire . --quality-panel=default` | `eligible=1352`, `ranked=36`, `deep_untested=3` |
| Knip | `knip.config.ts` | Intentional ignores for AI Elements / shadcn surfaces |
| Prior documented deltas | `docs/local-runtime-setup.md` | Churn / verbosity / migration-journal findings remain recorded; gate not green |

`server/` is **not** a production layer in `local-architecture/no-forbidden-layer-imports`. Oxlint therefore cannot see agent→server edges. That gap is debt to formalize later, not permission to baseline-suppress an aspirational `--arch` deny.

## Decision

1. **Ship this triage ledger** (docs only). No production code, CI gate, or Ripwire sidecar lands in this PR.
2. **Do not block R1** on any item below. Product path work may proceed while structural debt stays visible.
3. **No silent baseline relax.** Do not commit `.ripwire_arch_baseline`, `.ripwire_quality_baseline`, Knip/oxlint ignore expansion, or threshold edits to make a red Ripwire delta look green. Any future baseline write needs its own reviewed ADR/PR that names absorbed findings.
4. **Keep current oxlint architecture enforcement** for the five declared layers (`agent`, `app`, `db`, `shared`, `web`). It is green on main and remains the only architecture gate in CI.

## Ledger (severity → action)

Severity: **H** = change amplification / wrong-layer risk; **M** = hotspot or policy gap; **L** = recorded noise / intentional ignore; **OK** = healthy signal.

| ID | Severity | Finding | Evidence | Action for R1 | Later fix posture |
| --- | --- | --- | --- | --- | --- |
| RW-01 | H | Coupling density high (`nccd=0.75`; healthy guide `<0.25`) | `--deps` health | **Defer** | Reduce hubs / formalize `server` boundaries; trend `nccd` over releases |
| RW-02 | H | God hub `server/runtime.ts` (afferent **41**) | `--deps` godfiles; 22 of 85 aspirational agent→server edges target it | **Defer** | Split Effect runtime Layers / narrow public surface before new features pile on |
| RW-03 | M | God hubs `server/accounts/index.ts` (33), `shared/identity/access-scope.ts` (30), `server/channels/principal.ts` (20), `server/channels/transport.ts` (17) | `--deps` godfiles | **Defer** | Extract read-only contracts into `shared` where ownership allows |
| RW-04 | H | Agent→server coupling (**85** edges / **28** agent files); oxlint omits `server` layer | aspirational `--arch`; oxlint `productionLayers` | **Defer** (do **not** baseline) | Decide whether `server` becomes a sixth oxlint layer + deny list; fix edges or explicit `allow` with rationale |
| RW-05 | M | Agent→`@db` direct imports (**28** agent files) while Effect slices own persistence in `server`/`db` | ripgrep on `agent/` | **Defer** | Prefer agent→server/shared contracts; avoid new agent→db edges in R1 feature PRs when a server API exists |
| RW-06 | M | Stable-dependency instability (**12** listed high-gap edges), e.g. artifacts barrel→access, messaging barrel→store/input-response, runtime→browser-worker/device/transport | `--deps` stabledeps | **Defer** | Tighten barrels; invert unstable edges when touching those modules |
| RW-07 | L | Prior Ripwire quality deltas (short-horizon churn, CI/Turbo verbosity, migration metadata, queue-factory growth, init-retry duplication) recorded with gate not green | `docs/local-runtime-setup.md` | **Accept recorded / defer** | Fix only when editing those files; never suppress to greenwash |
| RW-08 | L | Lockfile / generated snapshot verbosity called out in foundation notes | `docs/companion-assessment.md` | **Accept recorded / defer** | Generated growth is metadata, not app complexity; keep lockfile intact |
| RW-09 | L | Knip `ignoreIssues` for `web/components/ai-elements/**` and `web/components/ui/**` | `knip.config.ts` | **Accept** (intentional registry surface) | Revisit if chat stops using the registry pattern |
| RW-10 | M | Quality-panel multi-family hotspots (`ranked=36`) including schedules, browser tools, chat UI, evals; `deep_untested=3` | `--quality-panel=default` | **Defer** | Prefer `--quality-delta` on the owning PR over a repo-wide cleanup |
| RW-11 | M | Native-cohort structural delta vs `4b9e378`: six blocking findings (queue factory growth/churn, integration-helper churn, migration-journal growth) + 51 generated new-symbol rows | `docs/local-runtime-setup.md` | **Defer** | No suppression ledger; address when queue/migration owners change again |
| RW-12 | OK | No resolved dependency cycles | `--deps` / companion assessment | **Keep** | Re-check after large graph moves |
| RW-13 | OK | Oxlint `local-architecture/no-forbidden-layer-imports` green for declared layers | mirrored `--arch` → 0 violations | **Keep enforced** | Do not weaken deny map |
| RW-14 | L | Strict quality-panel cut unreachable for TS (confusion/state families C/C++-only) | `--quality-panel=strict` `unavailable=confusion,state` | **Accept tool limit** | Use `default`/`lenient` for orientation; `--quality-delta` for PR gates |

**Count:** **14** ledger items (11 actionable/deferred debt or policy rows + 3 OK/tool-limit rows).

## What this does **not** claim

- Not a security review, production readiness claim, or CI greenwashing.
- Not permission to expand Knip/oxlint ignores.
- Not a mandate to adopt Ripwire `--arch` or `--quality-delta` as required CI in R1 (optional developer self-check remains useful; pair with `--test-gate` when used).
- Not a rewrite plan for Eve, Effect, or messaging.

## Alternatives considered

- **Block R1 until `nccd` / god hubs improve:** rejected — blocks product path without changing user-visible R1 acceptance.
- **Write `.ripwire_arch_baseline` for the 85 agent→server edges:** rejected — that is silent baseline relax of an aspirational rule the repo does not yet enforce.
- **Expand oxlint layers to include `server` and fail CI immediately:** rejected for R1; track as the RW-04 follow-up with an explicit allow/fix plan.
- **Ignore / drop prior Ripwire notes:** rejected — contradicts recorded local-runtime evidence and companion assessment discipline.

## Consequences

- R1 workers continue feature work; they should avoid _new_ unjustified agent→server or hub growth when a thinner boundary already exists, but are not blocked by this ledger.
- Any PR that adds a Ripwire/Knip/oxlint baseline or ignore must cite a ledger ID and justify absorbed findings.
- Follow-up owners (post-R1): RW-02/RW-04 first (runtime hub + `server` layer policy), then RW-01/RW-03 coupling, then opportunistic RW-06/RW-10 on touched files.

## Orch `decisions.tsv` row (copy)

```text
U11	ripwire-triage	defer	2026-09-09T18:40:00Z	Docs-only ledger (14 items) on origin/main@f2dadf9. nccd=0.75; god hub server/runtime.ts afferent=41; aspirational agent→server=85 unbaselined; oxlint five-layer gate green. Do not block R1; no silent baseline relax.
```
