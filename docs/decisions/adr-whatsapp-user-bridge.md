# WhatsApp user bridge candidate

Status: implemented for per-workspace pairing, authorized chats,
synthetic ingest, pause/revoke and company shares. Live mautrix-whatsapp
pairing, Beeper Desktop and a real test group remain unavailable until a
homeserver proof exists.

Date: 2026-09-15.

Builds on: [shared workspaces](adr-zoen-shared-workspaces.md),
[trust networks](adr-trust-networks-and-a2a.md),
[Kapso bot path](adr-kapso-path-r1.md).

## Decision

[mautrix-whatsapp](https://docs.mau.fi/bridges/go/whatsapp/) is the candidate
user-owned WhatsApp bridge. It is not vendored and is not spoken to from this
checkout. Pairing a person's WhatsApp, talking to the Zoen Kapso bot, and
signing in to Zoen remain three operations.

Beeper Desktop is a local OAuth/PKCE option for people who already run that
app. `beeper/bridge-manager` targets Beeper's homeserver, not Zoen's Synapse.
The Eve registry item `channel/chat-sdk-beeper` was not present in this
package install and would be a Chat SDK channel adapter, not user pairing,
per-account isolation, or delegated send. It is not installed.

Each personal workspace has at most one live bridge account. Pairing stores
only a nonce hash. Confirming binds a remote user id. Kapso installation ids
and bot tokens are not session material for this modality. Authorized chats
are explicit. A company workspace sees a chat only after an owner shares a
group. Personal DMs cannot be shared. Imported contacts do not create
directory users or personal trust.

`fill` and send for this modality queue an authorized snapshot of content and
destination. Changing either after authorization requires a new approval.
`requireWhatsAppBridge` fails closed, so a queued send is never marked
delivered. Pause stores live events without alerts and blocks send. Revoke
wipes the nonce hash, chats, shares and drafts. Removing a company member
revokes shares they issued.

The Kapso/Telegram bot channels stay unchanged.

## WhatsApp pairing stays unavailable here

The plan's live acceptance needs a pilot WhatsApp, mautrix on Zoen's Synapse,
and an existing test group. This VM has no paired account.
`requireWhatsAppBridge` fails closed. Zoen does not run Beeper Desktop, does
not persist a bot token as a user session, and does not announce hosted
WhatsApp login for this modality.

## Alternatives rejected

- Reusing the Kapso Cloud API bot as the user's WhatsApp: that is a business
  number, not the person's account, and does not join existing private groups.
- Installing `channel/chat-sdk-beeper` as the hosted bridge: a channel adapter
  is not pairing, history search, or per-account isolation on our Synapse.
- Treating imported contacts as trust-network members: sync, read permission
  and A2A are different relations.

## Evidence

`tests/runtime/whatsapp-bridge.integration.ts` proves pairing, a rejected
Kapso-like nonce, authorized DM versus group, backfill versus live cursors,
duplicate events, personal versus company isolation, pause, authorization of
the exact draft, queued send without delivery, revoke, contact import without
trust, remote-id uniqueness and member-removal of shares.
`tests/agent-tool-boundaries.test.ts` keeps coordinator WhatsApp tools off the
browser worker and away from Kapso transport.
