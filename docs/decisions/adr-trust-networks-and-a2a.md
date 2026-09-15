# Trust networks and conversation grants

Status: implemented for network-scoped discovery, personal trust,
conversation-only A2A grants and chain limits. Live two-bot Matrix rooms
and E2EE remain unavailable until a homeserver proof exists.

Date: 2026-09-14.

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

`contactNetworkBot` is the single executable entry for talking to another
person's bot. The server resolves requester, destination bot, network,
workspace and grant. It ignores network, user or bot fields on the message.
The grant it mints has capability `conversation` only and does not include
`files` or `ontology`. The requester does not become a member of the
destination workspace. Bearer tokens for these grants stay on the server.

Each tool call and delivery revalidates issuer membership and requester
network access through `requireWorkspaceAccess`. Removing a member revokes
grants they issued or requested on that workspace and cancels queued tasks.
A personal block or revoked connection revokes personal-network grants.

Bot-to-bot continuation is a new task on the destination bot with
`originTaskId` set by the server. The chain is bounded to eight rounds and
ten minutes. A known `contextId` or `taskId` is not authorization.

## Matrix rooms stay unavailable here

The plan's live acceptance needs two humans, two Eve agents and a real
Synapse, with per-bot Matrix identities and explicit history visibility.
This checkout has no homeserver in the default developer VM. Zoen does not
create conversation rooms, does not claim E2EE and does not announce
federation. Existing organization Matrix rooms are unchanged.

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
