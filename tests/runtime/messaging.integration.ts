import { randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Config, Context, Effect, Layer } from "effect";
import { expect, test } from "vitest";
import {
  IdentityInactive,
  InvalidMessage,
  LeaseLost,
  PayloadConflict,
  Messaging,
  type Lease,
} from "../../server/messaging";

const database = PgClient.layerConfig({
  url: Config.redacted("DATABASE_URL"),
  maxConnections: Config.succeed(8),
});
const services = Messaging.layer.pipe(Layer.provideMerge(database));

const fixture = Effect.fn("messaging.fixture")(function* (
  body: (
    messaging: Messaging["Service"],
    sql: PgClient.PgClient,
    identityId: string
  ) => Effect.Effect<void, unknown>
) {
  const sql = yield* PgClient.PgClient;
  const current = yield* sql<{
    name: string;
  }>`SELECT current_database() AS name`;
  if (current[0]?.name !== "companion_messaging_test") {
    throw new Error("Messaging integration requires its dedicated database.");
  }
  const userId = randomUUID();
  const identityId = randomUUID();
  yield* Effect.acquireRelease(
    sql`INSERT INTO "user" (id, name, email)
      VALUES (${userId}, 'Messaging proof', ${`${userId}@example.invalid`})`,
    () => sql`DELETE FROM "user" WHERE id = ${userId}`.pipe(Effect.orDie)
  );
  yield* sql`INSERT INTO channel_identity
    (id, channel, installation_id, sender_id, user_id)
    VALUES (${identityId}, 'telegram', 'messaging-proof', ${identityId}, ${userId})`;
  yield* body(yield* Messaging, sql, identityId);
});

function run(body: Parameters<typeof fixture>[0]) {
  return Effect.runPromise(
    fixture(body).pipe(Effect.scoped, Effect.provide(services))
  );
}

test("concurrent duplicate ingress commits one canonical receipt and rejects changed payload", () =>
  run((messaging, sql, identityId) =>
    Effect.gen(function* () {
      const first = {
        identityId,
        eventId: "event-1",
        sourceMessageId: "source-event-1",
        payload: {
          text: "hello",
          attachments: [
            { id: "file-1", mediaType: "image/png", name: "photo" },
          ],
        },
      };
      const reordered = {
        identityId,
        eventId: "event-1",
        sourceMessageId: "source-event-1",
        payload: {
          attachments: [
            { name: "photo", mediaType: "image/png", id: "file-1" },
          ],
          text: "hello",
        },
      };
      const receipts = yield* Effect.all(
        Array.from({ length: 12 }, (_, index) =>
          messaging.accept(index % 2 ? first : reordered)
        ),
        { concurrency: 8 }
      );
      expect(new Set(receipts.map((receipt) => receipt.id)).size).toBe(1);
      const rows = yield* sql<{ count: number }>`SELECT count(*)::int AS count
      FROM channel_inbox WHERE identity_id = ${identityId}`;
      expect(rows[0]?.count).toBe(1);
      const conflict = yield* messaging
        .accept({ ...first, payload: { text: "changed" } })
        .pipe(Effect.flip);
      expect(conflict).toBeInstanceOf(PayloadConflict);
      const original = receipts[0];
      if (!original) throw new Error("Missing receipt");
      expect(original.status).toBe("queued");
      expect(original.sourceMessageId).toBe("source-event-1");
      expect(
        yield* messaging
          .accept({ ...first, sourceMessageId: "different-provider-message" })
          .pipe(Effect.flip)
      ).toBeInstanceOf(PayloadConflict);
      const persisted = yield* sql<{
        source: string;
      }>`SELECT source_message_id AS source FROM channel_inbox WHERE id = ${original.id}`;
      expect(persisted[0]?.source).toBe("source-event-1");
      const claim = yield* Messaging.layer.pipe(
        Layer.build,
        Effect.flatMap((context) => {
          const fresh = Context.get(context, Messaging);
          return fresh.claimInbox({ identityId, leaseSeconds: 30 });
        }),
        Effect.provideService(PgClient.PgClient, sql),
        Effect.scoped
      );
      expect(claim?.sourceMessageId).toBe("source-event-1");
      expect(claim?.key).toBe("event-1");
      expect((yield* messaging.accept(first)).id).toBe(original.id);
    })
  ));

test("rejects hash/selector injection and invalid payload before persistence", () =>
  run((messaging, sql, identityId) =>
    Effect.gen(function* () {
      const input = {
        identityId,
        eventId: "invalid",
        sourceMessageId: "source-invalid",
        payload: { text: "hello" },
        eventHash: "0".repeat(64),
      };
      expect(yield* messaging.accept(input).pipe(Effect.flip)).toBeInstanceOf(
        InvalidMessage
      );
      expect(
        yield* messaging
          .accept({
            identityId,
            eventId: "empty",
            sourceMessageId: "source-empty",
            payload: {},
          })
          .pipe(Effect.flip)
      ).toBeInstanceOf(InvalidMessage);
      const unsafe = {
        identityId,
        eventId: "url",
        sourceMessageId: "source-url",
        payload: { text: "hello", url: "https://example.invalid/private" },
      };
      expect(yield* messaging.accept(unsafe).pipe(Effect.flip)).toBeInstanceOf(
        InvalidMessage
      );
      const rows =
        yield* sql`SELECT id FROM channel_inbox WHERE identity_id = ${identityId}`;
      expect(rows).toHaveLength(0);
    })
  ));

test("claims FIFO once per identity under concurrency and fences completion", () =>
  run((messaging, _sql, identityId) =>
    Effect.gen(function* () {
      const first = yield* messaging.accept({
        identityId,
        eventId: "first",
        sourceMessageId: "source-first",
        payload: { text: "one" },
      });
      const second = yield* messaging.accept({
        identityId,
        eventId: "second",
        sourceMessageId: "source-second",
        payload: { text: "two" },
      });
      const claims = yield* Effect.all(
        Array.from({ length: 10 }, () =>
          messaging.claimInbox({ identityId, leaseSeconds: 30 })
        ),
        { concurrency: 8 }
      );
      const winners = claims.filter((claim) => claim !== null);
      expect(winners).toHaveLength(1);
      const winner = winners[0];
      if (!winner) throw new Error("Expected a lease holder");
      expect(winner.id).toBe(first.id);
      const lease: Lease = {
        identityId,
        id: winner.id,
        leaseToken: winner.leaseToken,
      };
      const forged = { ...lease, leaseToken: randomUUID() };
      expect(
        yield* messaging
          .markAccepted({
            lease: forged,
            receipt: {
              status: "accepted",
              sessionId: "storage-fixture-session",
            },
          })
          .pipe(Effect.flip)
      ).toBeInstanceOf(LeaseLost);
      const completed = yield* messaging.markAccepted({
        lease,
        receipt: {
          status: "accepted",
          sessionId: "storage-fixture-session",
        },
      });
      expect(completed.status).toBe("accepted");
      expect(completed.resultId).toBe("storage-fixture-session");
      expect(
        yield* messaging.checkInboxLease(lease).pipe(Effect.flip)
      ).toBeInstanceOf(LeaseLost);
      expect(
        (yield* messaging.claimInbox({ identityId, leaseSeconds: 30 }))?.id
      ).toBe(second.id);
    })
  ));

test("expired inbox lease becomes visible uncertain and never releases later input", () =>
  run((messaging, sql, identityId) =>
    Effect.gen(function* () {
      yield* messaging.accept({
        identityId,
        eventId: "first",
        sourceMessageId: "source-first",
        payload: { text: "one" },
      });
      yield* messaging.accept({
        identityId,
        eventId: "second",
        sourceMessageId: "source-second",
        payload: { text: "two" },
      });
      const claim = yield* messaging.claimInbox({
        identityId,
        leaseSeconds: 30,
      });
      if (!claim) throw new Error("Expected a lease holder");
      yield* sql`UPDATE channel_inbox SET lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE id = ${claim.id}`;
      const lease = { identityId, id: claim.id, leaseToken: claim.leaseToken };
      expect(
        yield* messaging
          .markAccepted({
            lease,
            receipt: {
              status: "accepted",
              sessionId: "too-late",
            },
          })
          .pipe(Effect.flip)
      ).toBeInstanceOf(LeaseLost);
      expect(
        yield* messaging.claimInbox({ identityId, leaseSeconds: 30 })
      ).toBeNull();
      expect(
        yield* messaging.claimInbox({ identityId, leaseSeconds: 30 })
      ).toBeNull();
      const state = yield* messaging.inspectInbox(identityId);
      expect(state.uncertain).toHaveLength(1);
      expect(state.uncertain[0]).toMatchObject({
        id: claim.id,
        attempts: 1,
        lastError: "lease_expired",
        leaseToken: null,
      });
      expect(state.counts).toContainEqual({ status: "queued", count: 1 });
    })
  ));

test("outbox deduplicates intent, fences sends, and keeps lanes independent", () =>
  run((messaging, _sql, identityId) =>
    Effect.gen(function* () {
      const intent = {
        identityId,
        deliveryKey: "reply-1",
        payload: { text: "reply" },
      };
      const receipts = yield* Effect.all(
        [messaging.enqueue(intent), messaging.enqueue(intent)],
        { concurrency: 2 }
      );
      expect(receipts[0].id).toBe(receipts[1].id);
      expect(
        receipts.every((receipt) => receipt.sourceMessageId === null)
      ).toBe(true);
      expect(
        yield* messaging
          .enqueue({ ...intent, payload: { text: "changed" } })
          .pipe(Effect.flip)
      ).toBeInstanceOf(PayloadConflict);
      yield* messaging.accept({
        identityId,
        eventId: "input",
        sourceMessageId: "source-input",
        payload: { text: "input" },
      });
      const incoming = yield* messaging.claimInbox({
        identityId,
        leaseSeconds: 30,
      });
      const outgoing = yield* messaging.claimOutbox({
        identityId,
        leaseSeconds: 30,
      });
      expect(incoming).not.toBeNull();
      if (!outgoing)
        throw new Error("Expected outgoing lease independently of inbox");
      expect(outgoing.sourceMessageId).toBeNull();
      const lease = {
        identityId,
        id: outgoing.id,
        leaseToken: outgoing.leaseToken,
      };
      const completed = yield* messaging.markSent({
        lease,
        receipt: {
          status: "sent",
          providerMessageId: "storage-fixture-provider-id",
        },
      });
      expect(completed.status).toBe("sent");
      expect(completed.sourceMessageId).toBeNull();
      expect(completed.resultId).toBe("storage-fixture-provider-id");
      expect(
        yield* messaging
          .markSent({
            lease,
            receipt: {
              status: "sent",
              providerMessageId: "repeated",
            },
          })
          .pipe(Effect.flip)
      ).toBeInstanceOf(LeaseLost);
    })
  ));

test("expired outbox is uncertain, cannot resend, and blocks later output", () =>
  run((messaging, sql, identityId) =>
    Effect.gen(function* () {
      yield* messaging.enqueue({
        identityId,
        deliveryKey: "first",
        payload: { text: "one" },
      });
      yield* messaging.enqueue({
        identityId,
        deliveryKey: "second",
        payload: { text: "two" },
      });
      const claim = yield* messaging.claimOutbox({
        identityId,
        leaseSeconds: 30,
      });
      if (!claim) throw new Error("Expected outgoing lease");
      yield* sql`UPDATE channel_outbox SET lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE id = ${claim.id}`;
      expect(
        yield* messaging.claimOutbox({ identityId, leaseSeconds: 30 })
      ).toBeNull();
      const state = yield* messaging.inspectOutbox(identityId);
      expect(state.uncertain[0]).toMatchObject({
        id: claim.id,
        attempts: 1,
        status: "uncertain",
      });
      expect(state.counts).toContainEqual({ status: "queued", count: 1 });
    })
  ));

test("revocation blocks acceptance, dispatch, and completion and cancels queued output", () =>
  run((messaging, sql, identityId) =>
    Effect.gen(function* () {
      yield* messaging.accept({
        identityId,
        eventId: "first",
        sourceMessageId: "source-first",
        payload: { text: "one" },
      });
      yield* messaging.enqueue({
        identityId,
        deliveryKey: "first",
        payload: { text: "reply" },
      });
      const claim = yield* messaging.claimInbox({
        identityId,
        leaseSeconds: 30,
      });
      if (!claim) throw new Error("Expected incoming lease");
      yield* sql`UPDATE channel_identity SET revoked_at = clock_timestamp() WHERE id = ${identityId}`;
      expect(
        yield* messaging
          .accept({
            identityId,
            eventId: "new",
            sourceMessageId: "source-new",
            payload: { text: "blocked" },
          })
          .pipe(Effect.flip)
      ).toBeInstanceOf(IdentityInactive);
      expect(
        yield* messaging
          .enqueue({
            identityId,
            deliveryKey: "new",
            payload: { text: "blocked" },
          })
          .pipe(Effect.flip)
      ).toBeInstanceOf(IdentityInactive);
      const lease = { identityId, id: claim.id, leaseToken: claim.leaseToken };
      expect(
        yield* messaging.checkInboxLease(lease).pipe(Effect.flip)
      ).toBeInstanceOf(IdentityInactive);
      expect(
        yield* messaging
          .markAccepted({
            lease,
            receipt: { status: "accepted", sessionId: "blocked" },
          })
          .pipe(Effect.flip)
      ).toBeInstanceOf(IdentityInactive);
      expect(
        yield* messaging.claimInbox({ identityId, leaseSeconds: 30 })
      ).toBeNull();
      expect(
        yield* messaging.claimOutbox({ identityId, leaseSeconds: 30 })
      ).toBeNull();
      expect(
        (yield* messaging.inspectOutbox(identityId)).counts
      ).toContainEqual({ status: "cancelled", count: 1 });
    })
  ));

test("explicit uncertainty stores only categorical errors and remains visible", () =>
  run((messaging, _sql, identityId) =>
    Effect.gen(function* () {
      yield* messaging.enqueue({
        identityId,
        deliveryKey: "first",
        payload: { text: "reply" },
      });
      const claim = yield* messaging.claimOutbox({
        identityId,
        leaseSeconds: 30,
      });
      if (!claim) throw new Error("Expected outgoing lease");
      const lease = { identityId, id: claim.id, leaseToken: claim.leaseToken };
      const unsafe = { lease, reason: "token=secret provider traceback" };
      // Untrusted adapter errors must never be persisted as diagnostic strings.
      expect(
        yield* messaging
          .markOutboxUncertain(
            // @ts-expect-error Exercise runtime rejection of an untrusted adapter error.
            unsafe
          )
          .pipe(Effect.flip)
      ).toBeInstanceOf(InvalidMessage);
      yield* messaging.markOutboxUncertain({
        lease,
        reason: "handoff_unknown",
      });
      expect(
        yield* messaging.claimOutbox({ identityId, leaseSeconds: 30 })
      ).toBeNull();
      const state = yield* messaging.inspectOutbox(identityId);
      expect(state.uncertain[0]?.lastError).toBe("handoff_unknown");
    })
  ));

test("a confirmed rejection releases the lane but ambiguous errors cannot be terminal", () =>
  run((messaging, _sql, identityId) =>
    Effect.gen(function* () {
      yield* messaging.accept({
        identityId,
        eventId: "first",
        sourceMessageId: "source-first",
        payload: { text: "one" },
      });
      const second = yield* messaging.accept({
        identityId,
        eventId: "second",
        sourceMessageId: "source-second",
        payload: { text: "two" },
      });
      const claim = yield* messaging.claimInbox({
        identityId,
        leaseSeconds: 30,
      });
      if (!claim) throw new Error("Expected lease");
      const lease = { identityId, id: claim.id, leaseToken: claim.leaseToken };
      const ambiguous = { lease, reason: "handoff_unknown" };
      expect(
        yield* messaging
          .markInboxFailed(
            // @ts-expect-error Runtime validation must also reject an ambiguous failure.
            ambiguous
          )
          .pipe(Effect.flip)
      ).toBeInstanceOf(InvalidMessage);
      expect(
        (yield* messaging.markInboxFailed({
          lease,
          reason: "adapter_rejected",
        })).status
      ).toBe("failed");
      expect(
        (yield* messaging.claimInbox({ identityId, leaseSeconds: 30 }))?.id
      ).toBe(second.id);
    })
  ));

test("independent identities can claim the same event key without blocking each other", () =>
  run((messaging, sql, identityId) =>
    Effect.gen(function* () {
      const otherId = randomUUID();
      yield* sql`INSERT INTO channel_identity (id, channel, installation_id, sender_id, user_id)
      SELECT ${otherId}, channel, installation_id, ${otherId}, user_id
      FROM channel_identity WHERE id = ${identityId}`;
      const inputs = [identityId, otherId].map((id) => ({
        identityId: id,
        eventId: "same-key",
        sourceMessageId: "source-same-key",
        payload: { text: "hello" },
      }));
      const accepted = yield* Effect.all(
        inputs.map((input) => messaging.accept(input)),
        { concurrency: 2 }
      );
      expect(new Set(accepted.map((receipt) => receipt.id)).size).toBe(2);
      const claims = yield* Effect.all(
        [identityId, otherId].map((id) =>
          messaging.claimInbox({ identityId: id, leaseSeconds: 30 })
        ),
        { concurrency: 2 }
      );
      expect(claims.every((claim) => claim !== null)).toBe(true);
    })
  ));
