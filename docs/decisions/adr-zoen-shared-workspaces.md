# Zoen shared workspaces, durable files and group memory

- Status: proposed; research and implementation plan, not an enabled capability
- Date: 2026-09-13
- Builds on: [identities and interoperability](adr-zoen-identities-and-agent-interoperability.md),
  [C01 organization RBAC](adr-c01-org-workspace-rbac.md),
  [C02 audit and erasure](adr-c02-sso-audit-erasure.md), and
  [G02 group memory isolation](adr-g02-groups-memory-policy.md)

Use Git for selected durable knowledge and working documents, Matrix as a
reference for participation and history, and A2A at independent-agent boundaries.
Keep Better Auth, database authorization and Eve execution ownership. This is a
Zoen design proposal inferred from the sources below, not a claim that adopting
one of these products supplies the other parts.

## What the references establish

| Reference                                                                                                     | Evidence and limits                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Poke case study](https://code.storage/changelog/poke-case-study)                                             | Code.Storage describes use for memory, recipes, integrations and sandbox workspaces. The vendor case study does not establish that every message, attachment or credential is stored in Git.                                          |
| [Letta shared memory](https://docs.letta.com/concepts/shared-memory)                                          | Organization-owned Git repositories can be attached to multiple cloud agents, which commit, push and pull changes. This demonstrates shared files; it does not prove Zoen's guest, revocation or retention requirements.              |
| [Code.Storage](https://code.storage/docs/getting-started/introduction)                                        | Provides Git APIs, scoped authentication and Git LFS. It is a candidate storage adapter, not a selected or provisioned service.                                                                                                       |
| [Concurrent merge retries](https://code.storage/changelog/concurrent-merge-retries)                           | Native targets can retry target movement without `expectedTargetSha`; supplying that SHA gives strict optimistic concurrency. Real file conflicts still fail. Automatic retries do not validate application semantics or permissions. |
| [Matrix history visibility](https://spec.matrix.org/latest/client-server-api/#room-history-visibility)        | History access depends on membership and the policy when an event was sent. The default `shared` policy exposes earlier events to new members; it is not a suitable implicit default for external guests.                             |
| [A2A authorization](https://a2a-protocol.org/latest/specification/#131-data-access-and-authorization-scoping) | Every operation must enforce the authenticated caller's access boundary, including lists, subscriptions and cancellation. Context and task identifiers do not confer access.                                                          |

## Existing implementation to preserve

C01/C02 already provide organization and workspace membership services, invitations
and audit receipts. Browser, channel, Google and worker principals still bind to
personal workspaces; a company selector requires the complete scope propagation
described in the identity ADR.

Personal memory uses Eve's existing file-memory provider and PostgreSQL storage.
Its native operations coordinate authorization with storage transactions, including
revocation. Preserve those guarantees and its documented wipe limits; this proposal
does not move existing personal notes to Git. See
[personal memory](../../server/personal-memory/README.md).

G02 denies personal memory access in group sessions. Its shared store still returns
an empty stub; a valid group-shaped key is not a membership grant. G01/G03 provide
channel parsing and mention gates, not a complete shared-workspace authorization
system. See [group delivery boundaries](adr-g03-groups-live-e2e.md).

## Storage ownership

| Data                                                                | Authoritative owner                                                                                      |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| People, handles, bots, memberships, grants, group-to-space bindings | Existing application database, extended with explicit records                                            |
| Sessions, messages, task lifecycle, schedules and audit receipts    | Existing database and Eve execution services                                                             |
| OAuth credentials, browser credentials and signing keys             | Protected credential storage; never committed to a workspace repository                                  |
| Selected durable documents and shared knowledge                     | Private Git repository per authorization boundary; database records ownership and the published revision |
| Large versioned working files                                       | Git LFS where versioning is useful, subject to the same access and deletion policy                       |
| Raw attachments and temporary execution files                       | Scoped object storage or temporary task storage with explicit retention; no automatic Git archive        |

A personal space, company-wide space and restricted client/project space have
different audiences. A client project gets a separate workspace and repository;
an organization membership alone must not expose every project. Branches, paths
and worktrees within one repository are not privacy boundaries. Bot identities
reference these spaces; a new bot does not automatically need a new copy of memory.

## Participation and history

Persist each provider installation/group binding to a workspace, conversation and
visible bot. Verify the sender, current membership, bot capability grant and the
audience that will receive the response. A mention activates the bot; it does not
authorize a data read. One authorized employee cannot implicitly expose a private
document to everyone else in the messenger group. If the audience cannot be
verified, deny sensitive group output or require an explicit authorized publication.

Use one visible Zoen per group initially. Internal agents inherit only the grants
needed for the task. A personal connector or memory item enters a shared space only
through an explicit, scoped sharing operation with a known audience.

Define history policy when the room is created. For external guests, propose
access from joining onward, with deliberate publication of older documents when
needed. Distinguish chat history from the current shared document: neither joining
a room nor seeing today's document grants all prior Git revisions. Matrix permits
some previously visible events to remain accessible after leaving; Zoen proposes
blocking new server reads after revocation. These are different policies.

A gateway must authorize historical revisions, search results, attachments,
summaries and agent recall before returning content. Derived summaries retain the
source audience restrictions. Guests and task sandboxes receive only authorized
content, without a hidden `.git` history containing restricted material. Do not
give them direct repository credentials when their access is narrower than the
repository's reachable history.

## Concurrent changes and revocation

Start a task from an authorized revision and record its actor, bot, workspace,
audience, grants and base commit. Give it an isolated copy containing only its
authorized inputs. Only the application publisher can publish a result; task
credentials cannot push directly to a user-visible branch.

Validate the proposed changes, then merge against the exact expected base. On
concurrent movement, reload and revalidate the combined result. Do not silently
overwrite another task's edits or resolve conflicting instructions by last-write-wins.
Changes to recipes or executable skills require their own activation authority;
writing a knowledge file cannot grant a connector or install a tool.

Git and PostgreSQL do not share a transaction. For the pilot, write candidate
commits to private staging, then publish their commit ID through a database
transaction that locks/rechecks current membership and grants and compares the
previous published revision. All reads use that authorized published pointer.
Unpublished commits remain inaccessible to users and workers. Record an idempotent
publication receipt and reconcile abandoned candidates after failures. A provider
default branch must not become an alternate route around this publication gate.

Member removal and publication must serialize on the same authority records. If
revocation commits first, publication fails. Cancel affected running work, invalidate
subscriptions and cached projections, and recheck authorization at each later read,
write and delivery. Short token lifetimes alone do not provide immediate revocation;
the pilot uses the gateway rather than long-lived direct Git or object URLs.
Already delivered or downloaded information cannot be recalled from its recipient.

Deleting a file from the latest Git tree does not erase prior commits or LFS
objects. Before storing production personal data, define retention, history cleanup,
backup handling and erasure receipts. Existing personal wipe must not claim to
erase shared repositories; C02's incomplete organization erasure remains explicit.

## Channel scope and the first validation

[Chattigo's Groups documentation](https://development.chattigo.com/es/api-cloud-channel-bsp-chattigo-isv/groups/)
currently lists eight participants, one Cloud API business per group and an
Official Business Account requirement. This is evidence for that documented
offering, not confirmation that Zoen's Kapso account supports arbitrary existing
WhatsApp groups. G03 already records missing provider mention signals and outbound
group delivery. Validate the actual provider before changing those gates.

[OpenClaw's WhatsApp integration](https://docs.openclaw.ai/channels/whatsapp)
uses WhatsApp Web/Baileys and a linked session. That is a separate transport and
operating model, not a drop-in capability of the existing Cloud API connector.
Whether the product must support existing WhatsApp groups remains an open product
decision. No new transport is enabled by this document.

Implement the first storage/isolation experiment locally with synthetic accounts
and a private test repository. Reuse G02's deny rules and existing Eve execution;
do not use the pilot's personal Google account or real client documents. Add live
Telegram delivery only after the authorization and storage checks pass.

| Scenario                     | Required evidence                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Two simultaneous edits       | Both independent changes survive; a conflicting edit returns an explicit conflict, with no lost update            |
| Guest in one project         | Allowed project content works; personal, company-wide and other-project content, history and summaries are denied |
| New group participant        | No earlier restricted messages or revisions appear through search, recall or task inputs                          |
| Member removed during a task | Force revocation before publication; the write and subsequent reads, subscriptions and delivery are denied        |
| Crash around publication     | Retrying the same operation creates one receipt; an unpublished candidate never becomes visible                   |
| External A2A task            | Authorized message/task/artifact round trip works; forged workspace/task IDs and unscoped lists reveal nothing    |
| Forget and deletion          | Personal wipe leaves shared data untouched; shared cleanup reports its actual history/LFS/backup coverage         |

These are acceptance criteria, not tests already run. The next implementation
slice is persisted workspace/group grants plus the isolated publication experiment.
Usernames and the space selector can then expose real authorization boundaries;
Matrix federation and production Git migration remain separate decisions.
