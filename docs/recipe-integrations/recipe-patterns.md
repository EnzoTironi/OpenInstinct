# Public recipe patterns and independent implementations

The [inventory](recipes.json) captures publicly observed names and source links.
The contracts below are Companion design proposals derived from those patterns,
not claims that we recovered competitors' hidden prompts or backend code.

## Public mechanics

Poke's [recipe creation documentation](https://poke.com/docs/creating-recipes)
exposes installation context, a prefilled first message and required MCP templates.
This supports a recipe-as-setup-context model. Its update guidance distinguishes
new installations; do not assume an edited template migrates existing users.
The [MCP documentation](https://poke.com/docs/mcp-servers) describes tool discovery
and connection setup. Server configuration changes are a different layer from
recipe template updates. Its [API](https://poke.com/docs/api) injects input into a
conversation; successful input delivery does not prove the requested task finished.

Town publishes [stock routines](https://www.town.com/docs/routines/stock-routines)
and [custom trigger behavior](https://www.town.com/docs/routines/custom-routines/triggers).
It separates deterministic trigger filtering from semantic conditions. Its
[steps and caching](https://www.town.com/docs/routines/custom-routines/concepts/steps-and-caching)
and [calling agents](https://www.town.com/docs/routines/custom-routines/concepts/calling-agents)
documentation suggest deterministic collection/filtering around bounded reasoning.
Cached steps are not proof of exactly-once external effects. Companion should
make semantic-filter failure explicit instead of adopting a fail-open trigger.

Lindy separates [routines](https://docs.lindy.ai/teammate/routines) from
[skills](https://docs.lindy.ai/teammate/skills). Procedure discovery and full
instruction loading can be separated without making every skill a schedule.
Its [integration guardrails](https://docs.lindy.ai/integrations/overview) currently
apply to shared Slack threads, not all conversation surfaces. Companion should
keep its own consistent authority boundary across channels. Vendor dry-run or
verification claims remain distinct from our evidence.

Instinct's [public site](https://instinct.com/) and
[privacy policy](https://instinct.com/privacy-policy) establish a broad personal
assistant and Workspace access. They do not expose enough detail to reconstruct
an exhaustive recipe catalog or infer how arbitrary desktop tasks execute.

## Candidate acceptance contracts

| Pattern and sources                                | Required inputs and behavior                                                                     | Acceptance property                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Morning briefing: Poke, Town, Lindy                | User timezone, schedule, selected calendar/mailbox, destination; summarize bounded relevant data | One correctly dated brief reaches the selected destination; no cross-account data; delivery failure is visible        |
| Follow-up reminders: Poke, Lindy                   | Sent-thread cursor, configurable waiting period, exclusions; detect unanswered messages          | A reply clears the pending follow-up; reruns do not duplicate alerts; no automatic email sending without a grant      |
| Subscription watchdog/audit: Poke                  | Receipts and renewal evidence, currency, notification lead time                                  | Alert cites a real source and correct date; distinguish estimates from confirmed charges; deduplicate renewal events  |
| Flights to calendar: Poke                          | Booking email, itinerary IDs, timezone, target calendar                                          | Correct departure/arrival instants and booking context; updates modify the linked event rather than adding duplicates |
| Receipt/travel forwarding: Poke                    | Explicit destination/account and forwarding grant                                                | Correct artifact reaches the bound address; duplicate input is safe; missing confirmation remains uncertain           |
| Meeting prep and action hand-off: Town, Lindy      | Meeting, attendees, related mail/docs, action destinations                                       | Prep is scoped to the meeting; proposed tasks cite evidence; writes respect the selected user's accounts              |
| Auto-inbox: Town, Lindy                            | User preferences and exclusions for important/starred messages and known contacts                | Excluded messages are preserved; classification errors are inspectable and reversible                                 |
| Relationship reconnect/birthday ideas: Town, Poke  | Explicit contacts, date evidence and cadence                                                     | No invented dates or relationships; suggestions don't send messages without authorization                             |
| GitHub/competitive/topic digests: Town, Poke       | Repositories/topics, source window, cadence, destination                                         | Source links and time window are correct; quiet runs and unavailable sources are distinguished                        |
| Health/habit check-ins: Poke                       | User-selected schedule and optionally connected device data                                      | Respect timezone and pause state; distinguish reminders from medical advice; no fabricated measurements               |
| Search/monitor: Poke apartment and flight patterns | Search criteria, public sources, cadence and dedupe key                                          | Alert only on a meaningful qualifying change, with an inspectable source; monitoring error is not “no results”        |

Shared lifecycle properties: revoke/disconnect stops future use of the credential;
pause stops new scheduled work; cancellation reports what already happened;
concurrent edits do not run an unreviewed mixture of definitions; retries do not
silently duplicate external writes; each installed routine owns its accounts and
destination. Test these at the owning layer with real execution paths.

## Suggested order, not an execution assignment

Start with morning briefing and follow-up reminders on already supported
mail/calendar channels. Then qualify flights-to-calendar and subscription alerts.
These exercise scheduling, account scope, cursors, deduplication and delivery.
Next, add meeting prep and task proposals. Only then qualify a concrete external
Sim/n8n workflow and the first missing integration chosen from the catalog.
The user-facing gallery should show actual capability/readiness, not pretend
every researched recipe can already be activated.
