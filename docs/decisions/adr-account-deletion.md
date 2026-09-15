# Account deletion ledger

Status: implemented for Zoen-controlled personal data, company
retention, sole-admin transfer/close, tombstone replay, and attempted
Vaultwarden/mautrix/Synapse wipes. Unreachable providers, live Mem0 and
backup media remain pending_external.

Date: 2026-09-15.

Builds on: [personal online wipe](../self-host.md),
[C02 erasure gates](adr-c02-sso-audit-erasure.md),
[Vaultwarden delegation](adr-vaultwarden-delegation.md),
[WhatsApp user bridge](adr-whatsapp-user-bridge.md).

## Decision

`POST /api/account/delete` stays a partial online wipe. Full account
deletion is a separate durable process: suspend by invalidating sessions,
revoke identities, grants, connections, jobs and delegated vault or
WhatsApp shares, erase the personal workspace, keep company workspaces,
then write a tombstone that is reapplied before traffic after a restore.

The last remaining organization admin cannot delete until they transfer
admin or close every company workspace through an explicit Effect. The
organization row and append-only audit receipts stay. Imported contacts,
personal trust and Matrix identity rows for that person are removed.
Company git and company memberships of others are not.

Live providers are attempted after the PostgreSQL transaction commits.
Vaultwarden `DELETE /admin/users/{id}`, mautrix logout, and Synapse
`/_synapse/admin/v1/deactivate/{mxid}` mark their ledger rows `erased`
only when the fixture or provider succeeds (HTTP 404 counts as already
gone). Unconfigured or unreachable providers stay `pending_external`.
Mem0 and backups are never claimed erased here.
`requireVaultwarden` and `requireWhatsAppBridge` still fail closed.
Backups are not purged; the receipt stores an expiry instant so active
deletion is distinct from later backup expiry.

## Alternatives rejected

- Replacing the Account UI wipe with full deletion: that path is still
  documented as `partial_online_wipe` and must not start claiming backups
  or the user row are gone.
- Deleting an organization because its last admin left: receipts are
  append-only and the org FK is restrict. Close company workspaces or
  transfer admin instead.
- Treating a restored user row as authoritative: tombstones are the
  deletion source of truth and must be reapplied first.

## Evidence

`tests/runtime/account-deletion.integration.ts` proves member deletion
with company git retained, rejected unauthenticated calls, pending
external providers, backup replay of vault/WhatsApp/Matrix rows, sole-admin
block, transfer, and close-then-delete.
`tests/runtime/account-deletion-providers.integration.ts` proves fixture
wipes, fail-closed pending when the provider is down, vault retry after
recovery, and restore replay that does not resurrect deleted rows.
