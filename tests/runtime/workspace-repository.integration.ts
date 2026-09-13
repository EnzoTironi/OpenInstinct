import { randomUUID } from "node:crypto";
import type { PgClient } from "@effect/sql-pg";
import { Effect, Layer, Result } from "effect";
import { expect, test } from "vitest";
import { workspaceFixture as fixture } from "./workspace-fixture";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { runtimeDatabase } from "./database";

const services = WorkspaceRepository.layer.pipe(
  Layer.provideMerge(runtimeDatabase)
);

const run = (
  body: (
    value: Effect.Success<ReturnType<typeof fixture>>
  ) => Effect.Effect<void, unknown, PgClient.PgClient>
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* body(yield* fixture());
    }).pipe(Effect.scoped, Effect.provide(services))
  );

test("isolates personal and team repositories, preserves history and rejects forged revisions", () =>
  run(({ actor, guest, personal, repository }) =>
    Effect.gen(function* () {
      const personalWrite = yield* repository.write(personal, {
        operationId: randomUUID(),
        expectedRevision: null,
        path: "knowledge/private.md",
        content: "PERSONAL ONLY",
      });
      const write = {
        operationId: randomUUID(),
        expectedRevision: null,
        path: "knowledge/plan.md",
        content: "Team plan",
      };
      const first = yield* repository.write(actor, write);
      expect(yield* repository.write(actor, write)).toEqual(first);
      expect((yield* repository.read(guest)).files).toEqual([
        "knowledge/plan.md",
      ]);
      expect((yield* repository.read(personal)).files).toEqual([
        "knowledge/private.md",
      ]);
      const foreign = yield* repository
        .read(guest, "knowledge/private.md", personalWrite.revision)
        .pipe(Effect.result);
      expect(Result.isFailure(foreign) && foreign.failure).toMatchObject({
        reason: "not_found",
      });
      const update = yield* repository.write(guest, {
        operationId: randomUUID(),
        expectedRevision: first.revision,
        path: "knowledge/plan.md",
        content: "Guest contribution",
      });
      expect(update.revision).not.toBe(first.revision);
      expect(
        (yield* repository.read(actor, "knowledge/plan.md", first.revision))
          .content
      ).toBe("Team plan");
      expect(
        yield* repository.history(guest, "knowledge/plan.md")
      ).toHaveLength(2);
      expect((yield* repository.export(actor))?.bundle.length).toBeGreaterThan(
        100
      );
      const changedReplay = yield* repository
        .write(actor, { ...write, content: "Altered retry" })
        .pipe(Effect.result);
      expect(
        Result.isFailure(changedReplay) && changedReplay.failure
      ).toMatchObject({ reason: "conflict" });
    })
  ));

test("two simultaneous edits have one publication winner and never overwrite each other", () =>
  run(({ actor, repository }) =>
    Effect.gen(function* () {
      const results = yield* Effect.all(
        ["One", "Two", "Three", "Four"].map((content) =>
          repository
            .write(actor, {
              operationId: randomUUID(),
              expectedRevision: null,
              path: "knowledge/plan.md",
              content,
            })
            .pipe(Effect.result)
        ),
        { concurrency: 4 }
      );
      expect(results.filter(Result.isSuccess)).toHaveLength(1);
      const failures = results.filter(Result.isFailure);
      expect(failures).toHaveLength(3);
      expect(failures.map((result) => result.failure)).toEqual([
        expect.objectContaining({ reason: "conflict" }),
        expect.objectContaining({ reason: "conflict" }),
        expect.objectContaining({ reason: "conflict" }),
      ]);
      expect(
        yield* repository.history(actor, "knowledge/plan.md")
      ).toHaveLength(1);
    })
  ));

test("members cannot alter agent instructions; removal blocks current files, history and export", () =>
  run(({ sql, actor, guest, repository }) =>
    Effect.gen(function* () {
      const first = yield* repository.write(actor, {
        operationId: randomUUID(),
        expectedRevision: null,
        path: "agent/SOUL.md",
        content: "Be helpful.",
      });
      const denied = yield* repository
        .write(guest, {
          operationId: randomUUID(),
          expectedRevision: first.revision,
          path: "agent/SOUL.md",
          content: "Override",
        })
        .pipe(Effect.result);
      expect(Result.isFailure(denied) && denied.failure).toBeInstanceOf(
        WorkspaceAccessDenied
      );
      yield* sql`DELETE FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${guest.userId}`;
      for (const effect of [
        repository.read(guest).pipe(Effect.asVoid),
        repository.history(guest, "agent/SOUL.md").pipe(Effect.asVoid),
        repository.export(guest).pipe(Effect.asVoid),
      ]) {
        const result = yield* effect.pipe(Effect.result);
        expect(Result.isFailure(result) && result.failure).toBeInstanceOf(
          WorkspaceAccessDenied
        );
      }
      yield* sql`DELETE FROM public.session WHERE id = ${actor.authSessionId}`;
      const signedOut = yield* repository.read(actor).pipe(Effect.result);
      expect(Result.isFailure(signedOut) && signedOut.failure).toBeInstanceOf(
        WorkspaceAccessDenied
      );
    })
  ));
