# WhatsApp user bridge candidate

Status: hosted mautrix-whatsapp image, provisioning client and fixture
pairing are implemented. Live phone pairing, Beeper Desktop and a real
test group remain unavailable. Sends never mark `delivered`.

Date: 2026-09-15.

Builds on: [shared workspaces](adr-zoen-shared-workspaces.md),
[trust networks](adr-trust-networks-and-a2a.md),
[Kapso bot path](adr-kapso-path-r1.md).

## Decision

[mautrix-whatsapp v0.2608.0](https://github.com/mautrix/whatsapp/tree/v0.2608.0)
is the hosted user-owned WhatsApp bridge. It is not vendored. Pairing a
person's WhatsApp, talking to the Zoen Kapso bot, and signing in to Zoen
remain three operations. The Connections UI keeps Kapso “WhatsApp” for login
identity and adds **Meu WhatsApp** for the personal mautrix session.

Beeper Desktop is a local OAuth/PKCE option for people who already run that
app. `beeper/bridge-manager` targets Beeper's homeserver, not Zoen's Synapse.
The Eve registry item `channel/chat-sdk-beeper` is not installed.

Each personal workspace has at most one live bridge account. Pairing stores a
nonce hash and the Matrix user used for provisioning. Confirm and list bind
`remote_user_id` from bridge `whoami`, never from a client-supplied id. Kapso
installation ids and bot tokens are rejected (`onExcessProperty: "error"`).
Authorized chats are explicit and may record the Matrix portal `room_id`.
A company workspace sees a chat only after an owner shares a group. Personal
DMs cannot be shared. Imported contacts do not create directory users or
personal trust.

`fill` and send queue an authorized snapshot of content and destination.
Changing either after authorization requires a new approval. Delivery still
needs a live mautrix login, a portal room and the WhatsApp appservice token.
There is no `delivered` draft status. Pause stores live events without alerts
and blocks send. Revoke wipes Zoen rows and best-effort logs out on the
bridge. Removing a company member revokes shares they issued.

The Kapso/Telegram bot channels stay unchanged. GitHub Checks bootstrap the
`zoen_whatsapp` PostgreSQL role and do not start mautrix; there is no paired
phone in CI.

## Fail closed

`requireWhatsAppBridge` fails when the bridge URL or provisioning secret is
missing, `/_matrix/mau/ready` fails, or `whoami` has no login. Confirm
without a live login fails. Send stays `queued`. Encryption is off in the
hosted config (BR08): WhatsApp plaintext crosses the bridge process.

## WhatsApp pairing stays unavailable here

The plan's live acceptance needs a pilot WhatsApp on a real phone. This VM
has no paired account. Zoen does not run Beeper Desktop and does not persist
a bot token as a user session.

## Alternatives rejected

- Reusing the Kapso Cloud API bot as the user's WhatsApp: that is a business
  number, not the person's account, and does not join existing private groups.
- Installing `channel/chat-sdk-beeper` as the hosted bridge: a channel adapter
  is not pairing, history search, or per-account isolation on our Synapse.
- Treating imported contacts as trust-network members: sync, read permission
  and A2A are different relations.

## Evidence

`tests/runtime/whatsapp-bridge.integration.ts` against
`tests/runtime/whatsapp-bridge-fixture.ts` proves ready/unpaired fail-closed,
rejected Kapso nonce and bot token, whoami-bound remote id, authorized DM
versus group, Matrix inbound into an authorized room, backfill versus live
cursors, duplicate events, personal versus company isolation, pause, draft
authorization, fixture send recorded without a `delivered` status, revoke
logout, contact import without trust, remote-id uniqueness and member-removal
of shares. `tests/agent-tool-boundaries.test.ts` keeps coordinator WhatsApp
tools off the browser worker and away from Kapso transport.
