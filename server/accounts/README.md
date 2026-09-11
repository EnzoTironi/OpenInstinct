# Browser account controls

`controls.ts` exposes `readLinkedChannelIdentities(requestHeaders)` and `revokeLinkedChannelIdentity(requestHeaders, identityId)` as Effect operations. They verify the real Better Auth browser session, including its current database row and expiry and current canonical workspace membership, and derive the owner from that session. The browser never supplies a user ID. The existing account creation path owns initial workspace provisioning; these controls never create or restore membership.

The read operation returns active `{ id, channel, senderId }` records, using the existing identity schema fields. Revocation delegates to `ChannelAccounts` and returns `{ status: "revoked" }` or `{ status: "last_access" }`. The latter leaves the identity and sessions intact. Other failures are typed `AccountControlError` with `unauthenticated`, `identity_inactive` or `unavailable`; root tRPC maps them to a safe public message. Successful revocation invalidates all browser sessions; the account UI clears browser auth and returns to sign-in with an explanation.

`/account` and `/sign-in` share the form, status UI and Effect HTTP client in `web/auth/channel`. Link mode sends the existing `purpose: "link"` request to Better Auth's channel challenge API. The existing backend owns the recent-session requirement, browser cookie, messenger confirmation and same-session consumption. The user explicitly opens the messenger and completes the confirmed request. Link mode returns to `/account`; expired, conflicting and stale-session requests have actionable states. Ordinary sign-in keeps its original copy and flow.

The focused integration check uses real PostgreSQL and Better Auth, creates isolated synthetic channel identities, logs in and links through the public Better Auth challenge endpoints, and confirms synthetic verified senders through the real account service. It checks initial membership, ownership, denial after membership removal, last-access preservation, revocation and session invalidation. It requires the initialized `companion_runtime_test` database and makes no provider calls:

```sh
TELEGRAM_BOT_ID="account-controls-$(uuidgen)" TELEGRAM_BOT_USERNAME=account_controls_test_bot pnpm test:account-channels
```

Frontend tests render both purposes and exercise pure error presentation. They do not count as qualification of live Telegram or WhatsApp delivery.

## Native browser login and account association

`NativeDeviceAuth` uses `channel_auth_challenge` for both `login` and `link`. The request purpose is fixed at issuance; changing it on a retry, browser binding, resume or native confirmation is rejected. A link request records the recent Better Auth session and its owner when the browser binds. Confirmation and consumption revalidate that same session, its expiry and canonical membership. The native identity, source conversation, browser cookie and exact binding time remain required. Completing a link never issues an additional login session.

WhatsApp's browser entry opens an ordinary conversation describing the chosen purpose. The native `device-auth-start`, `device-auth-status` and `device-auth-confirm` tools return the browser link and use the same explicit approval boundary. Browser reload resumes using its signed cookie, without retaining the entry token in browser storage.

This flow confirms an existing same-account association. A messenger already associated with a different account returns an explicit conflict; no identity, conversation, memory, integration or quota is transferred. Every first native conversation already provisions an internal account, so joining two separately created accounts requires a future explicit merge and transfer policy. It is not implemented or implied by this flow.

`device-link.integration.ts` exercises real PostgreSQL and Better Auth for the same-account path, purpose changes, two accounts, browser-session substitution, freshness/expiry/revocation and concurrent one-use completion. These are domain and HTTP proofs with synthetic identities, not live provider qualification.

## Account privacy export/delete gates

`privacy.ts` exposes Effect-safe `exportAccountPrivacy(headers)` and `deleteAccountOnlineData(headers)`. Both derive the owner from the live Better Auth browser session plus canonical workspace membership. The browser never supplies a user ID. Missing, expired or revoked credentials fail closed as `AccountPrivacyError` with `unauthenticated` (HTTP 401) or `unavailable` (HTTP 503).

| Route | Method | Behavior |
| --- | --- | --- |
| `/api/account/export` | GET | Partial privacy export (stored personal memory envelope) |
| `/api/account/personal-memory/export` | GET | Existing personal-memory JSON download |
| `/api/account/delete` | POST | Online personal-memory wipe + browser session invalidation |
| Account UI → Privacy export and online wipe | — | Same `partial_online_wipe` honesty + CTA to `/api/account/delete` |

### Limits (documented, not claimed complete)

- **Export** includes structured profile and bound profile notes only. Conversation history, artifacts, connected accounts, schedules, unbound memory documents, channel identities, browser sessions and backups are excluded.
- **Delete** wipes that same personal-memory surface and deletes Better Auth `session` rows for the user. It does **not** erase channel identities, schedules, artifacts, conversation history, the user/workspace rows, or backups. Do not claim full account deletion or backup erasure.
- Restore reconciliation and a deletion ledger remain separate P06 gates.

Org-scoped wipe/delete is **out of scope** for these personal routes. See `docs/decisions/adr-c02-sso-audit-erasure.md` and `shared/identity/org-erasure.ts` for fail-closed company erasure gates and append-only audit receipts.

Delete hooks `PersonalMemory.wipe` when that service is present in the runtime (registered from `server/runtime.ts`). Fixture proof: `server/accounts/privacy.test.ts` (fail-closed without auth; wipe never runs).
