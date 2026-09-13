# Zoen infrastructure

`alchemy.run.ts` is the entry point for local development and hosted production.
The hosted stack uses Alchemy 2.0.0-beta.76 native Fly, Docker and Cloudflare
providers. PostgreSQL is self-hosted; no managed Postgres product is provisioned.

## Production layout

| Resource                 | Configuration                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Web + Eve                | companion-tironi, gru, 2 shared CPUs / 2 GB                                                                         |
| PostgreSQL 17 + pgvector | companion-pg-prod, gru, 1 shared CPU / 1 GB, encrypted 10 GB volume                                                 |
| Private Mem0 API         | zoen-memory-tironi, gru, 1 shared CPU / 1 GB                                                                        |
| Memory persistence       | PostgreSQL database zoen_memory, separate login; original encrypted 3 GB volume retained for legacy import/recovery |
| Backups                  | Private Tigris bucket, pgBackRest client-side AES-256 encryption, continuous WAL archive                            |
| Domain                   | Cloudflare A + AAAA records and Fly TLS certificate for zoen.tironi.xyz                                             |
| Infrastructure state     | Alchemy Cloudflare remote state, encrypted with a separate key in Cloudflare Secrets Store                          |

All machines remain running. PostgreSQL and memory have no public service or IP.
Fly private networking carries database and memory traffic. The memory database
login cannot connect to the application database. Application credentials are
Fly vault secrets; they do not enter Git, image layers or public CI artifacts.

This is one database machine, not automatic high availability. A host outage
requires recovery, and an image update can cause a brief restart. Production
operation here means measured recovery, monitored backups and controlled changes;
it does not imply zero downtime or guaranteed zero data loss.

## Deployment

Use Node 24 and the pinned pnpm version, then install both packages:

```sh
pnpm install --frozen-lockfile
pnpm --dir infrastructure install --frozen-lockfile
pnpm --dir infrastructure types:check
```

Production configuration lives in an ignored, mode-0600
`infrastructure/.env.prod`. It contains the current application secret values,
`COMPANION_POSTGRES_PASSWORD`, `FLY_API_TOKEN`, `ZOEN_DNS_API_TOKEN`, and
`ZOEN_CLOUDFLARE_ZONE_ID`. The DNS token is restricted to tironi.xyz. Cloudflare
OAuth is used locally for state bootstrap; CI uses the already-provisioned state
service token and does not need an interactive login.

`ZOEN_RELEASE` must be the full tested Git commit SHA. Alchemy builds and pushes
Linux amd64 images and deploys their immutable digests. Optional
`ZOEN_POSTGRES_IMAGE`, `ZOEN_MEMORY_IMAGE`, and `ZOEN_WEB_IMAGE` digest references
support adoption or a deliberate rollback. Keep the database on PostgreSQL major
17; a major upgrade requires a separate migration and recovery plan.

```sh
cd infrastructure
pnpm exec alchemy plan --stage prod --env-file "$PWD/.env.prod"
pnpm exec alchemy deploy --stage prod --env-file "$PWD/.env.prod" --yes
pnpm check:production
```

Inspect the plan: existing production machines and volumes must never be
replaced. Their exact IDs are pinned in `production.ts`. Changes to those IDs are
recovery operations, not routine deployment. Apps, machines, volumes, backup
storage and encryption keys are retained on stack removal. Do not use `--force`
or `destroy` as a way to clear an adoption error.

Local/dev stages use Docker through `local.ts`, preserving the existing
CompanionLocal stack and volumes. They do not use the hosted production database.
`alchemy.fly-postgres.run.ts` remains a compatibility alias for the unified stack.

## Backups and recovery

pgBackRest archives WAL continuously (`archive_timeout=60s`). The target recovery
point is about one minute plus upload delay while the archive is healthy; this
is a target, not a guarantee during a storage/network outage. Backups run in UTC:
full Sunday at 02:17, differential other days at 02:17, incremental other hours
at :17. Three full backups retain at least two weekly intervals and the WAL
needed to restore them. Fly volume snapshots are retained for 14 days as a second
recovery path.

The database image supervises PostgreSQL and the cron scheduler. Failed initial
backups do not take the database offline. The external CI probe checks the
repository itself, fails if the newest backup is older than 150 minutes, and
checks WAL archive failures, alerts at 85% disk usage, and probes the private
Mem0 endpoint through the Fly network. GitHub workflow failure notifications provide the
alert path. Cron execution on GitHub can be delayed; it is an operational probe,
not a real-time availability SLA.

Run a real production recovery drill through Alchemy:

```sh
cd infrastructure
ZOEN_RECOVERY_RUN=manual-20260913 pnpm recover:production
```

`recovery.run.ts` creates an encrypted temporary volume and an isolated machine,
restores from the encrypted object repository, runs pg_amcheck, reports only
structural results, and deletes both temporary resources. The machine has no
public services and is excluded from application DNS. It cannot archive WAL or
write backups. An optional `ZOEN_RESTORE_TARGET` timestamp selects point-in-time
recovery. No step changes the live volume or promotes the test machine.

For a real incident: restore to an isolated replacement first; verify integrity,
application schema and memory; stop writes to the old instance; update the pinned
machine/volume identities only after validation. Preserve the old volume until
rollback is no longer required. Encryption keys and state-service access must be
recoverable independently of the failed PostgreSQL machine.

## CI

`Checks` builds this exact PostgreSQL image, tests encrypted backup, WAL replay,
pgvector recovery and role isolation, runs the real Mem0 adapter against pgvector,
and runs application checks, database integration tests and the production build.

`Zoen infrastructure` runs only on main, serializes deployments and requires a
successful complete Checks run on the exact commit before a production deploy.
Every deployment ends with an isolated production recovery drill. The same drill
runs every Sunday at 04:47 UTC, after the scheduled full backup. Temporary recovery
resources are removed even if verification fails.
Its protected configuration is supplied by `ZOEN_PRODUCTION_ENV` and
`ZOEN_ALCHEMY_STATE`. The uptime workflow uses an app-scoped
`ZOEN_FLY_OPERATIONS_TOKEN`; no application secrets are required by its probe.
Rotate Fly deploy/probe tokens before their 90-day expiry. State and backup
credentials are never included in uploaded artifacts.

## Alchemy compatibility patch

`patches/alchemy@2.0.0-beta.76.patch` extends the native Fly.Machine provider with
explicit existing-machine/volume adoption and machine checks. It verifies the
physical identities before mutation, reads actual volume metadata, and refuses
an empty replacement if an expected machine or volume is missing. This addresses
adoption of pre-existing machines without Alchemy labels. Remove the patch only
when an upstream version supports these behaviors and the adoption/recovery
proofs still pass. The provider remains native; provisioning is not a shell
wrapper around flyctl.
