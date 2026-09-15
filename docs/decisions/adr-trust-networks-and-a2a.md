# Trust networks and conversation grants

Status: network discovery, personal trust and conversation grants are implemented.
Real Synapse and native Eve now carry both human-to-bot and bot-to-bot conversations.
E2EE, federation and production qualification remain separate gates.

Updated: 2026-09-15.

Builds on: [identities and interoperability](adr-zoen-identities-and-agent-interoperability.md),
[C01 organization RBAC](adr-c01-org-workspace-rbac.md),
[shared workspaces](adr-zoen-shared-workspaces.md).

## Decision

A company is a trust network derived from current organization and workspace
membership. There is no second membership list. A pending invite is not
membership. Personal trust is an explicit invite, acceptance, revocation and
block between people. Trust is not transitive. Two companies stay separate.

`searchWorkspaceBots` is scoped to the caller's current network. A personal
bot is never listed in a company search, even when it is discoverable. Agent
Cards stay public when `discoverable` is true; knowing a username is not a
grant.

The web panel and Executor send a message through Synapse. Only the verified
homeserver event creates a task in the existing A2A channel; the send request
cannot start a second execution. The server resolves requester, destination bot,
source workspace, network and grant. No model-supplied identity selects the sender.
The grant it mints has capability `conversation` only and does not include
`files` or `ontology`. The requester does not become a member of the
destination workspace. Bearer tokens for these grants stay on the server.

Each tool call and delivery revalidates issuer membership, source project membership
and requester network access through `requireWorkspaceAccess`. Removing a member revokes
grants they issued or requested on that workspace and cancels queued tasks.
A personal block or revoked connection revokes personal-network grants.

The older internal task-chain contract remains bounded to eight rounds and ten
minutes. The customer path is stricter: a conversation grant does not expose
network tools, so the destination cannot delegate again. The unused direct tRPC
contact mutation was removed. A known `contextId` or `taskId` is not authorization.

## Matrix customer conversations

`/network` uses the existing 80% sky sheet in Portuguese, English and Spanish.
Personal invitations identify people; each published bot has its own username and
Matrix identity. Company discovery uses current company membership. Humans and
source bots have separate rooms with the target bot. Sending a question, reading
the response and closing the sheet preserve client navigation.

Private rooms use `history_visibility=joined`, disallow federation and have no
customer-accessible invitation or state permission. Appservice credentials never
reach the browser or model. Context comes only from events before the current
event in that room, as visible to the source identity; known participants are
filtered and the quoted history is bounded to 7,000 characters. The public bot
profile identifies the destination without loading private instructions or memory.

`network-bots` and `network-result` are read operations in Executor. The
`network-contact` action requires native approval for the exact destination and
text, uses the source workspace's bot identity, and reuses the native call ID as
a Synapse transaction ID. Code Mode defers this action instead of sending it.
It waits at most 45 seconds for a response, then returns an honest pending receipt.
No implicit promise of an asynchronous follow-up is made.

Revoking trust or leaving a source project immediately removes application access.
Database triggers preserve cancellation and homeserver retirement outboxes before
membership/grant cascades delete their source records. The existing minute schedule
retries native cancellation and makes both room identities leave. Queues survive
worker outages; no successful external retirement is reported before its receipt.
Previously delivered messages cannot be retracted from a recipient's device.

The implemented path accepts text. Encryption events close the conversation;
neither E2EE nor cross-server federation is advertised. WhatsApp bridge pairing and
Vaultwarden delegation are not proven by these Matrix tests.

## Alternatives rejected

- A parallel trust table for companies: it can drift from membership.
- Mixing `conversation` with `files` on one grant: a conversation would inherit
  document access.
- Dispatching the same work from Matrix inbound and A2A: two executable
  entries for one request.

## Evidence

`tests/runtime/workspace-network.integration.ts` proves company discovery and
contact, pending invites, personal accept/block, non-transitive trust, two
companies, unpublished personal bots, removal, forged fields, conversation
without files, grant isolation, cancellation before a late result, and the
round limit. `tests/runtime/workspace-agents.integration.ts` keeps classic
bearer grants and now asserts search is network-scoped.

`tests/runtime/matrix-network.integration.ts` uses real Synapse for identities,
joined history, response receipts, event replay, contextual follow-up, native
cancellation outboxes, member removal and private receipt denial. The native
`evals/launch/network.eval.ts` uses two synthetic people, two distinct bots, real
Eve sessions and Luna low; no test fixture supplies an assistant response. Run it
with the isolated harness: `pnpm eval:agent --url http://127.0.0.1:4367 --suite launch/network --repeat 3 --timeout 360000`.
The app must be built for, and started with, the Synapse appservice callback port.

The harness writes a separate `run-N-matrix.json` containing verified homeserver
event IDs, native session IDs and final telemetry counts. The generic launch
report's `liveDeliveries` counter remains zero because it does not count customer
Telegram/WhatsApp deliveries from these synthetic Matrix identities. This is a
real homeserver/model proof, not a production customer-provider qualification.
