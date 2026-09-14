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
| Private Matrix           | zoen-matrix-tironi, gru, 1 shared CPU / 1 GB; Synapse 1.160.0, database zoen_matrix                                 |
| Memory persistence       | PostgreSQL database zoen_memory, separate login; original encrypted 3 GB volume retained for legacy import/recovery |
| Backups                  | Private Tigris bucket, pgBackRest client-side AES-256 encryption, continuous WAL archive                            |
| Domain                   | Cloudflare A + AAAA records and Fly TLS certificate for zoen.tironi.xyz                                             |
| Infrastructure state     | Alchemy Cloudflare remote state, encrypted with a separate key in Cloudflare Secrets Store                          |

All machines remain running. PostgreSQL, memory and Matrix have no public service or IP.
Fly private networking carries their traffic. The memory and Matrix database
logins cannot connect to the application database. Application credentials are
Fly vault secrets; they do not enter Git, image layers or public CI artifacts.

The root agent keeps the `codex-local` profile. Browser execution has its own
explicit provider and vision model: production uses `codex-local` with
`gpt-5.6-luna` at low reasoning through the existing ChatGPT login. The coordinator
also uses Luna after it passed all 55 native launch gates; Spark remains configurable
but failed the Spanish persistence scenario and does not accept images. The native launch suite uses this same pair. Other
installations default to Gateway with `meta/muse-spark-1.3`; set
`COMPANION_BROWSER_MODEL_PROVIDER` and `COMPANION_BROWSER_MODEL` to change that
selection. There is no automatic provider or model fallback. The browser resolves
the live provider at each model step, as required by Eve's serialization contract,
and rejects anonymous, shared and scheduled-report sessions before resolution.
When explicitly selected, OpenRouter browser calls cap output at 4,096 tokens, including reasoning, rather
than reserving the framework's 65,536-token default. Public web search belongs to
that gated worker; the root retains scoped, read-only URL fetching.

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
`ZOEN_POSTGRES_IMAGE`, `ZOEN_MEMORY_IMAGE`, `ZOEN_MATRIX_IMAGE`, and `ZOEN_WEB_IMAGE` digest references
support adoption or a deliberate rollback. Keep the database on PostgreSQL major
17; a major upgrade requires a separate migration and recovery plan.

Alchemy creates separate `zoen_app` and `zoen_migrator` logins with independent
vault secrets. The runtime has DML and native workflow queue permissions, no DDL,
superuser, role creation, database creation, replication or RLS bypass. It cannot
assume the migrator role. Graphile's private queue tables have an explicit runtime
policy; the application does not become their owner to bypass RLS.

One Alchemy action prepares the application, memory and Matrix databases in
sequence. Their scripts update shared PostgreSQL catalogs and database permissions,
so independent parallel actions can conflict. Migrations and service updates depend
on the completed preparation, including all three credential versions.

Before switching the web image, the stack takes an incremental backup and runs
`scripts/migrate-hosted.ts` in a temporary machine with no public services, DNS
registration or persistent volume. It checks the ordered migration hashes and
timestamps before and after applying application and native workflow migrations.
A mismatch fails the release instead of repairing the journal. The temporary
machine is removed on success or failure; grants are reconciled before web startup.

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
Mem0 and Matrix endpoints through the Fly network, and verifies application role
restrictions. GitHub workflow failure notifications provide the
alert path. Cron execution on GitHub can be delayed; it is an operational probe,
not a real-time availability SLA.

Run a real production recovery drill through Alchemy:

```sh
cd infrastructure
ZOEN_RECOVERY_RUN=manual-20260913 pnpm recover:production
```

`recovery.run.ts` creates an encrypted temporary volume and an isolated machine,
restores from the encrypted object repository, runs pg_amcheck, reports only
structural results, and deletes both temporary resources. The proof requires the
application, Mem0 and Matrix databases and their restricted roles. The machine has no
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
Runtime tests migrate twice as the migrator, execute as the restricted application
role, deliver an actual Graphile HTTP job, and exercise a real private Synapse.

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

## Matrix operations

The app exposes authenticated room screens; Synapse is private and has no public
registration, federation or media API. Each room is explicitly bound to one
workspace. Earlier history is visible only from the member's Matrix join event.
Zoen is activated by a mention. Each message and tool call checks current workspace
and room membership. A native Eve job reconciles revoked members every minute;
web access is denied immediately, including while that reconciliation is pending.

Alchemy retains the homeserver signing seed, application-service tokens and database
password. Reuse these secrets when restoring the database. Rotating the signing seed
casually changes homeserver identity. Never expose application-service tokens to
the browser. The callback `/_matrix/app/v1/transactions/*` requires the homeserver
token even though it is excluded from browser sign-in middleware.

This release provides team rooms inside Zoen. Federation, end-to-end encryption,
public Matrix-client sign-in and file attachments are not enabled. See
[Matrix source and license](matrix/README.md).

## Alchemy compatibility patch

`patches/alchemy@2.0.0-beta.76.patch` extends the native Fly.Machine provider with
explicit existing-machine/volume adoption and machine checks. It verifies the
physical identities before mutation, reads actual volume metadata, and refuses
an empty replacement if an expected machine or volume is missing. This addresses
adoption of pre-existing machines without Alchemy labels. It also compares
normalized autostop values: the API returns `false` for `"off"`, and comparing
them literally causes unnecessary restarts. The patch waits for transient machine
states during updates instead of sending a second start request, with a bounded
three-minute startup wait. `pnpm test:providers` exercises these transitions and
ensures unrelated API errors still fail the deployment. Remove the patch only when an
upstream version supports these behaviors and the adoption/recovery
proofs still pass. The provider remains native; provisioning is not a shell
wrapper around flyctl.
