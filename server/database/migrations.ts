import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Effect, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { Client } from "pg";

class MigrationFailure extends Schema.TaggedError<MigrationFailure>()(
  "MigrationFailure",
  { message: Schema.String }
) {}

const journalRows = Schema.Array(
  Schema.Struct({ hash: Schema.String, created_at: Schema.NumberFromString })
);

/** Drizzle otherwise checks timestamps alone, which cannot detect changed history. */
export const verifyMigrationPrefix = Effect.fn("verifyMigrationPrefix")(
  function* (
    source: readonly MigrationMeta[],
    applied: readonly { hash: string; created_at: number }[],
    name: string
  ) {
    for (const [index, row] of applied.entries()) {
      const expected = source[index];
      if (
        !expected ||
        expected.hash !== row.hash ||
        expected.folderMillis !== row.created_at
      ) {
        return yield* new MigrationFailure({
          message: `${name} migration history differs at entry ${String(index + 1)}. Restore the matching source before deploying.`,
        });
      }
    }
    return undefined;
  }
);

const inspectJournal = Effect.fn("inspectMigrationJournal")(function* (
  client: Client,
  folder: string,
  schema: "drizzle" | "workflow_drizzle",
  table: "__drizzle_migrations" | "workflow_migrations"
) {
  const source = yield* Effect.try({
    try: () => readMigrationFiles({ migrationsFolder: folder }),
    catch: () =>
      new MigrationFailure({ message: `Cannot read ${schema} migrations.` }),
  });
  const result = yield* Effect.tryPromise({
    try: async () => {
      const exists = await client.query<{ present: boolean }>(
        "SELECT to_regclass($1) IS NOT NULL AS present",
        [`${schema}.${table}`]
      );
      if (!exists.rows[0]?.present) return [];
      // Identifiers are closed literals owned by this module.
      return (
        await client.query<{ hash: string; created_at: string }>(
          `SELECT hash, created_at::text FROM ${schema}.${table} ORDER BY id`
        )
      ).rows;
    },
    catch: () =>
      new MigrationFailure({
        message: `Cannot inspect ${schema} migration history.`,
      }),
  });
  const rows = yield* Schema.decodeUnknownEffect(journalRows)(result);
  yield* verifyMigrationPrefix(source, rows, schema);
  return { applied: rows.length, total: source.length };
});

/** A single session lock covers both application and Eve/Graphile migrations. */
export const migrateApplication = Effect.fn("migrateApplication")(function* (
  connectionString: string
) {
  const client = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        const connection = new Client({
          connectionString,
          connectionTimeoutMillis: 15_000,
        });
        await connection.connect();
        return connection;
      },
      catch: () =>
        new MigrationFailure({ message: "Cannot connect the migration role." }),
    }),
    (connection) => Effect.promise(() => connection.end())
  );
  yield* Effect.tryPromise({
    try: () =>
      client.query(
        "SET lock_timeout = '60s'; SELECT pg_advisory_lock(1836019566, 2)"
      ),
    catch: () =>
      new MigrationFailure({
        message: "Another deployment holds the migration lock.",
      }),
  });
  const appFolder = resolve("db/migrations");
  const workflowRoot = resolve(
    dirname(fileURLToPath(import.meta.resolve("@workflow/world-postgres"))),
    ".."
  );
  const workflowFolder = resolve(workflowRoot, "src/drizzle/migrations");
  yield* inspectJournal(client, appFolder, "drizzle", "__drizzle_migrations");
  yield* inspectJournal(
    client,
    workflowFolder,
    "workflow_drizzle",
    "workflow_migrations"
  );
  yield* Effect.tryPromise({
    try: () => migrate(drizzle(client), { migrationsFolder: appFolder }),
    catch: () =>
      new MigrationFailure({
        message: "Application migration failed; no web release was switched.",
      }),
  });
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const workflow = yield* spawner.spawn(
    ChildProcess.make(
      process.execPath,
      [resolve(workflowRoot, "bin/setup.js")],
      {
        env: { WORKFLOW_POSTGRES_URL: connectionString },
        extendEnv: true,
        stdout: "ignore",
        stderr: "ignore",
      }
    )
  );
  if ((yield* workflow.exitCode) !== 0) {
    return yield* new MigrationFailure({
      message: "Eve workflow migration failed; no web release was switched.",
    });
  }
  const app = yield* inspectJournal(
    client,
    appFolder,
    "drizzle",
    "__drizzle_migrations"
  );
  const eve = yield* inspectJournal(
    client,
    workflowFolder,
    "workflow_drizzle",
    "workflow_migrations"
  );
  if (app.applied !== app.total || eve.applied !== eve.total) {
    return yield* new MigrationFailure({
      message: "Migration verification found unapplied changes.",
    });
  }
  return {
    applicationMigrations: app.applied,
    workflowMigrations: eve.applied,
  };
}, Effect.scoped);
