# One person, multiple spaces, verified messengers

Status: implemented; real-provider onboarding qualification remains a release gate.

## Account model

Google is the primary entry point. Better Auth verifies Google's issuer and
subject and creates or finds the Zoen user. The same user owns a personal space
and can belong to multiple companies. Company membership comes from an explicit
invitation or membership grant; a matching email domain does not grant access.

Google accounts used for sign-in and Google Workspace permissions have different
lifecycles. Normal sign-in requests only OpenID, email and profile. Connecting
Gmail, Calendar and Contacts requests those permissions separately. Signing in
again preserves the existing integration token; disconnecting the integration
revokes and clears its credentials but retains the Google identity. A personal
Google identity can coexist with a different Google account connected for work.
The personal Workspace connection currently supports one active integration
account. Team connections use their existing explicit sharing and revocation
boundaries.

This uses Better Auth's existing Google provider, account-linking implementation,
encrypted OAuth credentials and `updateAccountOnSignIn: false`. It does not add a
second session system. See [Google authentication](https://better-auth.com/docs/authentication/google).

Closed-beta registration requires `ZOEN_REGISTRATION_MODE=closed` and a verified
identity in `ZOEN_BETA_IDENTITIES`; Google entries use `google:email@example.com`.
Existing users can sign in without registering again. Accounts with matching
email text but different provider subjects are not silently merged.

## Messenger confirmation

1. The browser creates a short-lived, single-use login or linking challenge.
   Linking requires a recent session for the account that will own the connection.
2. A Telegram or WhatsApp conversation carries the start token to the provider.
3. The verified private webhook queues one encrypted confirmation prompt. The
   prompt is bound to its first recipient. The agent does not receive the token or
   interpret an approval response.
4. The person taps the native confirmation button. Telegram sends a callback;
   WhatsApp sends an interactive button reply. Zoen validates the signed provider
   event, installation, sender, expiry and purpose.
5. The original browser consumes the confirmed challenge and completes the
   Better Auth session or account link. Possessing the challenge URL alone cannot
   complete a session in another browser.

The native button is the one-click approval. Browser initiation may still require
opening the messenger and sending its prepared message. WhatsApp proactive
delivery outside an active conversation would require provider-approved templates;
this change does not claim to implement that separate delivery path.

Messages from groups, history imports and outbound echoes cannot confirm an
account. A forwarded button cannot switch the recipient already bound to the
prompt. Used, expired and revoked challenges cannot create another session.

The uniqueness constraint applies to a verified provider identity within its
installation. An active WhatsApp number cannot belong to two Zoen users in that
installation. Legacy channel-first accounts can exist separately until explicitly
linked or consolidated. Consolidation requires proof of both sides and the
existing archive eligibility checks; it is never an email/phone guess or database
wipe. Existing chat-first entry remains compatible; the generic website entry now
starts at Google sign-in before directing the person to Connections.

## Evidence

- `tests/runtime/google-signin.integration.ts` uses the production Better Auth
  configuration, signed OAuth fixtures and real PostgreSQL. It exercises PKCE,
  callback validation, verified-email admission, issuer/subject uniqueness,
  encrypted integration credentials, a second Google identity, revocation and
  sign-in after disconnection. Google network responses are isolated fixtures.
- `tests/runtime/whatsapp-auth.integration.ts` exercises real webhook signature
  validation, provider parsing, durable prompt delivery, confirmation and browser
  consumption. Only outbound provider HTTP is replaced. Agent entrypoints fail
  the test if invoked. It rejects forged signatures, history imports, forwarded
  confirmations and a different browser, and proves single-use consumption.
- The existing Telegram webhook, browser-cookie, prompt lease and account-lifecycle
  suites remain part of the runtime validation.

These are integration proofs, not a recording of a new customer using Google,
Telegram or WhatsApp. A live recording and the current provider's WhatsApp group
enablement remain separate release requirements.
