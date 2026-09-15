import { execFileSync } from "node:child_process";
import { Config, Effect, Layer } from "effect";
import { expect, test } from "vitest";
import {
  requestAccountDeletion,
  applyAccountDeletionTombstones,
} from "../../server/accounts/deletion";
import { ErasureJournal } from "../../server/accounts/erasure-journal";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { runtimeDatabase } from "./database";
import { workspaceFixture } from "./workspace-fixture";

const container = await Effect.runPromise(
  Config.string("ZOEN_RESTORE_TEST_CONTAINER").pipe(Config.withDefault(""))
);
const services = WorkspaceRepository.layer.pipe(
  Layer.provideMerge(runtimeDatabase),
  Layer.provideMerge(ErasureJournal.layer)
);

test.skipIf(!container)(
  "a full pre-deletion Postgres backup cannot rewind the external S3 erasure journal",
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        if (!container)
          throw new Error("The isolated restore container is required");
        const { guest, guestPersonal, sql } = yield* workspaceFixture();
        const backup = yield* Effect.try(() =>
          execFileSync(
            "docker",
            [
              "exec",
              container,
              "pg_dump",
              "-U",
              "postgres",
              "-d",
              "companion_runtime_test",
              "-Fc",
            ],
            { maxBuffer: 64 * 1024 * 1024 }
          )
        );
        yield* requestAccountDeletion(guest);
        expect(
          yield* sql`SELECT 1 FROM public.user WHERE id = ${guest.userId.slice("better-auth:".length)}`
        ).toHaveLength(0);
        yield* (yield* ErasureJournal).append(guest.userId);
        yield* Effect.try(() =>
          execFileSync(
            "docker",
            [
              "exec",
              "-i",
              container,
              "pg_restore",
              "--clean",
              "--if-exists",
              "--exit-on-error",
              "-U",
              "postgres",
              "-d",
              "companion_runtime_test",
            ],
            { input: backup, maxBuffer: 64 * 1024 * 1024 }
          )
        );
        expect(
          yield* sql`SELECT 1 FROM public.user WHERE id = ${guest.userId.slice("better-auth:".length)}`
        ).toHaveLength(1);
        yield* applyAccountDeletionTombstones();
        const user =
          yield* sql`SELECT 1 FROM public.user WHERE id = ${guest.userId.slice("better-auth:".length)}`;
        const workspace =
          yield* sql`SELECT 1 FROM workspaces WHERE id = ${guestPersonal.workspaceId}`;
        expect({ users: user.length, workspaces: workspace.length }).toEqual({
          users: 0,
          workspaces: 0,
        });
        yield* applyAccountDeletionTombstones();
        expect(
          yield* sql`SELECT 1 FROM public.user WHERE id = ${guest.userId.slice("better-auth:".length)}`
        ).toHaveLength(0);
      }).pipe(Effect.scoped, Effect.provide(services))
    ),
  60_000
);
