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
5. You land on home with a success state (`/?welcome=1`). Message the assistant
   in chat or start a web conversation. Manage channels later under **Account**.

Returning users use **`/sign-in`** with an already linked messenger. Linking an
extra channel uses **Account → Link another channel** (`purpose: "link"`).

## What this is not

- Not Docker, Fly, Alchemy, tunnel, or webhook setup.
- Not the full billing purchase flow — Free starts here without a card; hosted
  Free / Pro / Org seats are documented in [consumer billing](consumer-billing.md)
  (`/pricing`).
- Not org SSO or multi-seat onboarding (C01/C02).
- Not an account merge between two separately provisioned identities.

## Acceptance (product)

- A new person can complete signup → workspace → at least one channel bind without
  reading self-host docs.
- After confirmation, home shows a clear success state naming the linked
  messenger family (Telegram and/or WhatsApp).
- Sign-in still works for people who already completed the flow.
