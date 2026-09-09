import { fileURLToPath } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Effect, Layer, Result, Schema } from "effect";
import { expect, test } from "vitest";
import { ChannelAccounts, type Identity } from "../../server/accounts";
import { Artifacts } from "../../server/artifacts";
import { artifactDigest } from "../../server/artifacts/content";
import { ArtifactId, artifactLimits } from "../../server/artifacts/model";
import { Messaging } from "../../server/messaging";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { runtimeDatabase } from "./database";

const dependencies = Layer.mergeAll(
  ChannelAccounts.layer,
  Messaging.layer
).pipe(Layer.provideMerge(runtimeDatabase));
const services = Artifacts.layer.pipe(Layer.provideMerge(dependencies));
const fixture = Effect.fn("artifacts.fixture")(function* (
  body: (context: {
    artifacts: Artifacts["Service"];
    messaging: Messaging["Service"];
    sql: PgClient.PgClient;
    owner: Identity;
    other: Identity;
    linked: string;
  }) => Effect.Effect<void, unknown>
) {
  const sql = yield* PgClient.PgClient;
  const accounts = yield* ChannelAccounts;
  const identities: Identity[] = [];
  yield* Effect.addFinalizer(() =>
    Effect.forEach(identities, (identity) => {
      const scope = accessScopeForUser(`better-auth:${identity.userId}`);
      return sql`DELETE FROM workspaces WHERE id = ${scope.workspaceId}`.pipe(
        Effect.andThen(sql`DELETE FROM "user" WHERE id = ${identity.userId}`),
        Effect.orDie
      );
    })
  );
  for (let index = 0; index < 2; index++) {
    const identity = yield* accounts.resolveVerifiedSender({
      channel: "telegram",
      installationId: "artifact-proof",
      senderId: randomUUID(),
    });
    identities.push(identity);
  }
  const [owner, other] = identities;
  if (!owner || !other) throw new Error("Fixture accounts were not created.");
  const linked = randomUUID();
  yield* sql`INSERT INTO channel_identity (id, channel, installation_id, sender_id, user_id)
    VALUES (${linked}, 'kapso', 'artifact-proof', ${linked}, ${owner.userId})`;
  yield* body({
    artifacts: yield* Artifacts,
    messaging: yield* Messaging,
    sql,
    owner,
    other,
    linked,
  });
});
const run = (body: Parameters<typeof fixture>[0]) =>
  Effect.runPromise(
    fixture(body).pipe(Effect.scoped, Effect.provide(services))
  );
const source = Effect.fn("artifacts.source")(function* (
  messaging: Messaging["Service"],
  identityId: string,
  name?: string,
  mediaType?: string
) {
  const mediaId = randomUUID();
  const eventId = randomUUID();
  const receipt = yield* messaging.accept({
    identityId,
    eventId,
    sourceMessageId: `message-${eventId}`,
    payload: {
      attachments: [
        {
          id: mediaId,
          name: name ?? "notes.txt",
          mediaType: mediaType ?? "text/plain",
        },
      ],
    },
  });
  const sourceInboxId = yield* Schema.decodeUnknownEffect(ArtifactId)(
    receipt.id
  );
  return { identityId, sourceInboxId, mediaId };
});

test("persists immutable bytes and server-owned source metadata; exact replay returns one ID and same-name new events stay distinct", () =>
  run(({ artifacts, messaging, owner }) =>
    Effect.gen(function* () {
      const input = yield* source(messaging, owner.id);
      const bytes = Buffer.from("private attachment");
      const first = yield* artifacts.put({ ...input, bytes });
      expect(first).toMatchObject({
        filename: "notes.txt",
        mediaType: "text/plain",
        byteLength: bytes.length,
        sha256: artifactDigest(bytes),
        sourceMediaId: input.mediaId,
      });
      const reread = yield* artifacts.read({
        identityId: owner.id,
        artifactId: first.artifactId,
      });
      expect(Buffer.from(reread.bytes)).toEqual(bytes);
      expect(reread.metadata).toEqual(first);
      expect(yield* artifacts.put({ ...input, bytes })).toEqual(first);
      const second = yield* artifacts.put({
        ...(yield* source(messaging, owner.id)),
        bytes,
      });
      expect(second.filename).toBe(first.filename);
      expect(second.artifactId).not.toBe(first.artifactId);
      expect(
        yield* artifacts.list({ identityId: owner.id, limit: 20 })
      ).toHaveLength(2);
      expect(
        yield* Effect.flip(
          artifacts.put(
            Object.assign({}, input, { bytes, filename: "injected.txt" })
          )
        )
      ).toMatchObject({ _tag: "ArtifactError", reason: "invalid_input" });
      expect(
        yield* Effect.flip(
          artifacts.put({
            ...input,
            bytes: Buffer.from("different attachment"),
          })
        )
      ).toMatchObject({ _tag: "ArtifactError", reason: "source_conflict" });
    })
  ));

test("concurrent exact source replay has one durable ID", () =>
  run(({ artifacts, messaging, owner }) =>
    Effect.gen(function* () {
      const input = {
        ...(yield* source(messaging, owner.id)),
        bytes: Buffer.from("one source"),
      };
      const results = yield* Effect.all(
        Array.from({ length: 8 }, () => artifacts.put(input)),
        { concurrency: 8 }
      );
      expect(new Set(results.map((result) => result.artifactId)).size).toBe(1);
      expect(
        yield* artifacts.list({ identityId: owner.id, limit: 20 })
      ).toHaveLength(1);
    })
  ));

test("source lookup rejects changed source metadata and missing or foreign inbox bindings", () =>
  run(({ artifacts, messaging, owner, other, sql }) =>
    Effect.gen(function* () {
      const input = yield* source(messaging, owner.id);
      yield* artifacts.put({ ...input, bytes: Buffer.from("original") });
      expect(
        yield* Effect.flip(
          artifacts.readForSource({ ...input, identityId: other.id })
        )
      ).toMatchObject({ _tag: "ArtifactError", reason: "source_invalid" });
      expect(
        yield* Effect.flip(
          artifacts.readForSource({ ...input, mediaId: randomUUID() })
        )
      ).toMatchObject({ _tag: "ArtifactError", reason: "source_invalid" });
      yield* sql`UPDATE channel_inbox SET payload = jsonb_set(payload, '{attachments,0,name}', '"changed.txt"') WHERE id = ${input.sourceInboxId}`;
      expect(yield* Effect.flip(artifacts.readForSource(input))).toMatchObject({
        _tag: "ArtifactError",
        reason: "source_conflict",
      });
    })
  ));

test("scopes every operation to the current account and membership, and source revocation blocks linked readers", () =>
  run(({ artifacts, messaging, owner, other, linked, sql }) =>
    Effect.gen(function* () {
      const file = yield* artifacts.put({
        ...(yield* source(messaging, owner.id)),
        bytes: Buffer.from("account private"),
      });
      const stranger = { identityId: other.id, artifactId: file.artifactId };
      expect(yield* Effect.flip(artifacts.read(stranger))).toMatchObject({
        _tag: "ArtifactError",
        reason: "not_found",
      });
      expect(yield* Effect.flip(artifacts.delete(stranger))).toMatchObject({
        _tag: "ArtifactError",
        reason: "not_found",
      });
      expect(
        yield* artifacts.list({ identityId: other.id, limit: 20 })
      ).toEqual([]);
      expect(
        (yield* artifacts.read({
          identityId: linked,
          artifactId: file.artifactId,
        })).metadata.artifactId
      ).toBe(file.artifactId);
      yield* sql`UPDATE channel_identity SET revoked_at = clock_timestamp() WHERE id = ${owner.id}`;
      expect(
        yield* Effect.flip(
          artifacts.read({ identityId: owner.id, artifactId: file.artifactId })
        )
      ).toMatchObject({ _tag: "ArtifactError", reason: "not_found" });
      expect(
        yield* Effect.flip(
          artifacts.read({ identityId: linked, artifactId: file.artifactId })
        )
      ).toMatchObject({ _tag: "ArtifactError", reason: "not_found" });
      expect(
        yield* Effect.flip(
          artifacts.setDerived({
            identityId: linked,
            artifactId: file.artifactId,
            sha256: file.sha256,
            kind: "text",
            text: "private",
          })
        )
      ).toMatchObject({ _tag: "ArtifactError", reason: "not_found" });
      expect(yield* artifacts.list({ identityId: linked, limit: 20 })).toEqual(
        []
      );
      // A still-active owner may erase bytes even after disconnecting the source.
      expect(
        (yield* artifacts.delete({
          identityId: linked,
          artifactId: file.artifactId,
        })).status
      ).toBe("deleted");
      const scope = accessScopeForUser(`better-auth:${owner.userId}`);
      yield* sql`DELETE FROM workspace_memberships WHERE workspace_id = ${scope.workspaceId} AND user_id = ${scope.userId}`;
      expect(
        yield* Effect.flip(artifacts.list({ identityId: linked, limit: 20 }))
      ).toMatchObject({ _tag: "ArtifactError", reason: "not_found" });
    })
  ));

test("detects persisted byte corruption before content or derivation can be returned", () =>
  run(({ artifacts, messaging, owner, sql }) =>
    Effect.gen(function* () {
      const file = yield* artifacts.put({
        ...(yield* source(messaging, owner.id)),
        bytes: Buffer.from("good"),
      });
      yield* sql`UPDATE private_artifact SET content = ${Buffer.from("evil")} WHERE id = ${file.artifactId}`;
      expect(
        yield* Effect.flip(
          artifacts.read({ identityId: owner.id, artifactId: file.artifactId })
        )
      ).toMatchObject({ _tag: "ArtifactError", reason: "corrupt" });
      expect(
        yield* Effect.flip(
          artifacts.setDerived({
            identityId: owner.id,
            artifactId: file.artifactId,
            sha256: file.sha256,
            kind: "text",
            text: "good",
          })
        )
      ).toMatchObject({ _tag: "ArtifactError", reason: "corrupt" });
    })
  ));

test("derived text is hash-bound and UTF-8 bounded; deletion wipes bytes and derivatives without resurrection", () =>
  run(({ artifacts, messaging, owner, sql }) =>
    Effect.gen(function* () {
      const input = yield* source(messaging, owner.id);
      const bytes = Buffer.from("source text");
      const file = yield* artifacts.put({ ...input, bytes });
      const access = { identityId: owner.id, artifactId: file.artifactId };
      expect(
        yield* Effect.flip(
          artifacts.setDerived({
            ...access,
            sha256: "0".repeat(64),
            kind: "text",
            text: "wrong revision",
          })
        )
      ).toMatchObject({ _tag: "ArtifactError", reason: "source_conflict" });
      expect(
        yield* Effect.flip(
          artifacts.setDerived({
            ...access,
            sha256: file.sha256,
            kind: "text",
            text: "é".repeat(32769),
          })
        )
      ).toMatchObject({ _tag: "ArtifactError", reason: "invalid_input" });
      yield* artifacts.setDerived({
        ...access,
        sha256: file.sha256,
        kind: "text",
        text: "é".repeat(32768),
      });
      expect((yield* artifacts.read(access)).derived?.text.length).toBe(32768);
      expect(yield* artifacts.delete(access)).toEqual(
        yield* artifacts.delete(access)
      );
      expect(yield* Effect.flip(artifacts.read(access))).toMatchObject({
        _tag: "ArtifactError",
        reason: "deleted",
      });
      expect(yield* Effect.flip(artifacts.readForSource(input))).toMatchObject({
        _tag: "ArtifactError",
        reason: "deleted",
      });
      expect(
        yield* Effect.flip(artifacts.put({ ...input, bytes }))
      ).toMatchObject({ _tag: "ArtifactError", reason: "deleted" });
      expect(
        yield* Effect.flip(
          artifacts.setDerived({
            ...access,
            sha256: file.sha256,
            kind: "text",
            text: "revive",
          })
        )
      ).toMatchObject({ _tag: "ArtifactError", reason: "deleted" });
      const rows =
        yield* sql`SELECT content, derived_text, derived_kind, deleted_at IS NOT NULL AS deleted FROM private_artifact WHERE id = ${file.artifactId}`;
      expect(rows[0]).toEqual({
        content: null,
        derived_text: null,
        derived_kind: null,
        deleted: true,
      });
    })
  ));

test("database rejects orphan derived text and invalid byte lengths, and source deletion cascades", () =>
  run(({ artifacts, messaging, owner, sql }) =>
    Effect.gen(function* () {
      const input = yield* source(messaging, owner.id);
      const file = yield* artifacts.put({
        ...input,
        bytes: Buffer.from("constraint"),
      });
      for (const statement of [
        sql`UPDATE private_artifact SET derived_text = 'orphan', derived_kind = NULL WHERE id = ${file.artifactId}`,
        sql`UPDATE private_artifact SET derived_text = ${"é".repeat(32769)}, derived_kind = 'text' WHERE id = ${file.artifactId}`,
        sql`UPDATE private_artifact SET byte_length = 0, content = ${Buffer.alloc(0)} WHERE id = ${file.artifactId}`,
      ]) {
        const result = yield* Effect.result(statement);
        expect(Result.isFailure(result)).toBe(true);
      }
      expect(
        yield* Effect.flip(
          artifacts.put({
            ...input,
            bytes: Buffer.alloc(artifactLimits.bytes + 1),
          })
        )
      ).toMatchObject({ _tag: "ArtifactError", reason: "invalid_input" });
      yield* sql`DELETE FROM channel_inbox WHERE id = ${input.sourceInboxId}`;
      expect(
        yield* Effect.flip(
          artifacts.read({ identityId: owner.id, artifactId: file.artifactId })
        )
      ).toMatchObject({ _tag: "ArtifactError", reason: "not_found" });
    })
  ));

test("a fresh process reads exact persisted bytes after the writing process and its database pool have exited", () =>
  run(({ messaging, owner }) =>
    Effect.gen(function* () {
      const input = yield* source(messaging, owner.id);
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const resultSchema = Schema.fromJsonString(
        Schema.Struct({
          artifactId: Schema.String,
          sha256: Schema.String,
          text: Schema.String,
        })
      );
      const childPath = fileURLToPath(
        new URL("./artifacts-process.ts", import.meta.url)
      );
      const written = yield* spawner.string(
        ChildProcess.make(process.execPath, [
          "--import",
          "tsx",
          childPath,
          "put",
          JSON.stringify(input),
        ])
      );
      const metadata = yield* Schema.decodeUnknownEffect(resultSchema)(written);
      const read = yield* spawner.string(
        ChildProcess.make(process.execPath, [
          "--import",
          "tsx",
          childPath,
          "read",
          JSON.stringify({
            identityId: owner.id,
            artifactId: metadata.artifactId,
          }),
        ])
      );
      const restored = yield* Schema.decodeUnknownEffect(resultSchema)(read);
      expect(restored).toEqual({
        ...metadata,
        text: "stored before writer process exited",
      });
    }).pipe(Effect.provide(NodeServices.layer))
  ));
