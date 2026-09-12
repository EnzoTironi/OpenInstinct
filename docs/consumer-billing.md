# Consumer billing (C-BILL)

Hosted Companion plans so people, prosumers, and orgs can buy access on top of
existing Release-1 quotas. **Free never requires a card.** Paid upgrades use
Stripe Checkout + Customer Portal; webhooks update entitlements that gate
admission limits.

Self-host operators stay on [self-host quotas](self-host.md) /
[quotas ADR](decisions/adr-quotas-admission-r1.md). This doc is for hosted
Instinct branding only.

## Plans (Instinct-branded)

| Plan     | Who                | Placeholder list price               | Quotas                                                    |
| -------- | ------------------ | ------------------------------------ | --------------------------------------------------------- |
| **Free** | Individuals        | $0 · no card                         | Same floors as Release-1 (`shared/billing/plans.ts`)      |
| **Pro**  | Heavy personal use | **$20 / month** (placeholder)        | Higher personal ceilings                                  |
| **Org**  | Teams / prosumers  | **$30 / seat / month** (placeholder) | Pro-like per seat; installation ceilings scale with seats |

Placeholder prices are documentation only. Chargeable amounts come from Stripe
**Price** objects referenced by env Price IDs.

## Architecture (ponytail)

```
Private conversation offer (target) or Account → Upgrade
        │
        ▼
POST /api/billing/checkout  →  Stripe Checkout (subscription)
        │
        ▼
Stripe webhook  →  POST /api/billing/webhook
        │
        ▼
billing_entitlements row (plan / seats / stripe ids)
        │
        ▼
admitQuota(..., admissionLimitsForPlan(plan, seats))
```

- Manage / cancel: `POST /api/billing/portal` → Stripe Customer Portal.
- Missing entitlement row ⇒ **Free**.
- No full billing admin console in-app.

## Code map

| Area                         | Path                                                       |
| ---------------------------- | ---------------------------------------------------------- |
| Plan catalog + quota mapping | `shared/billing/plans.ts`                                  |
| Entitlements table           | `db/schema/billing.ts` · migration `0031_consumer-billing` |
| Read / upsert                | `db/services/billing.ts`                                   |
| Checkout / portal / webhook  | `server/billing/*`                                         |
| HTTP                         | `app/api/billing/{checkout,portal,webhook}`                |
| UI                           | Account → Plan and billing                                 |
| Admission bridge             | `server/operations/quotas.ts` → `admissionLimitsForPlan`   |

## Env / Fly secret **names** (never commit values)

| Name                    | Purpose                                                   |
| ----------------------- | --------------------------------------------------------- |
| `STRIPE_SECRET_KEY`     | Server Stripe SDK (`sk_…`)                                |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature (`whsec_…`)                             |
| `STRIPE_PRICE_PRO`      | Stripe Price id for Pro monthly                           |
| `STRIPE_PRICE_ORG_SEAT` | Stripe Price id for Org per-seat monthly                  |
| `BETTER_AUTH_URL`       | Public origin for Checkout success/cancel + Portal return |

Optional: leave all Stripe names unset — Free still works; Checkout/Portal return
503 `stripe_not_configured`. Account billing controls detect missing configuration
and show a disabled state. Public pricing was removed on 2026-09-12: the intended
acquisition flow starts with conversation, then offers a Stripe link in that
private chat when relevant. The existing authenticated Checkout endpoint is
implemented; automatic offers and agent delivery are not qualified by this slice.
Opening Checkout or its return URL never proves payment; the webhook does.

```sh
# Names only — values from your secret store:
# fly secrets set STRIPE_SECRET_KEY=… STRIPE_WEBHOOK_SECRET=… \
#   STRIPE_PRICE_PRO=… STRIPE_PRICE_ORG_SEAT=…
./scripts/fly-companion.sh secrets-check
```

## What Enzo must set in Stripe Dashboard

1. **Products + Prices**
   - Product “Companion Pro” → recurring monthly Price → copy id → `STRIPE_PRICE_PRO`.
   - Product “Companion Org seat” → recurring monthly Price (per unit) →
     `STRIPE_PRICE_ORG_SEAT`.
2. **Customer Portal** — activate payment method update + cancel subscription
   (Settings → Billing → Customer portal).
3. **Webhook endpoint** — `https://<public-origin>/api/billing/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`.
   - Copy signing secret → `STRIPE_WEBHOOK_SECRET`.
4. **API keys** — Secret key → `STRIPE_SECRET_KEY` (test mode first).
5. **Fly / host secrets** — set the four Stripe names above plus existing
   `BETTER_AUTH_URL` / `COMPANION_PUBLIC_BASE_URL`. Then `pnpm db:migrate` for
   `billing_entitlements`.

## Acceptance

- New users stay on Free without entering a card.
- Pro Checkout + webhook flips user entitlement to `pro` and raises limits.
- Org Checkout (org admin + `organizationId`) writes org entitlement + seat count.
- Customer Portal opens for an existing Stripe customer.
- Secret **values** never appear in git, PR bodies, or docs.

## Trust copy

- Free never requires a card (see Acceptance).
- Manage / cancel only through Stripe Customer Portal — no in-app card vault UI.
- Privacy export/delete limits for the same Account surface:
  [consumer first-run → Consumer trust](consumer-first-run.md#consumer-trust-c-trust)
  and [self-host §9](self-host.md#9-account-export--delete-limits).

## Out of scope (this slice)

- Full billing admin console / invoices UI.
- Tax / VAT automation beyond Stripe defaults.
- Merging personal Pro into Org seats automatically.
- Changing Meta / Telegram commercial terms.
