# Browser account controls

`controls.ts` exposes `readLinkedChannelIdentities(requestHeaders)` and
`revokeLinkedChannelIdentity(requestHeaders, identityId)` as Effect operations.
They verify the real Better Auth browser session, including its current database
row and expiry and current canonical workspace membership, and derive the owner
from that session. The browser never supplies a user ID. The existing account
creation path owns initial workspace provisioning; these controls never create
or restore membership.

The read operation returns active `{ id, channel, senderId }` records, using the
existing identity schema fields. Revocation delegates to `ChannelAccounts` and
returns `{ status: "revoked" }` or `{ status: "last_access" }`. The latter leaves
the identity and sessions intact. Other failures are typed `AccountControlError`
with `unauthenticated`, `identity_inactive` or `unavailable`; root tRPC maps them to
a safe public message. Successful revocation invalidates all browser sessions;
the account UI clears browser auth and returns to sign-in with an explanation.

`/account` and `/sign-in` share the form, status UI and Effect HTTP client in
`web/auth/channel`. Link mode sends the existing `purpose: "link"` request to
Better Auth's channel challenge API. The existing backend owns the recent-session
requirement, browser cookie, messenger confirmation and same-session consumption.
The user explicitly opens the messenger and completes the confirmed request.
Link mode returns to `/account`; expired, conflicting and stale-session requests
have actionable states. Ordinary sign-in keeps its original copy and flow.

The focused integration check uses real PostgreSQL and Better Auth, creates
isolated synthetic channel identities, logs in and links through the public
Better Auth challenge endpoints, and confirms synthetic verified senders through
the real account service. It checks initial membership, ownership, denial after
membership removal, last-access preservation, revocation and session invalidation. It requires the
initialized `companion_runtime_test` database and makes no provider calls:

```sh
TELEGRAM_BOT_ID="account-controls-$(uuidgen)" TELEGRAM_BOT_USERNAME=account_controls_test_bot node --env-file=.env.local --env-file=.env.runtime.local node_modules/tsx/dist/cli.mjs server/accounts/controls.integration.ts
```

Frontend tests render both purposes and exercise pure error presentation. They do
not count as qualification of live Telegram or WhatsApp delivery.
