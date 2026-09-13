# Private Zoen memory service

A small FastAPI adapter around the pinned Mem0 OSS revision in `app.py`.
PostgreSQL with pgvector stores vectors and content-free idempotency receipts.
The service runs privately on Fly; Alchemy manages its machine, secrets and
persistent volume through `../alchemy.run.ts`.

Required variables: `ZOEN_MEM0_API_KEY` (at least 32 characters),
`OPENROUTER_API_KEY`, `ZOEN_MEMORY_DATABASE_URL`. Models stay pinned by default to
openai/gpt-5-mini and openai/text-embedding-3-small (1536 dimensions).
`MEM0_TELEMETRY=false`. `/health` checks database readiness. Operations require a
constant-time bearer-token comparison and an authenticated workspace namespace.
Zoen checks current membership before calling this private API.

Each namespace has a PostgreSQL advisory lock shared across API processes.
A durable pending receipt is committed before a provider write. Completed retries
return the original receipt; an ambiguous write fails closed with 409 instead of
possibly duplicating a mutation. Clearing memory preserves receipts so a replay
cannot resurrect erased facts. Provider errors do not expose prompts or keys.

On first start, `migrate_legacy.py` atomically imports vectors from `/data/vectors`
and receipts from `/data/operations.db`. It validates embedding dimensions,
refuses to merge independent stores, commits a migration marker, and retains the
source volume. A restart never imports cleared memory again. Mem0 extraction
history remains ephemeral; deleted facts are not retained in another durable
history store.

PostgreSQL backups cover both vectors and receipts. The original 3 GB volume and
14-day snapshots remain available during migration. The same private API contract
continues to serve the web app; the storage backend does not change user-facing
memory operations.

```sh
ZOEN_MEMORY_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/companion_runtime_test uv run pytest -q
```

Tests replace only model calls with deterministic fixtures. Real Mem0, pgvector,
PostgreSQL locks, receipt durability, tenant isolation, deletion and atomic legacy
migration are exercised. A PostgreSQL server with the vector extension is
required; the CI job builds the production database image for this purpose.
