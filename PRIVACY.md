# Zoen beta privacy notice

Effective: September 14, 2026.

This notice describes the hosted beta. Self-hosted installations choose their own
providers, administrators and settings. Contact the administrator who invited you
for questions about your installation or a data request.

## Information processed

Zoen processes account and messenger identifiers, workspace memberships, messages,
provided files, agent instructions, stored memories and connected-service data
needed for requests. Google sign-in requests identity information; Gmail,
Calendar and Contacts use a separate connection and authorization.

Configured model, browser and integration providers receive information needed
to fulfill requests. Their retention and usage policies apply. Linking a personal
account does not give permission to share it with an employer or another group.

## Beta diagnostics

The beta can collect application activity, errors, performance, model/tool usage,
conversation traces and interface session replay. When content capture is enabled,
diagnostics can include text and content from your interaction. Authorized
operators use this to reproduce bugs, investigate incidents and improve the
product. Do not assume beta conversations are invisible to the operator.

Content capture depends on installation and workspace policy. Default diagnostic
retention is 14 days; workspace settings support 7, 14 or 30 days. Pruning applies
to diagnostic records, not automatically to conversations, Git history, backups
or third-party provider records. Diagnostic payloads are encrypted and known
credential patterns are redacted; redaction cannot guarantee removal of arbitrary
personal information from free text.

## Storage and access

PostgreSQL stores identities, operational records and execution state. Git stores
versioned files and instructions; the memory service stores scoped memory.
Credentials are separate from versioned content and are not intended for model
access. Workspace and operator permissions govern access to stored content and
diagnostics. Backups have a separate operator-controlled recovery/retention policy.

## Your controls and their limits

You can disconnect supported integrations and manage workspace access.
Disconnection prevents future authorized use; it does not retroactively remove
data already stored by Zoen or a provider.

Current account export covers personal memory only. The Account UI online wipe
(`POST /api/account/delete`) removes personal memory/profile notes and
invalidates browser sessions. It does **not** erase conversation history,
artifacts, connected accounts, schedules, channel identities, all Git history,
backups or account/workspace rows. That path is `partial_online_wipe`.

`POST /api/account/erasure` is a separate durable process for Zoen-controlled
personal data: it suspends the account, revokes sessions and connections, erases
the personal workspace and writes a tombstone so a restore cannot revive that
user. Company workspaces stay. Live copies at Mem0, Matrix, Vaultwarden, the
user WhatsApp bridge and backups remain `pending_external` until those providers
are purged. Contact the administrator for that request. These limits are also
shown in the account interface and must not be represented as complete erasure of
every third-party copy.

Never include credentials or private conversations in public issues. Report
security concerns through [private vulnerability reporting](SECURITY.md).
