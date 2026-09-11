# ADR: R2 ops checklists O01/O02 (credential rotation + WhatsApp Meta)

- **Status:** Accepted
- **Date:** 2026-09-10 (America/Sao_Paulo)
- **Decision:** **proceed** — ship operator checklists under `docs/ops/` for F01 credential rotation (names/order/verify only) and WhatsApp Meta display-name + ≥1 UTILITY template via Kapso; Enzo executes secrets/Meta/DNS/live TG group.
- **Worker:** O01-O02-OPS — branch from `origin/main` (includes #32 / D02)

## Context

R2 engineering slices (Alchemy staging→prod, durable ingress D01, groups G01–G03) landed docs/scripts, but admission still needs human ops: secret rotation hygiene, Meta WhatsApp product gates, DNS for Companion hostname → named tunnel, and live Telegram group membership for G03.

Workers must not print or commit secret values. Meta and DNS require Enzo.

## Decision

1. Add `docs/ops/` checklists:
   - O01 / F01 → `docs/ops/credential-rotation.md`
   - O02 → `docs/ops/whatsapp-meta-activation.md`
   - Enzo blockers → `docs/ops/enzo-live-actions.md`
2. Link from `docs/self-host.md`; keep secrets out of ADRs and PRs.
3. Durable Kapso/Telegram webhook updates remain `pnpm ingress:set-webhooks` (D01 `scripts/set-channel-webhooks.sh`).
4. Do **not** claim R2 100% until Enzo completes Meta display-name, ≥1 APPROVED UTILITY template, DNS→tunnel, and (for live G03) `@ZoenOSBot` group + mention.

## Consequences

- Operators have a single place for rotation order and Meta steps.
- `SECRET_ENCRYPTION_KEY` rotation is explicitly high-risk without re-encrypt.
- Live proof remains Enzo-gated; CI cannot green-wash Meta/DNS.

## Alternatives considered

- **Embed full runbooks in `self-host.md` only:** rejected — file already long; ops checklists benefit from a dedicated folder.
- **Automate Meta template creation in CI:** rejected — requires live secrets and Meta approval latency; Enzo-owned.
