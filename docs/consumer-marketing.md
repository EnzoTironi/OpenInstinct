# Consumer marketing packaging (C-PACK)

Public Instinct / Companion marketing pages inspired by Poke + Town **structure** (hero → audience → how it works → trust → pricing → docs), not their assets or copy.

| Route | Purpose |
| --- | --- |
| `/welcome` | Consumer landing (hero, people/orgs/prosumers, trust, pricing teaser) |
| `/pricing` | Free / Pro / Org story + Stripe Checkout CTAs (from C-BILL) |
| `/docs` | Consumer first-run summary linking to `/get-started` |
| `/` (signed out) | Redirects to `/welcome` |

Primary conversion CTAs point at `/get-started`. Returning users use `/sign-in`.

## Still open

- Point a Zoen / Instinct consumer domain at the hosted app (today: `companion.tironi.xyz`).
- Design polish: motion, photography, social proof wall, annual billing toggle.
- Real Stripe list prices (placeholders remain until dashboard Price IDs).
- Full docs site beyond the first-run summary (operator docs stay in `docs/`).

Do **not** copy third-party logos, illustrations, or proprietary marketing copy.
