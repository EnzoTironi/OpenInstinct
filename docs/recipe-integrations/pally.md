# Pally: recipes, conversational operation and public architecture

Research snapshot: 2026-09-08. This is competitor evidence and design analysis, not a claim that Companion implements these capabilities or permission to adopt a provider. No account was connected and no task was executed through Pally.

## Coverage

All 51 detail pages linked from the [recipe gallery](https://pally.com/recipes) were read. Their names and individual source URLs are in [recipes.json](recipes.json) and its CSV equivalent. The catalog now includes 44 separately typed Pally app, device, channel, infrastructure and MCP entries in [public-integrations.json](public-integrations.json). These are not 44 interchangeable native integrations or a complete action registry.

[pally-source-index.json](pally-source-index.json) and its CSV retain 92 guide and comparison URLs discovered through [llms.txt](https://pally.com/llms.txt). Those pages are indexed, not all individually audited. Competitor comparisons are Pally's marketing, not independent evidence about the other products. Also inspected: facts, story, MCP, privacy, terms, and August/September changelog pages. The advertised entry-points JSON could not be retrieved; its schema and kickoff payloads remain unverified. No reusable source implementation was established.

## Product and onboarding

Pally positions a text thread as the primary interface, using iMessage and RCS. Its facts page lists Free, Pro at $25/month and Max at $100/month; Free allows three connections and three custom automations, Pro ten automations, and Max unlimited automations within a usage allowance. Optional device capabilities require additional setup. These are dated marketing terms, not a measured cost model. [Facts page](https://pally.com/ai).

The useful gallery pattern is a named outcome, a concrete scenario, an explanation of operation, examples of what to ask, prerequisites, and related outcomes. The September changelog says guide/recipe entry links now preserve the originating request. We verified the public descriptions, not that onboarding handoff. [September changelog](https://pally.com/whats-new/2026-09).

## Recipe patterns worth carrying forward

These are proposed Companion acceptance properties, inferred from the linked examples. They require implementation review and real qualification.

| Pattern and source | Suggested contract for Companion |
| --- | --- |
| [Morning brief](https://pally.com/recipes/morning-brief) | Save the user's chosen time, timezone, sources and destination; preserve links to source material and deliver the scheduled edition. |
| [Friendly nag](https://pally.com/recipes/the-friendly-nag) | Distinguish one unfinished task from a standing routine; stop on completion, cancellation or an explicit pause. |
| [Workout accountability](https://pally.com/recipes/workout-accountability) | Store the user's rules for rest, illness and missed sessions; record confirmations rather than infer completion. |
| [WhatsApp catch-up](https://pally.com/recipes/whatsapp-catch-up) | Bound the unread interval, identify open questions and preserve conversation provenance; reading does not authorize sending. |
| [People memory](https://pally.com/recipes/people-memory) | Attach facts to the correct person with evidence; allow correction and deletion without creating duplicate identities. |
| [Follow-up chaser](https://pally.com/recipes/follow-up-chaser) | Re-read the conversation before nudging; stop after a reply or the agreed deadline. |
| [Say it later](https://pally.com/recipes/say-it-later) | Pin the approved recipient, content, sender and time; edits invalidate any approval of an older version. |
| [Price watch](https://pally.com/recipes/price-drop-watch) | Persist the watched item and threshold; alert on a meaningful transition and expire stale watches. |
| [Buy it for me](https://pally.com/recipes/buy-it-for-me) | Show the exact purchase and total before commitment; distinguish an attempted checkout from a confirmed order. |
| [Flight check-in](https://pally.com/recipes/flight-checkin) | Represent opening windows, traveler identity, human verification and the actual boarding-pass outcome. |
| [Receipt keeper](https://pally.com/recipes/receipt-keeper) | Make forwarding rules explicit, including destination and scope; deduplicate processed receipts. |
| [Meeting memory](https://pally.com/recipes/meeting-memory) | Preserve meeting provenance and separate an extracted action item from an accepted assignment. |
| [Your day, rebuilt](https://pally.com/recipes/day-rebuilt) | Preserve fixed commitments; review proposed calendar changes against fresh availability. |
| [Coding agents](https://pally.com/recipes/coding-agents) | Bind work to a granted repository, track progress and distinguish local changes from an authorized publication. |
| [Make it move](https://pally.com/recipes/make-it-move) | Return progress for long media generation, then deliver the actual artifact or a clear failure. |

The gallery also covers calls, local errands, quotes, groceries, group coordination, images, songs, travel, spending and health logs. A catalog entry is not an endorsement of medical advice or evidence that its integration exists locally.

## Integration architecture and reuse

The privacy policy identifies Composio as the OAuth connection broker, separate messaging and commerce providers, a local Mac companion, and optional cloud Macs. LinkedIn credentials and caches stay local, but retrieved content can enter the conversation and embedding inputs reach an AI provider. Notes access is scoped to a folder; returned content also becomes conversation data. Bank access is read-only; purchases use a separate payment path. Shared generalized playbooks are described as enabled by default with opt-out. These are vendor claims, not an audited security assessment. [Privacy](https://pally.com/privacy).

Pally exposes an assistant-level MCP interface: `message_pally` returns a reply or long-job handle; `check_pally` collects the result. The documented endpoint is `https://agent.pally.com/mcp`, using Streamable HTTP and OAuth with dynamic client registration and PKCE. Linking an existing account requires texting a displayed code from the user's phone. Public OAuth discovery returned metadata; login and tool behavior were not tested. [MCP documentation](https://pally.com/mcp).

For Companion, the reusable idea is composition of existing capabilities behind one conversational executor. Pally's MCP delegates to an external assistant with its own authority; it does not expose a portable recipe graph. Composio is a candidate to evaluate, not an approved replacement for Eve integrations. Prefer the existing registry, then inspect missing action contracts. Sim remains a separate selective-code-reuse candidate; the Treg and n8n license constraints in [reuse assessment](reuse-assessment.md) remain applicable.

## Reliability lessons and unresolved claims

September fixes describe draft/sent confusion, wrong calendar scope, stale thread alerts, sender drift, authentication retry loops, late reminders and duplicate calendar effects. Turn these into independent acceptance cases; the changelog proves only that Pally reports these changes. The same archive adds Square appointments, MiniMax media, hosted pages and cross-user task handoffs. [September archive](https://pally.com/whats-new/2026-09).

August adds useful cases: verify document content after editing, show the current revision in approvals, preserve corrections arriving during work, recover notifications interrupted by outages, and expose standing-rule history from stored records. It also describes export and deletion verification. [August archive](https://pally.com/whats-new/2026-08).

Keep these discrepancies visible:

- The privacy page says calls are not recorded, while the changelog's work-in-progress section mentions recordings. This does not establish that recording has shipped.
- Privacy says one-time codes are never read or entered; September entries describe automated retrieval/entry and later relaying codes. The actual current boundary is unclear.
- Broad approval claims coexist with standing rules and device hands-free settings. Do not translate them into a universal per-action confirmation guarantee.
- The September archive says browsing moved to one provider; privacy still names two. The active provider was not established.

Sources: [privacy](https://pally.com/privacy), [current work](https://pally.com/whats-new), [September changes](https://pally.com/whats-new/2026-09).

Before adopting a pattern, specify its trigger, connection, account, grants, destination, cancellation behavior and observable completion. Preserve the agreed conversational interface and existing executor. A public recipe can inspire that contract; it cannot qualify its implementation.
