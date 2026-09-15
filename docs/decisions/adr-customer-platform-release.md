# Customer-platform release

Status: documentation for the P01–P08 stack. This is not launch
approval, Alchemy publication, or a live-provider pass.

Date: 2026-09-15.

Builds on: [launch validation](zoen-launch-validation.md),
[qualification ledger](adr-qualification-ledger.md),
[Google identity](adr-google-identity-and-messengers.md),
[skill proposals](adr-skill-proposals-and-dependencies.md),
[Vaultwarden](adr-vaultwarden-delegation.md),
[WhatsApp bridge](adr-whatsapp-user-bridge.md),
[account deletion](adr-account-deletion.md).

## Decision

Publish what this stack can prove, and keep pending live rows blocked.
An integration is available to pilots only when its live acceptance line
is recorded. Fixture and CI evidence do not become live passes. This
checkout is not “prod-ready”. REL03 columns below are installed,
fixture-tested, live, and missing proof.

| Surface                  | Installed         | Fixture / CI              | Live                                                                      | Missing proof                       |
| ------------------------ | ----------------- | ------------------------- | ------------------------------------------------------------------------- | ----------------------------------- |
| Google sign-in           | Yes               | PostgreSQL + Better Auth  | Existing-account round trip is on the deployed launch SHA, not this stack | New invitee, Gmail/Calendar consent |
| Google Workspace tools   | Yes               | Team connection tests     | Blocked                                                                   | Interactive OAuth on this SHA       |
| Telegram bot             | Yes               | Webhook fixtures          | Group isolation fixture, not actual delivery                              | Real group reply on this install    |
| WhatsApp Kapso bot       | Yes               | Auth fixtures             | Historical DM on launch SHA                                               | Ordinary groups; templates          |
| WhatsApp user bridge     | Envelope only     | Pairing tests             | Blocked                                                                   | mautrix pair, real group, send      |
| Vaultwarden              | Envelope only     | Delegation tests          | Blocked                                                                   | Live vault, TOTP site               |
| Matrix / A2A             | Yes               | CI has Synapse            | Blocked here                                                              | Two people, two bots                |
| Mem0                     | Yes               | Learned-memory tests      | CI service, not a user journey                                            | Live forget/recall journey          |
| Executor skills          | Yes               | Publication + discovery   | Blocked                                                                   | Use and revoke in three live scopes |
| Customer tool code       | Yes               | QuickJS + Git + local UI  | Not a provider pass                                                       | Remote connectors and native evals  |
| Account UI wipe          | Yes               | Honesty tests             | Partial by design                                                         | Must not be sold as full deletion   |
| Account erasure          | Yes               | PostgreSQL deletion tests | Pending Mem0/Matrix/Vaultwarden/mautrix/backups                           | Live provider purge                 |
| Browser / Kernel         | Yes               | Launch eval listed        | Blocked                                                                   | `eval:ci` / Kernel on this SHA      |
| Closed-beta load         | Envelope declared | Unmeasured                | Blocked                                                                   | OP01–OP03                           |
| Alchemy deploy           | Workflow exists   | Not run here              | Blocked                                                                   | REL02 images/digests/health         |
| Beeper Desktop           | No                | —                         | Unavailable                                                               | Not installed                       |
| iMessage / paid checkout | No                | —                         | Unavailable                                                               | Out of this stack                   |

## Identity

Google creates the canonical Zoen user. An unknown Telegram or WhatsApp
sender does not create a user or workspace; the webhook stores a pending
address and asks for Google sign-in plus an Account link. Linking is a
confirmed, single-use challenge bound to the authenticated browser
session. A messenger already owned by someone else is a conflict, not a
merge. Ordinary onboarding has no merge screen. Accounts that a
channel-first contact created before this rule join a Google user only
through the explicit archive path. That remaining split is not
“future consolidation” of normal sign-in, and it is not a live pass
for this SHA.

## Tool publication

Skills are Markdown in the workspace Git bundle. A member can draft
`proposals/skills/<slug>.md`; an admin publishes `skills/<slug>.md` in
the same commit. Rollback is a later revision. `requires:` lists catalog
paths; discovery re-reads the catalog. Publishing a skill does not grant
new permissions. Bounded customer tool code now uses content-versioned IDs and the same
Executor catalog, with validated publication and current authorization.
See [customer tools](adr-customer-tools.md). Remote MCP/OpenAPI registration
remains unavailable. Mutations still require their native Eve action and
approval boundary.

## Data policy

`GET /api/account/export` and `POST /api/account/delete` remain a
partial personal-memory export and `partial_online_wipe`. They do not
erase history, artifacts, identities, backups or the user row.
`POST /api/account/erasure` is the durable Zoen-controlled deletion: suspend,
revoke, erase the personal workspace, keep company workspaces, write a
tombstone. Live Mem0, Matrix, Vaultwarden, mautrix and backups stay
`pending_external`. The last company admin must transfer or close
companies first. Diagnostics default to correlation without content.
[PRIVACY.md](../../PRIVACY.md) and [TERMS.md](../../TERMS.md) must keep
that distinction.

## Gates on one SHA (REL01)

Required commands, in this repository:

```sh
pnpm install --frozen-lockfile
pnpm --dir infrastructure install --frozen-lockfile
pnpm check --concurrency=1
pnpm build --force
pnpm db:check
pnpm eval:list
```

`pnpm test:runtime` needs `companion_runtime_test` and must never use
production. This authoring VM has no Synapse, so
`matrix-rooms.integration.ts` stays unavailable here; CI provides it.
`pnpm eval:list` is `eve eval --list`. `pnpm eval:ci` runs
`scripts/run-agent-evals.ts`, which defaults to `--suite launch`.
`.github/workflows/zoen-agent-evals.yml` runs that suite on `main` with
`--repeat`. Listing without those files selected is not a pass.
`eval:ci` was not executed for this SHA.

## Publication and recovery (REL02)

Production uses the Zoen infrastructure GitHub workflow and Alchemy, not
Eve's generic deploy. `ZOEN_RELEASE` must be the full tested Git SHA.
[Infrastructure](../../infrastructure/README.md) records image digests,
isolated recovery and health checks. A previous recovery drill is
[dated 2026-09-13](../ops/zoen-alchemy-recovery-proof.md) on a different
revision. This PR does not publish. Recovery, image digests and
post-deploy health stay blocked until a later SHA records them.

## Provider limits

Provider subscriptions, terms and quotas still apply. Fail-closed
`requireVaultwarden` and `requireWhatsAppBridge` are not activation.
Ordinary WhatsApp groups are not enabled by the current Kapso Cloud API
setup. Telegram group support is being qualified and is not a live
delivery on this install. Closed-beta admission uses
`ZOEN_REGISTRATION_MODE=closed` and `ZOEN_BETA_IDENTITIES`. Installation
quotas in `server/operations/quotas.ts` are declared, not a measured
load pass.

## Dependabot

Product CI is independent of Dependabot. On 2026-09-14:

- [`github_actions` in `/`](https://github.com/EnzoTironi/tryzoen/actions/runs/34887658616)
  succeeded.
- [`npm_and_yarn` in `/`](https://github.com/EnzoTironi/tryzoen/actions/runs/34887658505)
  created PRs, then failed on `@workflow/world-postgres` (`unknown_error`).
- [`npm_and_yarn` in `/infrastructure`](https://github.com/EnzoTironi/tryzoen/actions/runs/34887659081)
  created PRs, then failed while processing `alchemy`
  (`Dependabot::SharedHelpers::HelperSubprocessFailed`; summary
  `unknown_error`).

Open Dependabot PRs do not mean automatic maintenance is healthy. Those
jobs are not reclassified as passing and do not invalidate product
Checks that already passed.

## License notices

Keep [LICENSE](../../LICENSE) and
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md). Do not remove
Kernel, anti-slop, Mona Sans or other required notices.

## Alternatives rejected

- Treating P08 fixture rows as live deliveries.
- Activating Vaultwarden, Beeper Desktop or mautrix because the envelope exists.
- Calling the Account UI wipe complete erasure.
- Using `eve deploy` instead of Alchemy.
- A merge screen as ordinary onboarding.

## Correções da revisão de integração

As primeiras entregas foram reavaliadas no conjunto. A publicação de skills agora
reproduz o recibo original após perda da resposta; a participação na empresa
permite contatar bots publicados sem conceder arquivos do projeto; a exclusão
serializa mudanças de administradores por empresa; e o cofre oferece autorização
explícita por item, prazo e revogação na interface existente.

O registro de apagamentos usa um bucket privado distinto do backup PostgreSQL,
provisionado por Alchemy. A intenção é gravada antes da exclusão. Na inicialização,
o processo reaplica esse registro antes de iniciar web e workers. Falha na
reconciliação impede a abertura do serviço. Sem configurar o bucket, novos pedidos
de exclusão completa são recusados. O teste de restauração usa um backup completo
anterior à exclusão, PostgreSQL e S3 reais; a restauração do banco não restaura o
bucket. O journal guarda somente o identificador opaco da conta; não guarda conteúdo.

O sandbox também interrompe CPU mesmo com chamadas pendentes, cancela chamadas
que excedam o prazo e limita execuções simultâneas. Essas correções não substituem
as provas restantes de Vaultwarden, ponte WhatsApp, dois agentes e cadastro geral
de ferramentas descritas no plano.
