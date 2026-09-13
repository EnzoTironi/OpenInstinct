# Zoen recovery proof — 2026-09-13

The `ZoenRecovery` Alchemy stack restored production PostgreSQL from the encrypted
Tigris pgBackRest repository on an isolated Fly machine. WAL replay completed and
`pg_amcheck --all --install-missing` passed on PostgreSQL 17.11.

| Evidence                           | Result                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Alchemy run                        | `proof-20260913-v2`                                                                                         |
| Source image                       | `registry.fly.io/companion-pg-prod@sha256:0d257ff75b7058c67addcbf94996be71cb0ff657c11fec1065b939699ccb0ff2` |
| Recovery machine created           | 2026-09-13 13:33:36 UTC                                                                                     |
| Integrity verification passed      | 2026-09-13 13:34:28 UTC                                                                                     |
| Recovered workspaces               | 5                                                                                                           |
| Temporary machine and volume       | Deleted by the Alchemy action                                                                               |
| Original production machine/volume | Preserved; health check passing                                                                             |

The 52-second observation covers this database size and region; it is not a
guaranteed recovery time for larger databases or a regional outage. The drill
does not switch application traffic to the recovered machine.

The image also passed an offline integration drill that writes a vector **after**
the full backup, restores into another volume and verifies the WAL-only row.
The restored instance refuses to write backups into the source repository.

The live Mem0 service reports the PostgreSQL backend, completed its atomic legacy
import and uses a login without superuser privileges or access to the application
database. The original memory volume remains available for recovery.

See the [infrastructure runbook](../../infrastructure/README.md) for deployment,
the weekly and post-deployment recovery jobs, backup retention and incident steps.
