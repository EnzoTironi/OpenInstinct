# Team agents release

Status: implementation and local acceptance complete; release gates and production
deployment are recorded separately in GitHub Actions. This ledger distinguishes
tested behavior from deployed infrastructure.

## Scope

- Public MIT repository, green hosted CI, recovery and bounded load verification.
- Workspace-owned integrations and durable team schedules with live authority.
- Personal and work bot identities, opt-in discovery, scoped revocable grants.
- Installed Executor plugins, provider tools and structured knowledge in one UI.
- Matrix room binding and self-hosted transport; authenticated A2A backed by Eve.
- Versioned ontology definitions, entities, links, actions and provenance.

## Cost and database decision

The owner explicitly chose to retain unmanaged PostgreSQL on 2026-09-13.
No managed Postgres cluster was created. Keep the existing one-CPU, 1 GiB,
10 GiB-volume machine and private networking. Add pgvector to the same PostgreSQL
17 image, validate against a restored copy before restart, and move Mem0 vectors
and operation receipts into a separate database/role on that instance.

This is a cost-conscious single-node deployment. Backups and verified restores
provide recovery, not automatic database failover. Do not enable managed database
plans or extra replicas as part of this release.

## Release invariants

Personal credentials and private learned memories never follow a team switch or
an external agent grant. Group executions use only explicitly shared workspace
knowledge. Membership and grants are checked on execution and again at every tool
call. Eve remains the sole durable execution and scheduling runtime. Git contains
authored data and manifests; credentials, membership and execution state stay in
the database. Protocol context identifiers confer no authority.

## Evidence

- Full remote branch/tag Git history scanned with Gitleaks 8.30.1 before changing
  visibility. Three matches were reviewed: a migration filename and a labelled
  local-development default also used in its test. No live credential finding.
- Repository visibility changed to public with the owner's authorization. Existing
  MIT license retained. Alchemy production deployment and isolated recovery passed
  on `14223ac2686128b377980dabc50063aa488cd711` (GitHub run `34763905952`).
- Before this release, all 37 production migration hashes/timestamps match the
  source prefix. Migrations 0037–0039 are additive; no journal repair is required.

## Acceptance evidence — 2026-09-13

- `pnpm check --concurrency=1`: 163 test files, 1,328 passed and 3 intentionally
  skipped tests; TypeScript, lint, formatting and dependency checks pass. The
  production Next/Eve build passes with the restricted application login.
- Real PostgreSQL runtime suite: 35 files, 132 tests. This includes database role
  denial, native Graphile HTTP delivery, shared Google grants and revocation,
  completed one-shot schedule leases, bots, A2A, Synapse and ontology provenance.
- An isolated structural clone of the restored production database upgraded from
  37 to 40 migrations, then repeated without changes. All 40 application and 23
  workflow hashes/timestamps match a fresh database. Existing retired tables are
  preserved; an upgrade does not silently delete legacy data.
- A native A2A request read `knowledge/launch.md` through Executor and answered
  `2026-10-20`. A separate request was interrupted with SIGKILL while working. After
  restarting the normal application command, Eve completed the same task and session.
  Replaying the same message produced one task and one native session. Another
  grant could not read it; a canceled task stayed canceled after the restart.
- Two separate Better Auth browser sessions exercised the built app. Owner and
  guest received a native Matrix answer from shared Git knowledge. The guest could
  not see the pre-join message. Removing the guest in the team UI cleared the open
  conversation and disabled sending; the backend also denies every subsequent call.
- The owner changed the bot name, created and revoked an access key, and the guest
  found the opted-in bot without gaining editing/grant controls. The personal/work
  switch displayed only each space's own files. Closing a sheet and switching
  spaces retained the same browser document. PT-BR and Spanish mobile screens and
  English desktop connections had no horizontal overflow or JavaScript errors.
- Ontology actions update a typed property once, preserve the original source
  revision, and reject stale/foreign provenance. The exported Git commit includes
  the actor, operation, action and parent commit. The source viewer opened the
  exact recorded file revision in the browser.
- The production PostgreSQL image passed encrypted full-backup and WAL-only row
  recovery, vector contents, Mem0 and Matrix databases, role credentials, runtime
  DDL denial and `pg_amcheck --all`. The isolated restore refuses to publish backups.
  Local data mounts used disposable 1 GiB tmpfs because the host Docker filesystem
  exceeded the real 85% disk alarm; the alarm was not disabled. CI uses disk volumes.
- Infrastructure TypeScript and all 14 Alchemy provider tests pass. Structural
  review flagged UI size/churn and generated migration/CI growth. Those findings
  are recorded rather than silenced. Ripwire could not resolve the dynamic
  Effect/Eve/test registrations for test selection; real suites supply the evidence.

## Protocol and product boundaries

Matrix runs a pinned private Synapse, with virtual users controlled by authenticated
Zoen sessions. Registration, federation, end-to-end encryption and attachments are
not enabled. The separate service retains its upstream AGPL license; source and
deployment details are in [the service notice](../../infrastructure/matrix/README.md).

A2A supports opted-in public Agent Cards, private cards behind a grant, SendMessage,
GetTask, ListTasks and CancelTask. Pagination and task access are grant-scoped; a context ID never grants
access. Streaming and push notifications are not advertised. Grants expose only
their declared shared files/ontology capabilities, never personal memory or OAuth
credentials. Eve owns execution, input recovery and schedules.

Google connections require an explicit team-admin sharing action. A verified
Google subject/email labels the grant; tokens remain encrypted. Token refresh uses
a database lock across processes, and revocation/re-sharing invalidates a pending
refresh. The tests use isolated provider responses; this release does not silently
copy an existing person's Google authorization into a team.

The ontology is a versioned, typed model with entities, relationships, source
revisions and constrained property actions. It prepares an auditable projection
boundary without introducing an automatic inference engine. Git remains the
authored source; database credentials and live permissions remain outside Git.

## Acceptance checklist

- [x] Self-hosted PostgreSQL, pgvector, encrypted object backups and real recovery.
- [x] Production migration journal matches the 37 released migrations exactly.
- [x] Separate application and migration roles; runtime has no DDL or cluster privileges.
- [x] Alchemy migration action before web switching, with ordered journal verification.
- [x] Team Google connections and schedules with live membership/role checks.
- [x] Personal/work bots, opt-in discovery and revocable scoped grants.
- [x] Native A2A execution, pagination, cancellation and restart/replay proofs.
- [x] Self-hosted Matrix transport and explicitly authorized room bindings.
- [x] Versioned ontology, entities, links, actions and provenance in the existing panel.
- [x] Cross-user browser proof, application checks, runtime tests and image recovery.
- [ ] Release commit: hosted CI, merge, Alchemy production deploy and isolated recovery.
