import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Effect, ManagedRuntime } from "effect";
import { runtimeDatabase } from "../../tests/runtime/database";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { applicationOrigin } from "../../shared/environment/origin";
import {
  createGoogleWorkspaceChallenge,
  readGoogleWorkspaceChallenge,
} from "./challenge";
import { requireGoogleWorkspaceMembership } from "./index";

const runtime = ManagedRuntime.make(runtimeDatabase);
const userId = `google-membership-${randomUUID()}`;
const scope = accessScopeForUser(`better-auth:${userId}`);
const callback = `${applicationOrigin()}/eve/v1/connections/google-workspace/callback/attempt/token`;
try {
  await runtime.runPromise(
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      yield* sql`INSERT INTO workspaces (id) VALUES (${scope.workspaceId})`;
      yield* sql`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES (${scope.workspaceId}, ${scope.userId}, 'owner')`;
    })
  );
  const challenge = new URL(
    await runtime.runPromise(createGoogleWorkspaceChallenge(scope, callback))
  );
  const flow = challenge.searchParams.get("flow");
  assert.ok(flow);
  assert.equal(
    await Effect.runPromise(readGoogleWorkspaceChallenge(flow, userId)),
    callback
  );
  await runtime.runPromise(
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      yield* sql`DELETE FROM workspace_memberships WHERE workspace_id = ${scope.workspaceId} AND user_id = ${scope.userId}`;
    })
  );
  await assert.rejects(
    runtime.runPromise(requireGoogleWorkspaceMembership(scope)),
    { reason: "unauthenticated" }
  );
  await assert.rejects(
    runtime.runPromise(createGoogleWorkspaceChallenge(scope, callback)),
    { reason: "unauthenticated" }
  );
  process.stdout.write(
    "PASS real PostgreSQL: revoked membership denies authorization and challenge issuance\n"
  );
} finally {
  await runtime.runPromise(
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      yield* sql`DELETE FROM workspaces WHERE id = ${scope.workspaceId}`;
    })
  );
  await runtime.dispose();
}
