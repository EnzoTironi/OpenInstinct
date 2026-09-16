import { Effect, Schema } from "effect";
import { Client } from "pg";

import { migrateApplication } from "./migrations.ts";
import { authorizeDisposableReset } from "./reset-target.ts";

class DisposableResetFailure extends Schema.TaggedError<DisposableResetFailure>()(
  "DisposableResetFailure",
  { message: Schema.String }
) {}

const DROP_STATEMENTS = [
  "DROP SCHEMA IF EXISTS public CASCADE",
  "DROP SCHEMA IF EXISTS drizzle CASCADE",
  "DROP SCHEMA IF EXISTS workflow_drizzle CASCADE",
  "DROP SCHEMA IF EXISTS workflow CASCADE",
  "DROP SCHEMA IF EXISTS graphile_worker CASCADE",
  "DROP SCHEMA IF EXISTS pgboss CASCADE",
] as const;

/**
 * Drop application schemas in an already-authorized disposable database, then
 * run the ordinary migrate path. Migration failure still does not reset.
 */
export const resetDisposableApplication = Effect.fn(
  "resetDisposableApplication"
)(function* (connectionString: string, confirm: string) {
  yield* authorizeDisposableReset(connectionString, confirm);
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
        new DisposableResetFailure({
          message: "Cannot connect the disposable reset role.",
        }),
    }),
    (connection) => Effect.promise(() => connection.end())
  );
  for (const statement of DROP_STATEMENTS) {
    yield* Effect.tryPromise({
      try: () => client.query(statement),
      catch: () =>
        new DisposableResetFailure({
          message: "Disposable schema reset failed.",
        }),
    });
  }
  yield* Effect.tryPromise({
    try: () => client.query("CREATE SCHEMA public"),
    catch: () =>
      new DisposableResetFailure({
        message: "Disposable schema reset failed.",
      }),
  });
  return yield* migrateApplication(connectionString);
}, Effect.scoped);
