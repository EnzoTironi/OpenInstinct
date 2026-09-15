# Hosted private vault

This image extends the unmodified, digest-pinned [Vaultwarden 1.37.3
source](https://github.com/dani-garcia/vaultwarden/tree/1.37.3) (AGPL-3.0).
The original branding, licenses and source links stay intact. Zoen's wrapper
adds database configuration, supervised encrypted backups and isolated recovery.
It does not handle a user's master password or keep a Bitwarden CLI session.

## Boundaries

Alchemy creates the app, TLS, volume, private bucket and retained credentials.
`zoen_vaultwarden` is a separate PostgreSQL login and database; the app runtime
cannot read it. Only verified Zoen identities can create a vault through the
first-party OIDC client. Password signup, invitation signup, email auto-linking,
public admin and organization creation are disabled. Personal vault account 2FA
uses the official client. Losing both master password and recovery material
cannot be repaired by a Zoen operator decrypting the vault.

The human client is upstream software; it is not yet a custom Zoen password
manager interface. Zoen's selected-copy import and workspace grants are separate
from the user's complete encrypted vault. No automatic synchronization is implied.

## Backup and restore

At 06:15 UTC each day, the supervisor stops the single vault writer, captures a
PostgreSQL custom dump plus `/data` (including RSA keys and encrypted attachments),
then restarts the service. The backup has a 180-second deadline. This is a brief
maintenance window, not high availability. Backups are encrypted by restic before
upload to the private Tigris bucket. Retention is 14 daily, 4 weekly and 3 monthly
snapshots. First boot requires a successful initial backup.

A failed scheduled backup records a timestamp and reopens the service. The external
operations probe checks remote snapshots, failure timestamps, a 26-hour freshness
limit and 85% disk threshold. Process `/alive` alone is not a backup proof.
Use `SIGUSR1` on the supervisor for a manual quiesced backup; invoking `backup.sh`
against a live writer is deliberately rejected. Logs remain private on the volume
and contain provider diagnostics; never publish them without review.

Recover into an **isolated, empty** volume and a separate database named
`zoen_vaultwarden_restore`. Set `ZOEN_RECOVERY_ISOLATED=true`, the recovery
PostgreSQL connection and read access to the restic repository/password, then run
`/usr/local/bin/restore.sh FULL_SNAPSHOT_ID` from this exact image. It checks all
remote backup data, verifies the restored files and restores the database without
owners/ACLs. It refuses the production database and a nonempty destination.
The replacement vault uses `/restore/data` as `DATA_FOLDER`. Do not expose it,
allow it to create backups, or reuse its database for live traffic.

Before promotion, reapply the external erasure ledger and verify current membership
and revocation state. Full external erasure replay is still a release gate; the
isolated restore drill is not permission to promote old credentials. Use the
original user key in the official client to validate item and attachment recovery;
SQL row counts alone do not establish decryptability. Keep the original volume
until rollback is no longer needed.

## Rotation and upgrades

Keep the master password, Zoen installation encryption key, OIDC signing keys,
OIDC client secret, database password and restic repository password distinct.
The first two are not interchangeable and this service never receives the human's
master password. Rotation is not a blind replacement of all Fly secrets:

- OIDC client secret: update both the Zoen confidential client and vault through
  Alchemy, restart both consumers, prove a fresh SSO flow, then retire old access.
- Database password: bootstrap the new role credential before restarting the vault.
- Backup password: add and verify a new restic repository key first; retain a
  recovery copy and remove the old key only after a successful restore drill.
- Vaultwarden signing key changes and user master-password changes follow the
  upstream client's supported flow, with session revocation and recovery tests.

No rotation drill or production deployment is claimed by the isolated proof.
Upgrade the pinned server digest deliberately, back up before changing it, validate
with compatible official clients and restore on failure. Do not run an older server
against an incompatible migrated database. Capacity beyond the small closed beta,
automatic failover, mobile clients and browser extensions need their own proofs.
