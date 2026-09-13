# Zoen identities, spaces and agent interoperability

- Status: proposed implementation; product direction agreed with Enzo
- Date: 2026-09-13
- Builds on: C01 organization/workspace RBAC and C02 company invitations

One person signs in once and can use a personal Zoen and a Zoen for each company
workspace they belong to. The public handle helps people find the person and the
bots they choose to expose. It is never an authorization credential.

## Product model

| Concept        | Identity and ownership                                            | What people see                       |
| -------------- | ----------------------------------------------------------------- | ------------------------------------- |
| Person         | Existing immutable Better Auth user ID                            | Display name and a unique `@username` |
| Personal space | Existing `personal:<hash>` workspace; its owner                   | Personal                              |
| Company space  | Existing organization, workspace and memberships                  | Company name                          |
| Personal bot   | Stable bot ID, bound to person and personal workspace             | Zoen · Personal                       |
| Work bot       | Stable bot ID, bound to company workspace and employee membership | Zoen · Company name                   |

The account page is the home for editing the handle and discoverability. A short
space selector beside the profile control offers Personal and the actual company
memberships, preserving the visual home. It must support more than one company;
a boolean work/personal flag cannot express that model. With no company access,
the account can explain how to join a company without pretending a work bot exists.

Searching a handle returns the permitted public profile and discoverable bots.
Personal discovery is opt-in. Company bots are visible to company members by
default; an administrator must explicitly publish an external capability.
No search response includes email, phone, memberships outside the viewer's access,
private agent skills, conversations or credentials.

Handles are normalized and unique within the Zoen namespace, reserved atomically
in the database, and separated from immutable IDs. A handle change does not move
ownership or create an authorization grant. Reserved old handles must not silently
resolve to another person. Display names are freely editable. The exact handle
change policy must be settled before exposing public links.

## How Matrix and A2A fit

[Matrix user identifiers](https://spec.matrix.org/latest/appendices/#user-identifiers)
are namespaced to a homeserver, in `@localpart:domain` form. Use that distinction
between identity, human-readable presentation and server authority as the reference.
If a Matrix bridge is introduced, persist its immutable Matrix ID as an explicit
mapping to the existing person/bot ID. Do not derive authorization from a mutable
Zoen handle or assume every Zoen account is already a Matrix account.

[Matrix room membership and power levels](https://spec.matrix.org/latest/client-server-api/#permissions)
provide a reference for scoped participation. A conversation belongs to a space,
and adding a participant does not grant access to unrelated rooms or private memory.
Public discovery, invitation acceptance and permission to act are separate steps.

The [A2A specification](https://a2a-protocol.org/latest/specification/)
provides Agent Cards, authenticated capabilities, messages, tasks and artifacts.
Use A2A at the boundary between independent agents. Keep Eve as the existing owner
of internal turns and durable execution. A public Agent Card alone is not a working
or conformant A2A implementation. Publish an endpoint only after its declared
operations, authentication, task lifecycle and isolation have passed round-trip tests.

A2A tenant/context/task identifiers route requests; they do not establish authority.
Bind the authenticated caller, selected bot, workspace and allowed capabilities at
the server. An external task cannot use private memory or connectors merely because
its payload contains a known workspace or task ID. Shared responses contain only
the information authorized for that request.

Buzz remains a secondary interaction reference. No Nostr relay, Matrix homeserver,
federation service or second agent runtime is introduced by this decision.

## Existing boundaries that must be extended together

The current browser request scope, messenger principals, personal memory access,
Google Workspace access and browser worker bind to the personal workspace. Google
OAuth accounts are stored by user, not by a company connection binding. Simply
changing a browser cookie would either fail those guards or leak personal access.

1. Add public handle and bot-directory persistence, with unique constraints,
   explicit visibility and viewer-scoped reads. Keep public profile data separate
   from encrypted personal memory. Register bots with stable ownership bindings.
2. Read available spaces from current database memberships. Select a space through
   a server mutation, and revalidate membership on every request and background job.
   A cookie carries only a requested selection, never a trusted AccessScope.
3. Add explicit per-workspace connection bindings and consent. Personal Google
   credentials, vault entries and memory do not automatically become company data.
   Existing personal guards remain until that binding is implemented.
4. Propagate verified space and bot identity through chat creation, Eve sessions,
   Operon principals, schedules, memory, browser execution and audit receipts.
   Switching spaces must clear client query caches and stop subscriptions from the
   previous space. Revoked memberships invalidate access to existing sessions too.
5. Implement directory/profile UI and the space selector against those services.
   Validate an employee with both spaces and an employee in two organizations.
6. Add one authenticated A2A adapter with a real message/task/result round trip,
   explicit capability grants, cancellation, replay protection and bounded costs.
   Only then expose interoperability or federation to users.

Acceptance includes simultaneous personal/work tabs, forged selections, stale
memberships, handle collisions, hidden-bot enumeration, cross-workspace task IDs,
OAuth disconnect, and a work bot trying to read the owner's personal mailbox.
Denied access remains denied even if the bot or handle is publicly discoverable.

This document specifies the implementation sequence. It does not enable company
switching, public username search, Matrix federation or an A2A endpoint by itself.
