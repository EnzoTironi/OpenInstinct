# Customer platform: implementation handoff

Status: implementation and validation plan, reviewed on 2026-09-14. The scenarios
in this package are planned work, not evidence of completed integrations.

Start with [the handoff](handoff.md), then use:

- [Implementation plan](plan.md): identity, personal/company spaces, trusted
  networks, Executor tools and skills, Matrix/A2A, Vaultwarden, messaging,
  deletion, evals and release gates.
- [Beeper and the Pally experience](beeper-pally.md): the hosted messaging
  approach, user journeys, data boundaries and primary-source findings.
- [Implemented customer code slice](../../decisions/adr-customer-tools.md):
  current behavior, isolation evidence and remaining remote-connector work.
- [Acceptance matrix](acceptance.csv): scenarios with required evidence levels;
  populate results only after running them.
- [Existing launch evidence](../../decisions/zoen-launch-validation.md): previous
  results and their limits. Do not count these as proof of new capabilities.

The product decisions include a Google-first identity with verified messenger
links, companies as trusted networks, accepted personal trust connections, and
scope-aware tool and skill publication. Membership permits contact with bots
published to the network; access to their data and tools still requires the
appropriate grants. A connected address book does not create trusted contacts.

The first hosted messaging target is a user's WhatsApp account, including an
existing test group, through a self-hosted bridge. Beeper Desktop is optional.
Vaultwarden requires a separate proof of credential delegation and safe TOTP
use. Neither integration is declared available by this documentation change.
