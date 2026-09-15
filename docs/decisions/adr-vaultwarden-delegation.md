# Vaultwarden candidate and cryptographic agent delegation

Status: workspace delegation, hosted Vaultwarden, first-party SSO and selective
client-side export import are implemented. The isolated Vaultwarden/Bitwarden
proof is complete. Protected agent browsing and target-site TOTP remain release
gates; this does not mark the whole P05 acceptance suite passed.

Updated: 2026-09-15.

Builds on: [shared workspaces](adr-zoen-shared-workspaces.md),
[C01 organization RBAC](adr-c01-org-workspace-rbac.md).

## Decision

[Vaultwarden](https://github.com/dani-garcia/vaultwarden) is the hosted
Bitwarden-compatible server (AGPL-3.0). Alchemy runs the pinned upstream image
with a separate database, TLS endpoint and encrypted backups; its source and
license remain available through the upstream project and image. Zoen does not
embed or relabel the proprietary Bitwarden client as its own implementation. Authenticating to Zoen, unlocking a user vault, and
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

## Hosted vault and selected copies

Better Auth's OAuth provider uses the canonical, verified Zoen user as the stable
OIDC subject. A confidential first-party client has one fixed redirect, PKCE,
short-lived access tokens and session-bound refresh tokens. Dynamic registration
and customer OAuth client administration are disabled. Vaultwarden is SSO-only;
password signup, invitations and automatic matching by email are disabled.
Google admission and existing verified messenger login remain Zoen's entry gates.
SSO authenticates the account; the master password unlocks ciphertext in the
human's official client. Neither the master password nor a `BW_SESSION` enters
Eve, Executor, Mem0, Git or application persistence.

Users export **password-protected JSON**, open it in a bounded browser Worker,
and select the exact logins to copy into their current workspace. PBKDF2 and
Argon2id are supported; account-restricted exports, unauthenticated ciphertext,
ambiguous/non-HTTPS origins and excessive KDF costs fail closed. The export
password stays in the browser and is cleared after opening. Non-selected items
never enter the import request. The Worker is terminated on completion, error,
timeout or unmount. JavaScript cannot promise perfect heap zeroization; closing
the import also discards its selection. Vault routes are excluded from experience
replay and the form is private.

Copies use the existing encrypted workspace vault and require a separate,
expiring agent grant. This is **not live synchronization** with Vaultwarden:
editing or deleting the human original does not update the copy. The user must
revoke or replace that copy in Zoen. Removing a grant prevents future delegated
secret release; browser session revocation is a separate acceptance gate below.

Vaultwarden account 2FA is distinct from a site's TOTP seed. The isolated official
client completed SSO, demanded a second factor, rejected empty and invalid codes,
accepted a valid code with a leading zero, then still required the master
password to decrypt the vault. Login imports preserve a site's TOTP for the
protected credential runner; there is no tool returning that seed or its codes.

## Evidence and remaining release gates

[Hosted vault evidence](zoen-vault-validation.md) records the real server/client,
independent crypto identities, OIDC negatives, client export decoder and full
DB-plus-attachment restoration. All accounts and secrets in that proof are
synthetic. The runtime suite remains the proof for Zoen's scoped grants.

The old browser path masks filled fields but has not yet established that a
subsequent DOM/script/cookie read cannot exfiltrate them. Do not activate hosted
agent password/TOTP use until the protected execution phase, cancellation,
revocation, post-login session controls and canary scan are proven. Production
availability, rotation, complete external erasure and production recovery also
remain gates. A configured `/alive` only enables the human vault link.

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
