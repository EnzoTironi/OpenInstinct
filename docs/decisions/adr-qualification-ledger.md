# Qualification ledger

Status: fixture and CI contracts for P08. Live Google, Telegram,
WhatsApp, Vaultwarden, Synapse, Kernel, Spark and closed-beta load remain
blocked. This ledger is not launch approval.

Date: 2026-09-15.

Builds on: [launch validation](zoen-launch-validation.md),
[Executor discovery](adr-skill-proposals-and-dependencies.md),
[Vaultwarden](adr-vaultwarden-delegation.md),
[WhatsApp bridge](adr-whatsapp-user-bridge.md),
[account deletion](adr-account-deletion.md),
[customer-platform release](adr-customer-platform-release.md).

## Decision

Generate the advertised-tool inventory from the Executor catalog names
and join each row to a fixture proof. Discovery after publishing a skill
must return that skill. Fixture passes never become live passes.

Three evidence kinds stay distinct: deterministic contract tests,
PostgreSQL integration, and live journeys with a user, model and provider.
`pnpm eval:list` proves a case is discovered. It does not grade a model.
Launch receipts count unique scenarios separately from executions and keep
`liveDeliveries` at zero for synthetic traces.

The closed-beta envelope (25 active users, five concurrent agent tasks,
burst of ten, 30-minute load, 24-hour soak, API p95 1 s, queue p95 10 s)
is declared and unmeasured. Insufficient quota is not a pass.

Live Mem0, Matrix, Vaultwarden and mautrix stay fail-closed. Observability
keeps enterprise dashboards in-workspace, redacts credentials including
TOTP seeds, and scans exports for planted canaries. No onboarding
collection step is added. A controlled production alert was not fired.

Spark versus Luna was not compared: this environment has no authorized
Codex Spark connection. Luna remains the baseline.

## Alternatives rejected

- Copying fixture passes onto OP01–OP08 live rows.
- Adding launch evals that would run against missing models or Kernel and
  fail CI.
- A second agent loop or evaluator beside Eve.

## Evidence

`server/qualification/inventory.ts` is the joined ledger.
`tests/qualification-inventory.test.ts` and
`tests/runtime/qualification.integration.ts` prove completeness, no live
passes, skill rediscovery and fail-closed providers.
