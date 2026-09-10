# Companion R2 ops checklists

Operator-facing checklists for remaining Release-2 (R2) ops toward 100%.
**Enzo executes secrets / Meta / DNS / live Telegram group actions.** Workers ship
docs and scripts only — never secret values in git, PRs, logs, or chat.

| ID  | Checklist                                                                  | Owner             |
| --- | -------------------------------------------------------------------------- | ----------------- |
| O01 | [Credential rotation (F01)](credential-rotation.md) — names, order, verify | Enzo (secrets)    |
| O02 | [WhatsApp Meta + Kapso activation](whatsapp-meta-activation.md)            | Enzo (Meta/Kapso) |
| —   | [Enzo live blockers](enzo-live-actions.md) (DNS + G03 Telegram group)      | Enzo only         |

Related:

- [Self-host / ops](../self-host.md)
- [Durable ingress (D01)](../../infrastructure/ingress/README.md)
- [Kapso path ADR](../decisions/adr-kapso-path-r1.md)
- [G03 groups live e2e ADR](../decisions/adr-g03-groups-live-e2e.md)
- [Ops ADR O01/O02](../decisions/adr-o01-o02-ops-r2.md)
