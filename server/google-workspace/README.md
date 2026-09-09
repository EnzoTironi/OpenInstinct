# Self-hosted Google Workspace

Better Auth owns provider account storage, encrypted access and refresh tokens, OAuth state,
the `/api/auth/callback/google` callback, and token refresh. The root authentication
configuration must enable Google only when both client credentials are configured,
encrypt OAuth tokens, and disable the raw HTTP token/link/unlink/account-info routes.
Direct `auth.api` calls remain available to these server operations.

`readGoogleWorkspaceConnection(scope)` returns only `state`; it reads grant
metadata without exposing tokens or claiming a live provider check. Only the four business API scopes are required; Google identity
scope aliases do not determine tool authorization.

`connectGoogleWorkspace(headers, callbackURL, errorCallbackURL?)` returns `{ url, headers }`.
Both callback URLs must belong to the installation origin; the error destination
defaults to the success destination for the native Eve flow.
Its HTTP consumer must forward every `headers.getSetCookie()` value separately.
The return URL must belong to the installation origin. `disconnectGoogleWorkspace`
requires real session headers, revokes the provider token before unlinking, and
retains the local record when revocation fails. Revocation never runs inside a
local authority transaction. Tokens must already use Better Auth encryption;
there is no plaintext-token compatibility path.

Eve uses its public three-method interactive authorization adapter. Its challenge
links to `/api/google-workspace/connect?flow=...`. A ten-minute encrypted envelope,
created with Better Auth's public JWT crypto and the unified
`ResolvedInstallationSecrets` Effect layer, binds the native principal's Better
Auth user ID to Eve's same-origin callback.
The browser route requires that exact signed-in user before asking Better Auth to
link Google. Challenge issuance requires **live delegated authority** through the
same `BrowserWorkerAccess` checks as browser vault tools (active channel identity,
valid web session, non-paused schedule + live lease, or current membership) — not
workspace ownership alone. Browser linking still requires current workspace
membership; a surviving Better Auth cookie does not restore revoked membership.
Fail-closed: revoke, pause, expired lease, or unavailable live-authority verification
denies challenge issuance. Better Auth independently owns the OAuth verification
record and state cookie. Eve completion has callback params, not browser headers; it
reads only the pending principal's owned Google account. No custom completion route,
OAuth database, refresh loop, or token cache is introduced.

Account lookup requires current personal-workspace membership and canonical
Google issuer. It fails closed on ambiguous multiple Google accounts. After
Better Auth token retrieval/refresh, ownership, membership, account ID, token
presence and business scopes are reread before returning a redacted bearer.
A deletion after that final read, or provider revocation during an already-running
request, remains an in-flight race. Eve owns per-step token caching; provider 401s
request native reauthorization. Other provider failures expose only a typed HTTP
status, never Gaxios request configuration, response bodies, or bearer tokens.

The focused tests are **fixture** qualification: real encryption/tamper rejection,
principal binding, callback restrictions, business scope checks, pure provider-error
redaction, and live-authority deny paths (revoke/pause/unavailable) against Effect
Layer fixtures for `BrowserWorkerAccess` and `ResolvedInstallationSecrets`. They do
**not** claim live Google provider consent. Live Google consent, renewal, revocation,
concurrent provider races, and end-to-end Eve suspension/resumption require configured
Google credentials and a real IdP redirect — left unqualified here.

### Gmail send intent (Message-ID / outbox semantics)

`sendGmail` stamps a stable RFC822 `Message-ID` derived from
`session.id:callId` (`<openinstinct-{sha256.slice(0,48)}@local>`). Because Gmail's
`users.messages.send` does **not** treat that header as an idempotency key, the
send path applies outbox-style reconciliation:

1. **Pre-dispatch lookup** via `rfc822msgid:` for the exact Message-ID; if a
   message already exists, return it and skip send (Eve step replay / identical
   retry).
2. **Uncertain-outcome reconcile** after send failures with no status, HTTP 5xx,
   or 429: look up the Message-ID again before propagating the error. Definite
   client 4xx failures (except 429) fail closed without claiming success unless
   the pre-dispatch lookup already found the mail.

Focused Gmail send tests in
`agent/lib/google-workspace/tests/google-workspace-generated-clients.test.ts`
are **SDK fixture** mocks (list/get/send). They prove Message-ID stability,
replay-without-resend, uncertain recovery, and fail-closed 4xx behavior. They
do **not** claim live Gmail provider delivery, quota, or concurrent-race
qualification — those require a live Google grant and remain unqualified.

Run the focused real PostgreSQL membership check with the initialized runtime-test
schema (the check refuses any database except `companion_runtime_test`):

```sh
pnpm test:google-membership
```

It inserts an isolated synthetic membership, issues a real encrypted handoff,
removes that membership, verifies subsequent authorization and challenge issuance
fail, and removes its workspace in cleanup. It makes no Google API calls.

Home uses the same kickoff route without `flow`, passing only `returnTo`. The
current authenticated session owns that link operation. The existing chat-return
validator restricts the success destination; it receives `google=connected`.
Provider errors return to `/?google=unavailable&returnTo=<validated-chat>`.
When `flow` is present, even if empty or malformed, the native principal-bound
handoff remains mandatory; it cannot fall through into the Home flow.

For revocation retries, only an explicit HTTP 400 `invalid_token` response from
Google's revoke call permits local unlink after a rejected request. The
[Google revocation endpoint reference](https://developers.google.com/identity/openid-connect/reference#revocation_endpoint)
defines that error as an expired or already revoked token. This lets a retry
finish local removal after a previous revoke succeeded but unlink failed.
Network failures, malformed responses, decryption failures and other error codes
retain the local account. Classification tests use synthetic values in the pure
decoder; they do not execute or qualify provider revocation.

Better Auth 1.7.2 encrypts persisted access and refresh tokens with the configured
OAuth encryption option, but its callback and refresh paths persist `idToken`
in plaintext. This adapter neither consumes nor exposes that ID token and does
not claim to encrypt or remove it. Database protection for that persisted identity
payload remains a limitation of the installed Better Auth storage behavior.
