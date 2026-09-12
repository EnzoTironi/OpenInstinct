# Consumer first-run (hosted)

Short path for a person using the hosted Companion — not an operator self-host
guide. Operators stay on [self-host](self-host.md) and
[hosted Fly (H01)](ops/hosted-fly.md).

## Flow — updated 2026-09-12

1. Tap **Começar** on the landing to open a compact messenger chooser on the
   same page: a bottom sheet on mobile and a centered card on desktop. It shows
   only WhatsApp, Telegram and iMessage buttons. The three 44 px hero icons open
   their configured messenger directly with one tap, without a chooser or a new
   tab. An unconfigured icon is disabled; the chooser and direct entry route
   show a friendly unavailable state instead of a fabricated destination.
2. Send the first message. Existing WhatsApp/Telegram intake provisions the internal account
   and personal workspace from the verified sender. There is no browser login,
   form, plan selection or card before that first conversation.
3. Continue in that chat. Ask for a connection only when the request needs it.
4. When a subscription is relevant, the intended experience offers a Stripe link
   privately, with price and terms visible before payment. This change keeps the
   existing Checkout service; automatic offer timing and agent delivery remain
   acceptance work, not a qualified live billing journey.

The button opens a conversation; it does not send a message on the user's behalf.
The iMessage button uses the configured `LINQ_PHONE_NUMBER` in an `sms:` link to
open Messages. Current Linq intake requires an already verified account and
ignores unknown phone numbers; new-account provisioning through iMessage is not
implemented by the chooser. The link does not guarantee iMessage delivery.
`/sign-in` continues to authenticate browser access through the linked messenger.
Account still owns channel linking, personal memory and subscription management.
The former `/pricing` address redirects to `/get-started`; it has no price table.
That direct entry route remains available for existing links and honors an
explicit messenger choice.

## Consumer trust (C-TRUST)

Honest limits consumers should see before we claim “full account control”:

| Topic                        | Where                                                                                                                                      | Honest claim                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Privacy export / wipe        | Account → Privacy export and online wipe (CTA → `POST /api/account/delete`) + [self-host §9](self-host.md#9-account-export--delete-limits) | `partial_online_wipe` only — **not** full account, history, backups, or channel-identity erasure            |
| Billing trust                | Account → Plan and billing · [consumer billing](consumer-billing.md)                                                                       | Free never requires a card; paid uses Stripe Checkout + Customer Portal                                     |
| Operator secrets (F01)       | [Credential rotation](ops/credential-rotation.md)                                                                                          | **Partial** live rotation executed 2026-09-10 (Enzo-authorized); remaining families skipped — see checklist |
| WhatsApp product gates (O02) | [Meta activation](ops/whatsapp-meta-activation.md)                                                                                         | Display name usable; UTILITY template approval still **PENDING** as of 2026-09-10                           |

Do **not** market full deletion, backup erasure, or WhatsApp proactive templates
until O02’s APPROVED UTILITY gate and the privacy limits above are clear in UI
copy.

## What this is not

- Not Docker, Fly, Alchemy, tunnel, or webhook setup.
- Not the full billing purchase flow. Billing follows useful conversation;
  its existing services are documented in [consumer billing](consumer-billing.md).
- Not org SSO or multi-seat onboarding (C01/C02).
- Not an account merge between two separately provisioned identities.
- Public marketing packaging lives at `/welcome` and `/docs`
  (C-PACK). Unauthenticated `/` redirects to `/welcome`.

## Acceptance (product)

- A new person reaches a configured messenger with one tap and no browser signup.
- The first verified WhatsApp/Telegram private message provisions the same account used on return.
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
