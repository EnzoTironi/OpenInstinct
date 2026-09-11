import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { NodeServices } from "@effect/platform-node";
import { PgClient } from "@effect/sql-pg";
import { Effect, Layer, Result, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { expect, test } from "vitest";

import { ChannelAccounts, type Identity } from "../../server/accounts";
import { Artifacts } from "../../server/artifacts";
import { artifactDigest } from "../../server/artifacts/content";
import { ArtifactId, artifactLimits } from "../../server/artifacts/model";
import { Messaging } from "../../server/messaging";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { runtimeDatabase } from "./database";

const decodeArtifactId = Schema.decodeUnknownEffect(ArtifactId);

const artifactProcessResultSchema = Schema.fromJsonString(
  Schema.Struct({
    artifactId: Schema.String,
    sha256: Schema.String,
    text: Schema.String,
  })
);

const decodeArtifactProcessResult = Schema.decodeUnknownEffect(
  artifactProcessResultSchema
);

const encodeJsonUnknown = Schema.encodeSync(
  Schema.fromJsonString(Schema.Unknown)
);

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
    Effect.forEach(
      identities,
      (identity) => {
        const scope = accessScopeForUser(`better-auth:${identity.userId}`);

        return sql`DELETE FROM workspaces WHERE id = ${scope.workspaceId}`.pipe(
          Effect.andThen(sql`DELETE FROM "user" WHERE id = ${identity.userId}`),
          Effect.catch((error) => Effect.die(error))
        );
      },
      { concurrency: 1 }
    )
  );

  yield* Effect.forEach(
    [0, 1],
    Effect.fn("artifacts.fixtureIdentity")(function* () {
      const identity = yield* accounts.resolveVerifiedSender({
        channel: "telegram",
        installationId: "artifact-proof",
        senderId: randomUUID(),
      });

      identities.push(identity);
    }),
    { concurrency: 1 }
  );

  const [owner, other] = identities;

  if (!owner || !other)
    return yield* Effect.fail(new Error("Fixture accounts were not created."));
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

  const sourceInboxId = yield* decodeArtifactId(receipt.id);

  return { identityId, sourceInboxId, mediaId };
});

test("persists immutable bytes and server-owned source metadata; exact replay returns one ID and same-name new events stay distinct", () =>
  run(
    Effect.fn("run.1")(function* ({ artifacts, messaging, owner }) {
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
      ).toMatchObject({ reason: "invalid_input" });
      expect(
        yield* Effect.flip(
          artifacts.put({
            ...input,
            bytes: Buffer.from("different attachment"),
          })
        )
      ).toMatchObject({ reason: "source_conflict" });
    })
  ));

test("concurrent exact source replay has one durable ID", () =>
  run(
    Effect.fn("run.2")(function* ({ artifacts, messaging, owner }) {
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
  run(
    Effect.fn("run.3")(function* ({ artifacts, messaging, owner, other, sql }) {
      const input = yield* source(messaging, owner.id);
      yield* artifacts.put({ ...input, bytes: Buffer.from("original") });
      expect(
        yield* Effect.flip(
          artifacts.readForSource({ ...input, identityId: other.id })
        )
      ).toMatchObject({ reason: "source_invalid" });
      expect(
        yield* Effect.flip(
          artifacts.readForSource({ ...input, mediaId: randomUUID() })
        )
      ).toMatchObject({ reason: "source_invalid" });
      yield* sql`UPDATE channel_inbox SET payload = jsonb_set(payload, '{attachments,0,name}', '"changed.txt"') WHERE id = ${input.sourceInboxId}`;
      expect(yield* Effect.flip(artifacts.readForSource(input))).toMatchObject({
        reason: "source_conflict",
      });
    })
  ));

test("scopes every operation to the current account and membership, and source revocation blocks linked readers", () =>
  run(
    Effect.fn("run.4")(function* ({
      artifacts,
      messaging,
      owner,
      other,
      linked,
      sql,
    }) {
      const file = yield* artifacts.put({
        ...(yield* source(messaging, owner.id)),
        bytes: Buffer.from("account private"),
      });

      const stranger = { identityId: other.id, artifactId: file.artifactId };
      expect(yield* Effect.flip(artifacts.read(stranger))).toMatchObject({
        reason: "not_found",
      });
      expect(yield* Effect.flip(artifacts.delete(stranger))).toMatchObject({
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
      ).toMatchObject({ reason: "not_found" });
      expect(
        yield* Effect.flip(
          artifacts.read({ identityId: linked, artifactId: file.artifactId })
        )
      ).toMatchObject({ reason: "not_found" });
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
      ).toMatchObject({ reason: "not_found" });
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
      ).toMatchObject({ reason: "not_found" });
    })
  ));

test("detects persisted byte corruption before content or derivation can be returned", () =>
  run(
    Effect.fn("run.5")(function* ({ artifacts, messaging, owner, sql }) {
      const file = yield* artifacts.put({
        ...(yield* source(messaging, owner.id)),
        bytes: Buffer.from("good"),
      });

      yield* sql`UPDATE private_artifact SET content = ${Buffer.from("evil")} WHERE id = ${file.artifactId}`;
      expect(
        yield* Effect.flip(
          artifacts.read({ identityId: owner.id, artifactId: file.artifactId })
        )
      ).toMatchObject({ reason: "corrupt" });
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
      ).toMatchObject({ reason: "corrupt" });
    })
  ));

test("derived text is hash-bound and UTF-8 bounded; deletion wipes bytes and derivatives without resurrection", () =>
  run(
    Effect.fn("run.6")(function* ({ artifacts, messaging, owner, sql }) {
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
      ).toMatchObject({ reason: "source_conflict" });
      expect(
        yield* Effect.flip(
          artifacts.setDerived({
            ...access,
            sha256: file.sha256,
            kind: "text",
            text: "é".repeat(32769),
          })
        )
      ).toMatchObject({ reason: "invalid_input" });
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
        reason: "deleted",
      });
      expect(yield* Effect.flip(artifacts.readForSource(input))).toMatchObject({
        reason: "deleted",
      });
      expect(
        yield* Effect.flip(artifacts.put({ ...input, bytes }))
      ).toMatchObject({ reason: "deleted" });
      expect(
        yield* Effect.flip(
          artifacts.setDerived({
            ...access,
            sha256: file.sha256,
            kind: "text",
            text: "revive",
          })
        )
      ).toMatchObject({ reason: "deleted" });

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
  run(
    Effect.fn("run.7")(function* ({ artifacts, messaging, owner, sql }) {
      const input = yield* source(messaging, owner.id);

      const file = yield* artifacts.put({
        ...input,
        bytes: Buffer.from("constraint"),
      });

      yield* Effect.forEach(
        [
          sql`UPDATE private_artifact SET derived_text = 'orphan', derived_kind = NULL WHERE id = ${file.artifactId}`,
          sql`UPDATE private_artifact SET derived_text = ${"é".repeat(32769)}, derived_kind = 'text' WHERE id = ${file.artifactId}`,
          sql`UPDATE private_artifact SET byte_length = 0, content = ${Buffer.alloc(0)} WHERE id = ${file.artifactId}`,
        ],
        Effect.fn("artifacts.statement")(function* (statement) {
          const result = yield* Effect.result(statement);
          expect(Result.isFailure(result)).toBe(true);
        }),
        { concurrency: 1 }
      );

      expect(
        yield* Effect.flip(
          artifacts.put({
            ...input,
            bytes: Buffer.alloc(artifactLimits.bytes + 1),
          })
        )
      ).toMatchObject({ reason: "invalid_input" });
      yield* sql`DELETE FROM channel_inbox WHERE id = ${input.sourceInboxId}`;
      expect(
        yield* Effect.flip(
          artifacts.read({ identityId: owner.id, artifactId: file.artifactId })
        )
      ).toMatchObject({ reason: "not_found" });
    })
  ));

test("a fresh process reads exact persisted bytes after the writing process and its database pool have exited", () =>
  run(
    Effect.fn("artifacts.run")(function* ({ messaging, owner }) {
      const input = yield* source(messaging, owner.id);

      const program = Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

        const childPath = fileURLToPath(
          new URL("./artifacts-process.ts", import.meta.url)
        );

        const written = yield* spawner.string(
          ChildProcess.make(process.execPath, [
            "--import",
            "tsx",
            childPath,
            "put",
            encodeJsonUnknown(input),
          ])
        );

        const metadata = yield* decodeArtifactProcessResult(written);

        const read = yield* spawner.string(
          ChildProcess.make(process.execPath, [
            "--import",
            "tsx",
            childPath,
            "read",
            encodeJsonUnknown({
              identityId: owner.id,
              artifactId: metadata.artifactId,
            }),
          ])
        );

        const restored = yield* decodeArtifactProcessResult(read);
        expect(restored).toEqual({
          ...metadata,
          text: "stored before writer process exited",
        });
      }).pipe(Effect.provide(NodeServices.layer));

      yield* program;
    })
  ));
