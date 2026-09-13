import { createWorld } from "@workflow/world-postgres";
import { Config, Effect, Redacted } from "effect";
import { Pool } from "pg";
import { expect, test } from "vitest";
import { runtimeDatabase } from "./database";

test("the runtime starts its durable queue without database administration rights", async () => {
  const connectionString = Redacted.value(
    await Effect.runPromise(
      Config.redacted("DATABASE_URL").pipe(Effect.provide(runtimeDatabase))
    )
  );
  const pool = new Pool({ connectionString, max: 2 });
  const world = createWorld({
    connectionString,
    maxPoolSize: 4,
    queueConcurrency: 1,
  });
  try {
    const role = await pool.query(
      "SELECT current_user, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname=current_user"
    );
    expect(role.rows).toEqual([
      {
        current_user: "zoen_app",
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolbypassrls: false,
      },
    ]);
    await expect(
      pool.query("CREATE SCHEMA privilege_escalation_proof")
    ).rejects.toMatchObject({ code: "42501" });
    await expect(pool.query("SET ROLE zoen_migrator")).rejects.toMatchObject({
      code: "42501",
    });
    await expect(
      pool.query("SELECT * FROM drizzle.__drizzle_migrations")
    ).rejects.toMatchObject({ code: "42501" });
    await expect(world.start()).resolves.toBeUndefined();
    await expect(
      world.runs.list({ pagination: { limit: 1 } })
    ).resolves.toBeDefined();
  } finally {
    await world.close?.();
    await pool.end();
  }
});
