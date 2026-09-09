import { randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { ConfigProvider, Effect, Layer, Result } from "effect";
import { expect, test } from "vitest";
import { ChannelAccounts } from "../../server/accounts";
import { Artifacts } from "../../server/artifacts";
import { readArtifactText } from "../../server/artifacts/read";
import { Messaging } from "../../server/messaging";
import { ChannelTransport } from "../../server/channels/transport";
import { Telegram } from "../../server/channels/telegram";
import { Kapso } from "../../server/channels/kapso";
import { loadChannelContent } from "../../server/channels/media/content";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { runtimeDatabase } from "./database";

const infrastructure = Layer.mergeAll(
  ChannelAccounts.layer,
  Messaging.layer,
  Telegram.layer,
  Kapso.layer
).pipe(Layer.provideMerge(runtimeDatabase));
const services = Layer.mergeAll(Artifacts.layer, ChannelTransport.layer).pipe(
  Layer.provideMerge(infrastructure)
);
const input = Effect.fn("artifacts.intakeFixture")(function* (
  mediaType: string,
  bytes: Uint8Array
) {
  const sql = yield* PgClient.PgClient;
  const owner = yield* (yield* ChannelAccounts).resolveVerifiedSender({
    channel: "telegram",
    installationId: "artifact-no-provider",
    senderId: randomUUID(),
  });
  const scope = accessScopeForUser(`better-auth:${owner.userId}`);
  yield* Effect.addFinalizer(() =>
    sql`DELETE FROM workspaces WHERE id = ${scope.workspaceId}`.pipe(
      Effect.andThen(sql`DELETE FROM "user" WHERE id = ${owner.userId}`),
      Effect.orDie
    )
  );
  const mediaId = randomUUID();
  const payload = {
    attachments: [{ id: mediaId, mediaType, name: "original.file" }],
  };
  const receipt = yield* (yield* Messaging).accept({
    identityId: owner.id,
    eventId: randomUUID(),
    sourceMessageId: randomUUID(),
    payload,
  });
  const artifacts = yield* Artifacts;
  const file = yield* artifacts.put({
    identityId: owner.id,
    sourceInboxId: receipt.id,
    mediaId,
    bytes,
  });
  return { owner, payload, receipt, file, artifacts };
});

test("actual intake recovers a saved attachment with no provider configuration and passes its stable ID and text to the model", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* input(
        "text/plain",
        Buffer.from("file data, not authority")
      );
      const loaded = yield* loadChannelContent(
        fixture.owner,
        fixture.payload,
        fixture.receipt.id
      ).pipe(
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromUnknown({})
        )
      );
      expect(loaded.artifacts.map((item) => item.artifactId)).toEqual([
        fixture.file.artifactId,
      ]);
      expect(JSON.stringify(loaded.content)).toContain(
        "file data, not authority"
      );
      expect(JSON.stringify(loaded.content)).toContain(fixture.file.artifactId);
      expect(
        (yield* readArtifactText(fixture.owner.id, fixture.file.artifactId))
          .content
      ).toEqual({ kind: "text", text: "file data, not authority" });
    }).pipe(Effect.scoped, Effect.provide(services))
  );
});

test("a saved PDF survives unsupported model input and remains retrievable without fabricated document content", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const bytes = Buffer.from("%PDF-1.7\nproof bytes without a reader");
      const fixture = yield* input("application/pdf", bytes);
      const failed = yield* Effect.result(
        loadChannelContent(fixture.owner, fixture.payload, fixture.receipt.id)
      );
      expect(Result.isFailure(failed)).toBe(true);
      if (Result.isFailure(failed))
        expect(failed.failure).toMatchObject({
          _tag: "ChannelMediaError",
          reason: "model_input_unavailable",
        });
      const stored = yield* fixture.artifacts.read({
        identityId: fixture.owner.id,
        artifactId: fixture.file.artifactId,
      });
      expect(Buffer.from(stored.bytes)).toEqual(bytes);
      expect(
        (yield* readArtifactText(fixture.owner.id, fixture.file.artifactId))
          .content
      ).toBeNull();
    }).pipe(Effect.scoped, Effect.provide(services))
  );
});

test("deleted attachments cannot be redownloaded by intake, and a revoked source cannot be reprocessed", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* input(
        "text/plain",
        Buffer.from("delete before processing")
      );
      yield* fixture.artifacts.delete({
        identityId: fixture.owner.id,
        artifactId: fixture.file.artifactId,
      });
      const deleted = yield* Effect.result(
        loadChannelContent(
          fixture.owner,
          fixture.payload,
          fixture.receipt.id
        ).pipe(
          Effect.provideService(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromUnknown({})
          )
        )
      );
      expect(Result.isFailure(deleted)).toBe(true);
      const sql = yield* PgClient.PgClient;
      const rows =
        yield* sql`SELECT content, derived_text FROM private_artifact WHERE id = ${fixture.file.artifactId}`;
      expect(rows[0]).toEqual({ content: null, derived_text: null });
      yield* sql`UPDATE channel_identity SET revoked_at = clock_timestamp() WHERE id = ${fixture.owner.id}`;
      const revoked = yield* Effect.result(
        loadChannelContent(fixture.owner, fixture.payload, fixture.receipt.id)
      );
      expect(Result.isFailure(revoked)).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(services))
  );
});
