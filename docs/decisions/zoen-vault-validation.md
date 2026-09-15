# Hosted vault validation — 15 September 2026

Status: isolated server/client evidence for the hosted vault foundation. **P05 is
not complete**: the protected browser password/TOTP runner, rotation, external
erasure and production qualification remain pending.

Environment: synthetic accounts only; local PostgreSQL 17, Vaultwarden 1.37.3,
Web Vault 2026.7.0, Bitwarden CLI 2026.8.0 under Node 22, restic 0.18.1, private
MinIO bucket. The app and tests use Node 24. The official CLI needed Node 22; the
app runtime was not downgraded. HTTPS uses a test CA trusted by the isolated vault
container. No production TLS verification was disabled.

## Completed proofs

| Proof                              | Observed result                                                                                                                                                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Independent human and agent vaults | Official clients unlocked two distinct identities; only the selected human item was copied and encrypted with the agent's key. The other item was inaccessible and the agent key could not import the human's account-restricted ciphertext.                                               |
| Canonical SSO                      | Real Vaultwarden exchanged authorization code/PKCE with the application's Better Auth handler and a synthetic verified Zoen identity; the human created a master password and encrypted an item.                                                                                           |
| Account 2FA                        | Official web client enabled authenticator 2FA. A fresh SSO login required the code, rejected missing/invalid codes, accepted a valid six-digit code beginning with zero, and still required the master password.                                                                           |
| OIDC negative integration          | Real PostgreSQL/Better Auth tests reject wrong redirect, client secret, missing/wrong PKCE, reused code, unverified user info and refresh after Zoen session deletion. No public client registration or client administration.                                                             |
| Portable export                    | The browser decoder opened actual CLI password-encrypted JSON. A separate Argon2id fixture uses the upstream known KDF vector. Tests reject wrong passwords, modified MAC/ciphertext, account-only exports and excessive work factors.                                                     |
| Full recovery                      | The supervisor quiesced the vault and backed up DB plus files. `restic check --read-data` and verified restore to a separate DB/volume succeeded. The official client decrypted original human/agent items and downloaded the original encrypted attachment from the restored SSO account. |

Portable, sanitized receipts: [vaultwarden-2026-09-15.json](evidence/vaultwarden-2026-09-15.json).
Screenshots and private synthetic fixtures are kept in the operator's artifact
store, outside the public repository. They contain no customer account.

The crypto decoder follows the public portable export format and was checked
against the official client's output and the upstream [KDF
implementation](https://github.com/bitwarden/sdk-internal/blob/main/crates/bitwarden-crypto/src/keys/kdf.rs).
The decoder uses WebCrypto and the MIT [hash-wasm](https://github.com/Daninet/hash-wasm)
Argon2 implementation; it does not incorporate proprietary SDK source.

## Not established by this proof

This is not a new-user Google OAuth journey, a production load test, a mobile-client
compatibility claim or an audit/certification. A vault's own 2FA does not prove that
an agent can safely use a site's TOTP. The existing general-purpose browser can
read DOM after fill; credentials cannot be released there until that capability is
constrained and revoked sessions cannot be reused. No live cloud endpoint or full
P05 acceptance case is marked passed solely by these receipts.
