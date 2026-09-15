import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Effect, Layer } from "effect";
import { test } from "vitest";
import { ensureScope } from "../../db/services/scope";
import { ChannelAccounts } from "../../server/accounts";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { runtimeDatabase } from "./database";
import { linkedIdentity } from "./identity-fixture";

test("a linked account owns its scope once and sender resolution never restores revoked membership", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const accounts = yield* ChannelAccounts;
      const sql = yield* PgClient.PgClient;
      const sender = {
        channel: "telegram" as const,
        installationId: `scope-${randomUUID()}`,
        senderId: "scope-owner",
      };
      const identity = yield* linkedIdentity(sender);
      const scope = accessScopeForUser(`better-auth:${identity.userId}`);
      yield* Effect.gen(function* () {
        const members = yield* sql`SELECT user_id FROM workspace_memberships
          WHERE workspace_id = ${scope.workspaceId} AND user_id = ${scope.userId}`;
        assert.equal(
          members.length,
          1,
          "a linked account must already own its workspace"
        );
        yield* Effect.promise(() => ensureScope(scope));
        const other = { ...scope, userId: `better-auth:${randomUUID()}` };
        yield* Effect.promise(() =>
          assert.rejects(ensureScope(other), { _tag: "ScopeAccessDenied" })
        );
        yield* sql`DELETE FROM workspace_memberships WHERE workspace_id = ${scope.workspaceId} AND user_id = ${scope.userId}`;
        yield* Effect.promise(() =>
          assert.rejects(ensureScope(scope), { _tag: "ScopeAccessDenied" })
        );
        assert.deepEqual(yield* accounts.resolveVerifiedSender(sender), {
          status: "linked",
          identity,
        });
        const remaining =
          yield* sql`SELECT user_id FROM workspace_memberships WHERE workspace_id = ${scope.workspaceId}`;
        assert.equal(
          remaining.length,
          0,
          "neither scope setup nor repeated sender resolution may restore access"
        );
      }).pipe(
        Effect.ensuring(
          sql`DELETE FROM public."user" WHERE id = ${identity.userId}`.pipe(
            Effect.andThen(
              sql`DELETE FROM workspaces WHERE id = ${scope.workspaceId}`
            ),
            Effect.orDie
          )
        )
      );
    }).pipe(
      Effect.provide(
        ChannelAccounts.layer.pipe(Layer.provideMerge(runtimeDatabase))
      )
    )
  );
});
