# Consumer first-run (hosted)

Short path for a person using the hosted Companion — not an operator self-host
guide. Operators stay on [self-host](self-host.md) and
[hosted Fly (H01)](ops/hosted-fly.md).

## Flow — updated 2026-09-15

Google is the canonical hosted identity. A first message from an unknown
WhatsApp or Telegram sender does **not** create a Zoen user or personal
workspace. The webhook stores a pending address and asks the person to sign in
with Google, then link that messenger from Account.

1. New browser accounts start at Google sign-in (`/sign-in`). Closed beta
   requires a verified identity in `ZOEN_BETA_IDENTITIES`. There is still no
   plan selection or card before that sign-in.
2. After Google, use Account → Connections to confirm Telegram or WhatsApp
   with a short-lived challenge in the private chat. A messenger already owned
   by another user is a conflict. Accounts created by channel-first contact
   before this rule join Google only through the explicit archive path — that is
   not ordinary onboarding.
3. The landing **Começar** chooser and 44 px hero icons still open configured
   WhatsApp, Telegram or iMessage chats. They do not provision a new account.
   An unconfigured icon is disabled and never fabricates a destination.
4. Continue in a linked chat. Ask for a connection only when the request needs it.
5. When a subscription is relevant, the intended experience offers a Stripe
   link privately, with price and terms visible before payment. Automatic offer
   timing remains acceptance work, not a qualified live billing journey.

The messenger button opens a conversation; it does not send a message on the
user's behalf. The iMessage button uses the configured `LINQ_PHONE_NUMBER` in an
`sms:` link. Current Linq intake requires an already verified account and ignores
unknown phone numbers. The link does not guarantee iMessage delivery. The former
`/pricing` address redirects to `/get-started`; it has no price table.

## Consumer trust (C-TRUST)

Honest limits consumers should see before we claim “full account control”:

| Topic                        | Where                                                                                                                                      | Honest claim                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Privacy export / wipe        | Account → Privacy export and online wipe (CTA → `POST /api/account/delete`) + [self-host §9](self-host.md#9-account-export--delete-limits) | `partial_online_wipe` only — **not** full account, history, backups, or channel-identity erasure            |
| Durable erasure              | `POST /api/account/erasure` + [account deletion](decisions/adr-account-deletion.md)                                                        | Zoen-controlled personal data + tombstone; Mem0/Matrix/Vaultwarden/mautrix/backups stay pending             |
| Billing trust                | Account → Plan and billing · [consumer billing](consumer-billing.md)                                                                       | Free never requires a card; paid uses Stripe Checkout + Customer Portal                                     |
| Operator secrets (F01)       | [Credential rotation](ops/credential-rotation.md)                                                                                          | **Partial** live rotation executed 2026-09-10 (Enzo-authorized); remaining families skipped — see checklist |
| WhatsApp product gates (O02) | [Meta activation](ops/whatsapp-meta-activation.md)                                                                                         | Display name usable; UTILITY template approval still **PENDING** as of 2026-09-10                           |

Do **not** market full deletion, backup erasure, or WhatsApp proactive templates
until O02’s APPROVED UTILITY gate and the privacy limits above are clear in UI
copy. Do **not** market messenger-first account creation; Google is required.

## What this is not

- Not Docker, Fly, Alchemy, tunnel, or webhook setup.
- Not the full billing purchase flow. Billing follows useful conversation;
  its existing services are documented in [consumer billing](consumer-billing.md).
- Not org SSO or multi-seat onboarding (C01/C02).
- Not an account merge between two separately provisioned identities. The
  remaining split-pilot join is the explicit archive path, not ordinary
  first-run.
- Public marketing packaging lives at `/welcome` and `/docs`
  (C-PACK). Unauthenticated `/` redirects to `/welcome`.

## Acceptance (product)

- A new person signs in with Google, then links a messenger from Account.
- A first WhatsApp/Telegram private message from an unknown sender does not
  create a user; return visits use the Google identity after a confirmed link.
- The iMessage entry opens Messages at the configured number; qualification of
  first-time iMessage intake remains separate acceptance work.
- Missing channel configuration never produces a fake chat link.
- Account makes personal vs org intent obvious and surfaces a plan section.
- Sign-in still works for people who already completed the flow.

## Zoen public deployment

The public marketing origin is `https://zoen.tironi.xyz`. Use
`MARKETING_WHATSAPP_NUMBER`, `MARKETING_TELEGRAM_USERNAME` and
`MARKETING_IMESSAGE_NUMBER` to configure the website conversation links independently
from the existing channel installation. Each value is validated before becoming a
link; when an override is absent, the matching channel configuration remains the
default. These public values do not change bot tokens, installation IDs or webhooks.
