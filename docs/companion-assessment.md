# Companion fork assessment

Date: 2026-09-08. Source baseline: `Merit-Systems/OpenInstinct` commit
`5fb62c47bdb4082d4b91ef284155359207beb4d2`.

## Decision

Use this private copy as the implementation candidate. Preserve the working
application and Eve framework, then prove one complete messaging journey before
expanding. This is a standalone companion; Zoen ontology comes later through an
optional API/MCP connector, without a shared database or required World.

The target is a self-hostable service for multiple users, starting with WhatsApp
through Kapso and Telegram. Paid model APIs are acceptable initially. Using a
user's ChatGPT subscription is a later execution option. One generic agent serves
all use cases; segment-specific examples belong in evals rather than new handlers.

This is a source assessment, not a running-service qualification. No dependencies,
models, channels, migrations or deployment were executed for this assessment.

## Repository provenance

- Private repository: https://github.com/EnzoTironi/OpenInstinct
- Public upstream: https://github.com/Merit-Systems/OpenInstinct
- Local baseline: `/Users/enzotironi/openinstinct`
- Assessment worktree: `/Users/enzotironi/openinstinct-wt/fork-assessment`
- `main` preserves the upstream commit and its ancestry. Assessment work uses
  `codex/fork-assessment`; `origin` is private and `upstream` is public.
- GitHub does not allow a public repository's native fork to be private. This is
  an independent private repository with preserved Git history, not a member of
  GitHub's fork network. Upstream updates remain available through Git fetch/merge.
- Preserve `LICENSE` (MIT, Merit Systems) and `THIRD_PARTY_NOTICES.md`.
- GitHub Actions is disabled during assessment. The copied workflow runs install
  and checks; review dependency execution and establish the baseline before
  enabling it. No deployment was configured.

## What we have

The repository is a single Next.js application with an Eve agent, Drizzle/Postgres
application data, Better Auth, Google Workspace tools, scheduled jobs, memory,
web chat and a Kernel browser subagent. This is useful product code, not a blank
agent scaffold. The manifest already requests Eve 0.49, Next 16 and Node 24;
upgrading package numbers is not the primary modernization task.

The strongest reuse candidates are web account/task views, existing ownership
checks, Google tool behavior, scheduling leases/reporting, reply-target semantics,
and the eval corpus. Their existence does not establish production reliability.
Ripwire reported no resolved dependency cycles, but many symbols were unconnected
in its graph; this is orientation evidence, not proof of correct boundaries.

## Required change map

| Area | Current source evidence | Intended change | Acceptance evidence |
| --- | --- | --- | --- |
| Identity and onboarding | `db/services/auth/index.ts` sends OTP through Linq; `agent/channels/eve.ts` expects a phone number and has a local benchmark identity path | Keep account/session machinery; introduce verified channel identities linked to a stable user. Telegram must not require a phone number. Account linking must prove control of both identities. Remove privileged local identity paths from the product | Two real accounts cannot read, link, approve or deliver into each other's sessions; revoked/unlinked identities lose access |
| Messaging | `agent/channels/linq.ts`, `db/services/auth/linq.ts`, `agent/lib/linq-image-artifact/` | Native Eve Telegram channel if its installed contract fits; Kapso adapter at Eve's channel boundary. Update text, attachments, reply targets, status and auth delivery together | Verified webhook, durable dedup before ACK, duplicate/reordered events, restart, attachments, cancellation and outbound timeout with explicit unknown delivery |
| Runtime and hosting | `next.config.ts` uses `withEve`; `compose.yaml` provisions only Postgres; `turbo.json` has Vercel-specific deployment/environment assumptions | Keep Eve as loop/session owner. Add documented Node/container startup, durable workflow backend and proxy routes, migrations, health checks and shutdown. Verify the workflow backend against the exact Eve version | Fresh-host setup, process restart during work, scheduler recovery, two workers without duplicate external effects, backup/restore |
| Models | `agent/agent.ts` calls `getGatewayModel`; `db/services/settings.ts` stores Gateway-style model IDs | Direct model-provider configuration and a supported model allowlist with user budgets. Gateway can remain an optional deployment choice | Real tool call and streamed turn; cancellation, provider errors, token/cost accounting and limits |
| Memory and artifacts | `agent/memory/profile.ts` uses Vercel Blob outside local memory; installation secrets and image routes also import Blob | Durable self-hosted memory/object storage through existing framework interfaces where available. Explicit installation keys; no process-local production fallback | Two-user isolation, restart persistence, artifact authorization/expiry, correction and deletion, restored data decrypts with restored keys |
| OAuth/integrations | `shared/google-workspace/connection.ts`, `agent/lib/google-workspace/client.ts` and workspace UI use Vercel Connect | Retain Google tool behavior; supply independently hosted grant/token lifecycle. Connect remains optional, not a mandatory self-host dependency. Start with Calendar scopes and add Gmail when needed | Real consent, callback ownership, concurrent refresh, revocation, reconnect and failed-grant handling |
| Browser/computer | `agent/subagents/browser-agent/lib/kernel.ts`; `shared/environment/env.ts` requires `KERNEL_API_KEY` globally | Make browser capability optional so messaging can start without Kernel. Evaluate another backend only when browser journey is measured. Full computer/CLI access is a separate capability, not implied by browser support | Browser-disabled boot; later real per-user sandbox lifecycle, isolation, file persistence, secret boundaries and cleanup |
| Schedules and proactive delivery | `db/services/scheduled-agent-jobs.ts`, `db/services/scheduled-agent-run-leases.ts`, `agent/channels/scheduled-run.ts`, `agent/lib/schedules/report-lifecycle.ts` | Reuse leases/report semantics; adapt channel targets, time zones, opt-out and delivery recovery. WhatsApp delivery must respect the channel's current template/window rules | Cancel/reschedule race, expired lease, restart before/after dispatch, DST and opt-out suppressing queued delivery |
| Product and quality | Existing web chat, vault, tasks and evals; source tests include imported-module mocks | Preserve useful UI; prioritize chat onboarding and account/connections controls. Rebrand after the complete journey works. Add real DB/HTTP/channel evidence alongside pure tests | Same tasks, model and environment for comparisons; task success, first useful response, completion latency, cost, unnecessary confirmations and unwanted proactive messages |

The two phone assumptions in identity are important: merely adding a Telegram
webhook leaves web authentication and account ownership tied to iMessage.
The personal workspace in `shared/identity/access-scope.ts` is derived from the
principal, making canonical identity essential before linking channels. Internal
scheduled routes currently use `vercelOidc()`/`localDev()` and need real service
authentication outside Vercel. Their timeout/reset path requires an ambiguous-effect
recovery test before enabling automatic retries.

Similarly, replacing only the profile-memory provider does not remove Blob:
installation keys and artifacts must move coherently.

## Dependency decisions

1. Keep Eve 0.49 as the initial candidate and its current lockfile for baseline
   reproduction. Do not add a second custom agent loop or rewrite the repository
   into Effect simply to match Zoen. New runtime APIs must follow installed docs.
2. Keep Better Auth, Postgres/Drizzle, existing Google clients and UI where they
   satisfy the changed contracts. Prefer existing native Eve integrations over
   custom infrastructure.
3. Vercel Connect is a managed service; installing its npm client does not make
   its token broker self-hosted. A replacement needs refresh/revocation and tenant
   ownership, not just an OAuth callback.
4. Rivet remains a candidate, not a selected dependency. The prior package-source
   audit found `@rivet-dev/agentos-eve@0.2.19` declares Eve >=0.27 <0.28 and its
   returned JS handle lacks `stop` and `delete` required by Eve 0.49. Do not force
   peers or downgrade solely for this adapter. Verify an updated implementation
   with actual create/write/capture/shutdown/reopen/stop/delete and isolation tests.
   The inspected adapter also rejects prewarming/templates, so bootstrap and seed
   requirements must be checked. Rivet World compatibility requires a separate check.
5. Audit both patches before dependency changes. `patches/eve@0.49.0.patch` touches
   bundled Linq declarations/JS, Chat declarations, the Eve channel and package
   exports; removing Linq alone is not sufficient evidence to delete the patch.
6. Defer BYO ChatGPT, payments, arbitrary user MCP/CLI execution and a marketplace
   until identity, durable execution and permission controls are proved. An OSS
   login helper alone does not qualify a supported hosted execution path.

## Proposed implementation packages

This assessment does not start implementation. The packages below describe the
next work, rather than completed or currently running changes.

Each package must compile and have its own acceptance evidence before integration.
Do not create parallel replacement implementations for the same runtime concern.

1. **Reproduce baseline and close framework questions.** Review install scripts;
   frozen Node 24 install; run existing checks/build against isolated disposable
   services; record failures unchanged. Prove Eve non-Vercel startup and compatible
   workflow/storage/provider choices with a real turn and restart. Resolve the
   patches. This is the go/no-go gate for the fork as the base.
2. **Independent hosting and identity.** Container/runtime configuration,
   migrations, keys, stable users and verified channel linking. Remove mandatory
   Linq phone/Kernel dependencies from boot. Test ownership through HTTP and PG.
3. **Telegram complete journey.** Receive a private message, remember a preference,
   connect Calendar, inspect availability, approve one event, schedule a reminder,
   reschedule/cancel and survive restart. Exercise framework-native approvals
   before designing a custom one. Account-linking precedes cross-channel memory.
4. **Kapso/WhatsApp on the same runtime.** Reuse the exact identity, memory, tools
   and scheduler. Add channel-specific verification, templates, media and delivery
   rules. Real configured number/provider access is required for channel proof.
5. **Companion quality and operation.** Voice notes, useful proactive behavior,
   correction/forget controls, disconnect/delete, quotas, observability and failure
   recovery. Run comparable generic eval journeys for multiple user contexts.
6. **Expand only after measured success.** Browser/computer candidate, user MCP/CLI
   grants, BYO ChatGPT and optional Zoen connector. Each has a separate capability
   and operational acceptance gate.

Do not estimate a delivery date until package 1 establishes how much of the
framework's self-host path works for this exact application. A successful frozen
build alone is insufficient: the deciding spike is a real authenticated turn,
persistent memory and a scheduled operation surviving restart without Vercel.

## Evidence and open questions

Completed: full-history clone of upstream main; source/manifest/workflow/license
inspection; architecture map; confirmed private GitHub visibility and remote main
SHA; documented the change map. No application code has been modified.

Not yet proved: frozen install/build/tests, live Postgres behavior, workflow-world
compatibility, provider calls, channel delivery, multi-user security, sandbox
isolation and recovery. Existing mock-based tests are useful regression evidence
but will not count as proof of the external behavior they replace.

Further implementation reads should start with the exact installed Eve docs for
self-hosting, custom/native channels, security, memory and workflows. Prior
research reference: https://github.com/vercel/eve/blob/main/docs/guides/deployment/self-hosting.md
and https://github.com/vercel/eve/blob/main/docs/channels/telegram.mdx.
The standalone requirements/research already recorded under
`/Users/enzotironi/eve/docs/` remain preserved; this assessment specializes them to
the cloned application rather than importing the unfinished Zoen implementation.
