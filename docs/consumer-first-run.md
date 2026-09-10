# Consumer first-run (hosted)

Short path for a person using the hosted Companion — not an operator self-host
guide. Operators stay on [self-host](self-host.md) and
[hosted Fly (H01)](ops/hosted-fly.md).

Conversation-first native entry (message Telegram/WhatsApp with no web step)
remains documented in [native onboarding](native-onboarding.md). This page covers
the **web** first-run that creates the same account, workspace, and channel bind.

## Flow

1. Open **`/get-started`** on the hosted site.
2. Choose **Telegram** or **WhatsApp**.
3. Confirm the browser request in that messenger chat.
4. Return to the tab and continue. Companion creates your account, provisions the
   personal workspace, and binds that channel in one flow.
5. You land on **home** with a success state (`/?welcome=1`). Home is the
   post-signup landing: channel status, next steps, personal plan badge, and
   conversation entry — without reading ops docs.
6. Message the assistant in the linked chat or start a web conversation. Manage
   messengers and plan under **Account**.

Returning users use **`/sign-in`** with an already linked messenger. Linking an
extra channel uses **Account → Link another channel** (`purpose: "link"`).

## After get-started (home + account)

- **Home** shows linked Telegram/WhatsApp (or an empty-state CTA), next actions,
  and a **Free · Personal** plan entry that deep-links to Account → Plan.
- **Account** groups channels, plan/billing entry, and personal memory. Copy
  treats this as a **personal** workspace; Org seats are a separate team plan,
  not a rename of the personal account.
- Hosted Stripe checkout / `/pricing` and Account billing CTAs ship on C-BILL
  ([consumer billing](consumer-billing.md)).

## What this is not

- Not Docker, Fly, Alchemy, tunnel, or webhook setup.
- Not the full billing purchase flow — Free starts here without a card; hosted
  Free / Pro / Org seats are documented in [consumer billing](consumer-billing.md)
  (`/pricing`).
- Not org SSO or multi-seat onboarding (C01/C02).
- Not an account merge between two separately provisioned identities.
- Public marketing packaging lives at `/welcome`, `/pricing`, and `/docs`
  (C-PACK). Unauthenticated `/` redirects to `/welcome`.

## Acceptance (product)

- A new person can complete signup → workspace → at least one channel bind without
  reading self-host docs.
- After confirmation, home shows a clear success state naming the linked
  messenger family (Telegram and/or WhatsApp), plus ongoing channel/plan status
  on later visits.
- Account makes personal vs org intent obvious and surfaces a plan section.
- Sign-in still works for people who already completed the flow.
