import { Effect, Layer, Result } from "effect";
import { expect, test, vi, afterEach } from "vitest";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { runtimeDatabase } from "./database";
import { workspaceFixture } from "./workspace-fixture";
import {
  disconnectModel,
  finishModelConnection,
  modelCredentials,
  readModelConnection,
  selectWorkspaceModel,
  startModelConnection,
} from "../../server/models/connections";
import * as oauth from "../../server/models/oauth";
import { sealModelSecret } from "../../server/models/secrets";

vi.mock("../../db/services/auth", async () => {
  const { Effect: Fx } = await import("effect");
  return {
    authentication: Fx.succeed({
      $context: Promise.resolve({
        secretConfig: "synthetic-model-connection-test-key",
      }),
    }),
  };
});
const services = WorkspaceRepository.layer.pipe(
  Layer.provideMerge(runtimeDatabase)
);
afterEach(() => vi.restoreAllMocks());
const tokens = {
  accessToken: "synthetic-access",
  refreshToken: "synthetic-refresh",
  accountId: "synthetic-account",
  expiresAt: Date.now() + 3_600_000,
};

test("device authorization is bound to session and workspace, with encrypted custody and one-time completion", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { actor, guest, personal, sql } = yield* workspaceFixture();
        vi.spyOn(oauth, "beginModelOAuth").mockReturnValue(
          Effect.succeed({
            deviceCode: "synthetic-device",
            userCode: "PROOF",
            verificationUri: "https://auth.openai.com/codex/device",
            interval: 5,
            expiresIn: 900,
          })
        );
        vi.spyOn(oauth, "pollModelOAuth").mockReturnValue(
          Effect.succeed({ status: "connected", tokens })
        );
        expect(
          Result.isFailure(
            yield* startModelConnection(guest, "chatgpt").pipe(Effect.result)
          )
        ).toBe(true);
        const challenge = yield* startModelConnection(actor, "chatgpt");
        expect(
          Result.isFailure(
            yield* finishModelConnection(personal, challenge.id).pipe(
              Effect.result
            )
          )
        ).toBe(true);
        expect(
          Result.isFailure(
            yield* finishModelConnection(
              { ...actor, authSessionId: "foreign-session" },
              challenge.id
            ).pipe(Effect.result)
          )
        ).toBe(true);
        expect((yield* finishModelConnection(actor, challenge.id)).status).toBe(
          "connected"
        );
        expect(
          Result.isFailure(
            yield* finishModelConnection(actor, challenge.id).pipe(
              Effect.result
            )
          )
        ).toBe(true);
        expect((yield* modelCredentials(guest))?.tokens.accessToken).toBe(
          "synthetic-access"
        );
        expect(yield* modelCredentials(personal)).toBeNull();
        expect(JSON.stringify(yield* readModelConnection(guest))).not.toContain(
          "synthetic-access"
        );
        const raw =
          yield* sql`SELECT credentials FROM model_connections WHERE workspace_id = ${actor.workspaceId}`;
        expect(JSON.stringify(raw)).not.toContain("synthetic-refresh");
        expect(
          Result.isFailure(
            yield* selectWorkspaceModel(actor, "grok-4.6").pipe(Effect.result)
          )
        ).toBe(true);
        const before = yield* modelCredentials(actor);
        yield* disconnectModel(actor);
        expect(yield* modelCredentials(actor)).toBeNull();
        expect(
          Result.isFailure(
            yield* modelCredentials(actor, before?.revision).pipe(Effect.result)
          )
        ).toBe(true);
      })
    ).pipe(Effect.provide(services))
  ));

test("parallel workers refresh a rotating credential once; removed members lose inference access", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { actor, guest, sql } = yield* workspaceFixture();
        const encrypted = yield* sealModelSecret(
          actor.workspaceId,
          "chatgpt",
          JSON.stringify({ ...tokens, expiresAt: 0 })
        );
        yield* sql`INSERT INTO model_connections(workspace_id, provider, model, credentials, connected_by) VALUES (${actor.workspaceId}, 'chatgpt', 'gpt-5.6-luna', ${encrypted}, ${actor.userId})`;
        const refresh = vi
          .spyOn(oauth, "refreshModelOAuth")
          .mockImplementation(() =>
            Effect.sleep("30 millis").pipe(Effect.as(tokens))
          );
        const results = yield* Effect.all(
          [modelCredentials(actor), modelCredentials(guest)],
          { concurrency: 2 }
        );
        expect(
          results.every(
            (result) => result?.tokens.accessToken === tokens.accessToken
          )
        ).toBe(true);
        expect(refresh).toHaveBeenCalledTimes(1);
        yield* sql`DELETE FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${guest.userId}`;
        expect(
          Result.isFailure(yield* modelCredentials(guest).pipe(Effect.result))
        ).toBe(true);
      })
    ).pipe(Effect.provide(services))
  ));
