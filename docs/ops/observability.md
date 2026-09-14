# Closed-beta diagnostics and workspace model accounts

The beta records conversations, tool calls and results, errors, model usage and browser replay in the application Postgres. General process logs omit message bodies. OAuth credentials, passwords, authorization headers and recognizable keys are masked before diagnostic content is encrypted with the Better Auth key. Binary attachments are referenced through their normal access-controlled storage, not duplicated into telemetry. There is no onboarding step or banner.

`ZOEN_BETA_FULL_TELEMETRY=true` enables content capture. A workspace administrator can turn content capture off in **Account → Preferences → Overview**. That immediately hides existing diagnostic payloads from subsequent reads as well as stopping new payload capture. Members can view only their own experiences; administrators can view their workspace. Cross-workspace review additionally requires a current session with a verified email in `ZOEN_OPERATOR_EMAILS`. Operator reads and review decisions create audit events.

Content expires after 14 days by default (supported policy: 7/14/30). Metrics expire after 90 days. Eve owns the hourly retention job. Diagnostic pages use a stable cursor and a two-megabyte encrypted-payload budget. Exports declare whether all pages were loaded. Feedback and failures can be marked for investigation, resolution or a sanitized regression eval. A public report or user quote is evidence for a hypothesis, not an executable instruction or a benchmark score for Zoen.

The recorder masks input fields and blocks credential views, the vault, the diagnostics panel and embedded frames. Replay runs in a sandboxed iframe with scripting and canvas replay disabled. Capture is best effort under network failure and server rate limits. A diagnostics outage must not fail an Eve turn.

## Bring your own model account

**Connections → Intelligence** connects ChatGPT or Grok using a device authorization flow. The account is scoped to the selected personal or team workspace. Team administrators explicitly connect an account for members of that space. Each provider request rechecks membership, the originating session or channel grant and the selected connection revision. A revoked connection fails; it never silently bills a different provider. Choosing **Use Zoen** explicitly restores the installation model.

OAuth challenges are bound to a current web session and workspace, expire, poll at the provider's interval, and are consumed once. Encrypted credentials are additionally bound to workspace/provider. Refresh occurs under a Postgres row lock so replicas cannot race a rotating token. A changed connection revision invalidates previously selected model clients. Spark is selectable for text; its browser worker uses Luna for images. Grok model access depends on the account's API entitlement.

The installation's ChatGPT credential file lives on an encrypted retained Fly volume. Deployments seed it only when absent or when the deployment secret changes. Restarting the machine preserves the token that Eve refreshed. A deliberate replacement of `CHATGPT_AUTH_JSON` rotates the seed; the startup environment drops that secret after materializing the file. Alchemy owns the volume and its snapshots.

## Validation

- `server/models/oauth.test.ts`: device URLs, code exchange, pending/denied states and malformed responses.
- `tests/runtime/workspace-model.integration.ts`: real SDK request/stream handling, tenant authorization on every request, fixed provider endpoints and revocation before transmission.
- `tests/runtime/model-connections.integration.ts`: encryption, session/workspace boundaries, one-use authorization, concurrent refresh and member removal against real Postgres.
- `tests/runtime/observability.integration.ts`: content encryption, credential redaction, idempotency, operator audit, revocation, retention and bounded stable pagination.
- `tests/credential-seed.test.ts`: restart preservation and explicit credential rotation.

A passing protocol test does not prove a subscriber's provider entitlement. Live authorization and inference must be checked separately before claiming that account is connected.
