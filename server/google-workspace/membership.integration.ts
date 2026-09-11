import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { ResolvedInstallationSecrets } from "@db/services/installation-secrets";
import { PgClient } from "@effect/sql-pg";
import { Effect, Layer, ManagedRuntime } from "effect";
import type { SessionAuthContext } from "eve/context";

import { applicationOrigin } from "../../shared/environment/origin";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { runtimeDatabase } from "../../tests/runtime/database";
import { BrowserWorkerAccess } from "../browser-worker";
import {
  createGoogleWorkspaceChallenge,
  readGoogleWorkspaceChallenge,
} from "./challenge";
import { requireGoogleWorkspaceMembership } from "./index";

const userId = `google-membership-${randomUUID()}`;

const scope = accessScopeForUser(`better-auth:${userId}`);

const principal: SessionAuthContext = {
  attributes: { workspaceId: scope.workspaceId },
  authenticator: "test",
  principalId: scope.userId,
  principalType: "user",
};

const callback = `${applicationOrigin()}/eve/v1/connections/google-workspace/callback/attempt/token`;

const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    BrowserWorkerAccess.layer,
    ResolvedInstallationSecrets.layer
  ).pipe(Layer.provideMerge(runtimeDatabase))
);

try {
  await runtime.runPromise(
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      yield* sql`INSERT INTO workspaces (id) VALUES (${scope.workspaceId})`;
      yield* sql`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES (${scope.workspaceId}, ${scope.userId}, 'owner')`;
    })
  );

  const challenge = new URL(
    await runtime.runPromise(
      createGoogleWorkspaceChallenge(principal, callback)
    )
  );

  const flow = challenge.searchParams.get("flow");
  assert.ok(flow);
  assert.equal(
    await runtime.runPromise(readGoogleWorkspaceChallenge(flow, userId)),
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
    runtime.runPromise(createGoogleWorkspaceChallenge(principal, callback)),
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
