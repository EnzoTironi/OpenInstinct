# Vaultwarden candidate and cryptographic agent delegation

Status: implemented for per-workspace agent identities and
conversation-time item wrapping. Live Vaultwarden, Bitwarden clients,
and a TOTP test site remain unavailable until a homeserver proof exists.

Date: 2026-09-14.

Builds on: [shared workspaces](adr-zoen-shared-workspaces.md),
[C01 organization RBAC](adr-c01-org-workspace-rbac.md).

## Decision

[Vaultwarden](https://github.com/dani-garcia/vaultwarden) is the candidate
Bitwarden-compatible server (AGPL-3.0). It is not vendored and is not spoken
to from this checkout. Authenticating to Zoen, unlocking a user vault, and
authorizing the agent remain three operations.

Bitwarden organization items share one organization symmetric key. Collection
membership, including Vaultwarden's `user_collections` ACL, is server-side
authorization around that key. It is not a per-item wrapping key. Zoen
therefore wraps selected item secrets for a workspace-scoped agent identity
instead of treating a collection ACL as cryptographic isolation.

Each workspace has at most one live agent identity. The identity wrapping key
is sealed with the installation secret and AAD
`vault-agent\\0workspace\\0identity`. A delegation seals a snapshot of the
user secret with the identity key and AAD
`vault-delegate\\0identity\\0item\\0grant`. `fill_from_vault` unwraps that
envelope and never reads `encrypted_secrets` for the user vault.
`list_vault` returns only live delegated metadata. There is no
`get_password` or `get_totp` tool. Bearer and wrapping material stay on the
server. tRPC does not return wrapping keys or secrets.

A company grant lives on the company workspace identity. The same person in
their personal workspace cannot unwrap it. Removing a member revokes
delegations they issued. The user vault remains; the agent envelope is a
copy taken at delegate time.

Delegated items are usable by Zoen's trusted execution path. This is not a
zero-knowledge claim for those items. No `BW_SESSION` is stored.

## Vaultwarden stays unavailable here

The plan's live acceptance needs a real Vaultwarden, a compatible client, and
a controlled site with password and TOTP. This VM has no instance.
`requireVaultwarden` fails closed. Zoen does not run the Bitwarden CLI, does
not persist a session key, and does not announce hosted vault login.

## Alternatives rejected

- Using collection membership as the only control: that is a metadata ACL on
  a shared organization key.
- Returning passwords or TOTP to the model: the fill component is the only
  consumer of `releaseDelegatedSecret`.
- Sharing one agent identity across workspaces: a personal conversation would
  inherit a company envelope.

## Evidence

`tests/runtime/vault-delegation.integration.ts` proves two items with one
delegation, fill after the user ciphertext is overwritten, the second item
denied, personal versus company isolation, revocation, expiry, member
removal, `requireVaultwarden` unavailable, and that list/tool output omit
the canary secret. `tests/agent-tool-boundaries.test.ts` keeps fill on the
delegated path and asserts there is no `get_password` or `get_totp` tool.
