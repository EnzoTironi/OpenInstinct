# Local runtime setup and evidence

Status: September 8, 2026. This branch is an implementation increment, not a completed companion release.

Use Node 24 and the pinned pnpm version. Keep secrets in `.env.local`, which Git ignores, and restrict the file to its owner (`chmod 600 .env.local`). Do not paste credentials into tracked examples, test fixtures, review descriptions, or logs.

## Credential readiness

| Variable             | Current use                                       | Verification                                                                                                                                         |
| -------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KERNEL_API_KEY`     | Existing browser worker, loaded only when invoked | Authenticated browser-list request returned HTTP 200. No browser session was created.                                                                |
| `TELEGRAM_BOT_TOKEN` | Reserved for the planned Telegram channel         | `getMe` confirmed ZoenOSBot; `getWebhookInfo` reported an existing webhook and zero pending updates. Channel is not yet wired into this checkout.    |
| `KAPSO_API_KEY`      | Reserved for the planned WhatsApp channel         | Dedicated companion-development key; read-only phone-number and webhook requests returned HTTP 200. Number reported CONNECTED; one webhook exists.   |
| `OPENCODE_API_KEY`   | Local OpenCode CLI experiments                    | Free Muse Spark 1.3 and Nemotron 3.5 Lightning each returned READY through OpenCode 1.17.20, with reported cost zero. Not an Eve runtime credential. |
| `AI_GATEWAY_API_KEY` | Current upstream Eve model routing outside Vercel | Not configured in this checkout.                                                                                                                     |

The existing Telegram and Kapso webhook destinations were not modified. Wire the durable ingress path and ownership binding before redirecting either channel. Credential validity alone is not evidence of end-to-end messaging, media handling, approval safety, or recovery.

## Model qualification

The requested OpenCode Zen model `muse-spark-1.3` rejected a direct Responses API probe with `CreditsError` (insufficient balance). The free variant `muse-spark-1.3-contributor-free` rejected a direct probe with `MissingSessionID`, stating that its free tier can only be used in OpenCode. Nemotron 3.5 Lightning Free returned the same restriction. DeepSeek V4 Flash Free reported model unavailable.

The official OpenCode CLI successfully ran the free Muse and Nemotron models in an empty temporary directory with plugins disabled, sharing disabled, and tool permissions denied. This demonstrates model access through OpenCode only. It does not qualify Eve, tool execution, or a multi-user deployment. Do not fabricate OpenCode session headers to make a direct Eve call appear to originate from that client.

Sources: [Zen endpoints](https://opencode.ai/docs/zen), [OpenCode CLI](https://opencode.ai/docs/cli/), [Kapso phone-number API](https://docs.kapso.ai/api/platform/v1/phone-numbers/get-phone-number).

## Application validation

The principal-scope increment checks personal-workspace ownership for every authenticated principal, including non-Better-Auth IDs. Browser configuration is now lazy and returns a sanitized error when missing or invalid. Native autofill uses the same Kernel client boundary as other browser operations.

After independent review fixes, the repository suite passed 81 files and 708 tests, lint, type checking, and unused-code checks. Formatting failed on native autofill, was corrected, and the full format check then passed. The suite contains inherited mocks; these results are regression evidence, not live provider qualification.

Ripwire reported 17 major short-horizon-churn findings and two minor verbosity deltas for the optional-Kernel change. Those findings remain recorded; the quality gate was not green. The bounded change was independently reviewed with no remaining material findings. Do not treat this as a general architecture or security approval.

The earlier production-build attempt failed during page collection because database configuration was absent. A dedicated local PostgreSQL 17 instance subsequently accepted the real migration chain, and the configured production build passed without cache. The production server returned HTTP 200 for the sign-in page and redirected an unauthenticated root request to sign-in. Full runtime qualification, durable PostgreSQL workflow recovery, channel delivery, and direct Eve model inference remain separate acceptance work.
