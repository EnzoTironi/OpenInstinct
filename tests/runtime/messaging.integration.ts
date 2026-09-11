import { randomUUID } from "node:crypto";

import { PgClient } from "@effect/sql-pg";
import { Context, Effect, Layer } from "effect";
import { expect, test } from "vitest";

import {
  IdentityInactive,
  InvalidMessage,
  LeaseLost,
  OutboxResolutionRejected,
  PayloadConflict,
  Messaging,
  type Lease,
} from "../../server/messaging";
import { runtimeDatabase } from "./database";

const services = Messaging.layer.pipe(Layer.provideMerge(runtimeDatabase));

const fixture = Effect.fn("messaging.fixture")(function* (
  body: (
    messaging: Messaging["Service"],
    sql: PgClient.PgClient,
    identityId: string
  ) => Effect.Effect<void, unknown>
) {
  const sql = yield* PgClient.PgClient;
  const userId = randomUUID();
  const identityId = randomUUID();
  yield* Effect.acquireRelease(
    sql`INSERT INTO "user" (id, name, email)
      VALUES (${userId}, 'Messaging proof', ${`${userId}@example.invalid`})`,
    () =>
      sql`DELETE FROM "user" WHERE id = ${userId}`.pipe(
        Effect.catch((error) => Effect.die(error))
      )
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

type MessagingService = Messaging["Service"];

interface InputResponse {
  readonly identityId: string;
  readonly sessionId: string;
  readonly sourceMessageId: string;
  readonly requestId: string;
  readonly revision: string;
  readonly decision: "approve" | "cancel";
  readonly turnId: string;
}

const claimInputResponseTwelve = (
  messaging: MessagingService,
  input: InputResponse
) =>
  Effect.all(
    Array.from({ length: 12 }, () =>
      messaging.claimChannelInputResponse(input)
    ),
    { concurrency: 8 }
  );

const inputResponsesOfKind = <K extends string>(
  results: readonly { readonly kind: K; readonly id: string }[],
  kind: K
) => results.filter((result) => result.kind === kind);

const inputResponseIds = (results: readonly { readonly id: string }[]) =>
  new Set(results.map((result) => result.id));

const claimInputThroughFreshLayer = (
  sql: PgClient.PgClient,
  input: InputResponse
) =>
  Messaging.layer.pipe(
    Layer.build,
    Effect.flatMap((context) =>
      Context.get(context, Messaging).claimChannelInputResponse(input)
    ),
    Effect.provideService(PgClient.PgClient, sql),
    Effect.scoped
  );

const prepareHandoffEight = (
  messaging: MessagingService,
  lease: Lease,
  content: readonly { readonly type: "text"; readonly text: string }[]
) =>
  Effect.all(
    Array.from({ length: 8 }, () =>
      messaging.prepareInboxHandoff({ transcripts: [], lease, content })
    ),
    { concurrency: 4 }
  );

const claimInboxEight = (messaging: MessagingService, identityId: string) =>
  Effect.all(
    Array.from({ length: 8 }, () =>
      messaging.claimInbox({ identityId, leaseSeconds: 30 })
    ),
    { concurrency: 4 }
  );

const nonNullClaims = <T>(claims: readonly (T | null)[]) =>
  claims.filter((candidate): candidate is T => candidate !== null);

test("input response fence survives concurrent replay and refuses uncertain redispatch", () =>
  run(
    Effect.fn("run.1")(function* (messaging, sql, identityId) {
      const sessionId = randomUUID();

      const input = {
        identityId,
        sessionId,
        sourceMessageId: "consent-source",
        requestId: "approval-1",
        revision: "a".repeat(64),
        decision: "approve" as const,
        turnId: "user-turn",
      };

      expect(
        yield* messaging.claimChannelInputResponse(input).pipe(Effect.flip)
      ).toBeInstanceOf(InvalidMessage);
      yield* messaging.accept({
        identityId,
        eventId: "consent-event",
        sourceMessageId: input.sourceMessageId,
        payload: { text: "pode", sourceOccurredAtMs: 1_788_900_000_000 },
      });
      expect(
        yield* messaging.claimChannelInputResponse(input).pipe(Effect.flip)
      ).toBeInstanceOf(InvalidMessage);

      const acceptedSource = yield* messaging.claimInbox({
        identityId,
        leaseSeconds: 30,
      });

      if (!acceptedSource)
        return yield* Effect.fail(new Error("Missing source claim"));
      yield* messaging.markAccepted({
        lease: {
          identityId,
          id: acceptedSource.id,
          leaseToken: acceptedSource.leaseToken,
        },
        receipt: { status: "accepted", sessionId },
      });

      const results = yield* claimInputResponseTwelve(messaging, input);

      expect(inputResponsesOfKind(results, "acquired")).toHaveLength(1);
      expect(inputResponsesOfKind(results, "duplicate")).toHaveLength(11);
      expect(inputResponseIds(results).size).toBe(1);
      const first = results[0];

      if (!first)
        return yield* Effect.fail(new Error("Missing response claim"));

      const conflictKinds = yield* Effect.forEach(
        [
          { decision: "cancel" as const },
          { revision: "b".repeat(64) },
          { turnId: "later-turn" },
        ],
        (changed) =>
          messaging
            .claimChannelInputResponse({ ...input, ...changed })
            .pipe(Effect.map((result) => result.kind)),
        { concurrency: 1 }
      );

      expect(conflictKinds).toEqual(["conflict", "conflict", "conflict"]);

      expect(
        yield* messaging.markChannelInputResponse({
          id: first.id,
          status: "uncertain",
        })
      ).toBe(true);
      expect(
        yield* messaging.markChannelInputResponse({
          id: first.id,
          status: "accepted",
        })
      ).toBe(false);

      const persisted = yield* claimInputThroughFreshLayer(sql, input);

      expect(persisted).toEqual({
        kind: "duplicate",
        id: first.id,
        status: "uncertain",
      });

      const otherRequest = yield* messaging.claimChannelInputResponse({
        ...input,
        requestId: "approval-2",
      });

      expect(otherRequest.kind).toBe("acquired");
      expect(
        yield* messaging.markChannelInputResponse({
          id: otherRequest.id,
          status: "accepted",
        })
      ).toBe(true);
      expect(
        (yield* messaging.claimChannelInputResponse({
          ...input,
          requestId: "approval-2",
        })).status
      ).toBe("accepted");
      yield* sql`UPDATE channel_identity SET revoked_at = clock_timestamp() WHERE id = ${identityId}`;
      expect(
        yield* messaging.claimChannelInputResponse(input).pipe(Effect.flip)
      ).toBeInstanceOf(IdentityInactive);
    })
  ));

test("different accepted sources cannot race approval and cancellation of one request", () =>
  run(
    Effect.fn("run.2")(function* (messaging, _sql, identityId) {
      const sessionId = randomUUID();

      yield* Effect.forEach(
        ["yes", "no"] as const,
        Effect.fn("messaging.acceptSource")(function* (sourceMessageId) {
          yield* messaging.accept({
            identityId,
            eventId: sourceMessageId,
            sourceMessageId,
            payload: { text: sourceMessageId },
          });

          const source = yield* messaging.claimInbox({
            identityId,
            leaseSeconds: 30,
          });

          if (!source)
            return yield* Effect.fail(new Error("Missing source claim"));
          yield* messaging.markAccepted({
            lease: {
              identityId,
              id: source.id,
              leaseToken: source.leaseToken,
            },
            receipt: { status: "accepted", sessionId },
          });
        }),
        { concurrency: 1 }
      );

      const common = {
        identityId,
        sessionId,
        requestId: "request",
        revision: "a".repeat(64),
        turnId: "turn",
      };

      const results = yield* Effect.all(
        [
          messaging.claimChannelInputResponse({
            ...common,
            sourceMessageId: "yes",
            decision: "approve",
          }),
          messaging.claimChannelInputResponse({
            ...common,
            sourceMessageId: "no",
            decision: "cancel",
          }),
        ],
        { concurrency: 2 }
      );

      expect(results.map((result) => result.kind).toSorted()).toEqual([
        "acquired",
        "conflict",
      ]);
      expect(results[0].id).toBe(results[1].id);
    })
  ));

test("concurrent duplicate ingress commits one canonical receipt and rejects changed payload", () =>
  run(
    Effect.fn("run.3")(function* (messaging, sql, identityId) {
      const first = {
        identityId,
        eventId: "event-1",
        sourceMessageId: "source-event-1",
        payload: {
          text: "hello",
          sourceOccurredAtMs: 1_788_900_000_000,
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
          sourceOccurredAtMs: 1_788_900_000_000,
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

      if (!original) return yield* Effect.fail(new Error("Missing receipt"));
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
      expect(claim?.payload.sourceOccurredAtMs).toBe(1_788_900_000_000);
      expect(
        yield* messaging
          .accept({
            ...first,
            payload: {
              ...first.payload,
              sourceOccurredAtMs: 1_788_900_001_000,
            },
          })
          .pipe(Effect.flip)
      ).toBeInstanceOf(PayloadConflict);
      expect(claim?.key).toBe("event-1");
      expect((yield* messaging.accept(first)).id).toBe(original.id);
    })
  ));

test("rejects hash/selector injection and invalid payload before persistence", () =>
  run(
    Effect.fn("run.4")(function* (messaging, sql, identityId) {
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
  run(
    Effect.fn("run.5")(function* (messaging, _sql, identityId) {
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

      if (!winner)
        return yield* Effect.fail(new Error("Expected a lease holder"));
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

test("an input without native protocol evidence remains uncertain and blocks later input", () =>
  run(
    Effect.fn("run.6")(function* (messaging, sql, identityId) {
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

      if (!claim)
        return yield* Effect.fail(new Error("Expected a lease holder"));
      yield* sql`UPDATE channel_inbox SET native_input = NULL, lease_expires_at = clock_timestamp() - interval '1 second'
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
  run(
    Effect.fn("run.7")(function* (messaging, _sql, identityId) {
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
        return yield* Effect.fail(
          new Error("Expected outgoing lease independently of inbox")
        );
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
  run(
    Effect.fn("run.8")(function* (messaging, sql, identityId) {
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

      if (!claim)
        return yield* Effect.fail(new Error("Expected outgoing lease"));
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
  run(
    Effect.fn("run.9")(function* (messaging, sql, identityId) {
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

      if (!claim)
        return yield* Effect.fail(new Error("Expected incoming lease"));
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
  run(
    Effect.fn("run.10")(function* (messaging, _sql, identityId) {
      yield* messaging.enqueue({
        identityId,
        deliveryKey: "first",
        payload: { text: "reply" },
      });

      const claim = yield* messaging.claimOutbox({
        identityId,
        leaseSeconds: 30,
      });

      if (!claim)
        return yield* Effect.fail(new Error("Expected outgoing lease"));
      const lease = { identityId, id: claim.id, leaseToken: claim.leaseToken };
      const unsafe = { lease, reason: "token=secret provider traceback" };

      // Untrusted adapter errors must never be persisted as diagnostic strings.
      expect(
        yield* messaging
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion -- intentional invalid adapter error
          .markOutboxUncertain(unsafe as never)
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
  run(
    Effect.fn("run.11")(function* (messaging, _sql, identityId) {
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

      if (!claim) return yield* Effect.fail(new Error("Expected lease"));
      const lease = { identityId, id: claim.id, leaseToken: claim.leaseToken };
      const ambiguous = { lease, reason: "handoff_unknown" };

      expect(
        yield* messaging
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion -- intentional ambiguous failure
          .markInboxFailed(ambiguous as never)
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
  run(
    Effect.fn("run.12")(function* (messaging, sql, identityId) {
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

test("prepared native input survives uncertain recovery with immutable content and a new lease", () =>
  run(
    Effect.fn("run.13")(function* (messaging, sql, identityId) {
      const first = yield* messaging.accept({
        identityId,
        eventId: "keyed-first",
        sourceMessageId: "keyed-source",
        payload: { text: "first" },
      });

      yield* messaging.accept({
        identityId,
        eventId: "keyed-second",
        sourceMessageId: "later-source",
        payload: { text: "second" },
      });

      const claim = yield* messaging.claimInbox({
        identityId,
        leaseSeconds: 30,
      });

      if (!claim)
        return yield* Effect.fail(new Error("Expected initial claim"));
      const lease = { identityId, id: claim.id, leaseToken: claim.leaseToken };

      const content = [
        { type: "text" as const, text: "Frozen extracted content" },
      ];

      const snapshots = yield* prepareHandoffEight(messaging, lease, content);

      for (const snapshot of snapshots) {
        expect(snapshot).toEqual(snapshots[0]);
      }

      expect(snapshots[0]).toMatchObject({
        protocol: "eve-keyed-input-v1",
        inputId: first.id,
        channel: "telegram",
        address: identityId,
        content,
      });

      const owner = yield* sql<{
        userId: string;
      }>`SELECT user_id AS "userId" FROM channel_identity WHERE id = ${identityId}`;

      const account = owner[0];

      if (!account)
        return yield* Effect.fail(new Error("Missing identity owner"));
      expect(snapshots[0]?.principalId).toBe(`better-auth:${account.userId}`);
      expect(
        yield* messaging
          .prepareInboxHandoff({ transcripts: [], lease, content: "Changed" })
          .pipe(Effect.flip)
      ).toBeInstanceOf(PayloadConflict);
      yield* messaging.markInboxUncertain({ lease, reason: "handoff_unknown" });

      const claims = yield* claimInboxEight(messaging, identityId);

      const recovered = nonNullClaims(claims);
      expect(recovered).toHaveLength(1);
      const next = recovered[0];

      if (!next)
        return yield* Effect.fail(new Error("Expected recovered claim"));
      expect(next.id).toBe(first.id);
      expect(next.nativeInput).toEqual(snapshots[0]);
      expect(next.leaseToken).not.toBe(lease.leaseToken);
      expect(next.attempts).toBe(2);
      expect(
        yield* messaging
          .prepareInboxHandoff({ transcripts: [], lease, content })
          .pipe(Effect.flip)
      ).toBeInstanceOf(LeaseLost);
      yield* messaging.markAccepted({
        lease: { identityId, id: next.id, leaseToken: next.leaseToken },
        receipt: { status: "accepted", sessionId: "native-storage-receipt" },
      });
      expect(
        (yield* messaging.claimInbox({ identityId, leaseSeconds: 30 }))?.key
      ).toBe("keyed-second");
    })
  ));

test("expired prepared input can be recovered but a revoked identity cannot prepare or retry", () =>
  run(
    Effect.fn("run.14")(function* (messaging, sql, identityId) {
      yield* messaging.accept({
        identityId,
        eventId: "expired-keyed",
        sourceMessageId: "source",
        payload: { text: "one" },
      });

      const claim = yield* messaging.claimInbox({
        identityId,
        leaseSeconds: 1,
      });

      if (!claim)
        return yield* Effect.fail(new Error("Expected initial claim"));
      const lease = { identityId, id: claim.id, leaseToken: claim.leaseToken };
      yield* messaging.prepareInboxHandoff({
        transcripts: [],
        lease,
        content: "one",
      });
      yield* Effect.sleep("1100 millis");

      const recovered = yield* messaging.claimInbox({
        identityId,
        leaseSeconds: 30,
      });

      expect(recovered?.id).toBe(claim.id);

      if (!recovered)
        return yield* Effect.fail(new Error("Expected expired input recovery"));
      yield* sql`UPDATE channel_identity SET revoked_at = clock_timestamp() WHERE id = ${identityId}`;
      expect(
        yield* messaging
          .prepareInboxHandoff({
            transcripts: [],
            lease: {
              identityId,
              id: recovered.id,
              leaseToken: recovered.leaseToken,
            },
            content: "one",
          })
          .pipe(Effect.flip)
      ).toBeInstanceOf(IdentityInactive);
      expect(
        yield* messaging.claimInbox({ identityId, leaseSeconds: 30 })
      ).toBeNull();
    })
  ));

test("a lease expiring before media preparation retains its native key and fences the old worker", () =>
  run(
    Effect.fn("run.15")(function* (messaging, _sql, identityId) {
      const input = yield* messaging.accept({
        identityId,
        eventId: "early-crash",
        sourceMessageId: "source",
        payload: { text: "pending media" },
      });

      const first = yield* messaging.claimInbox({
        identityId,
        leaseSeconds: 1,
      });

      if (!first)
        return yield* Effect.fail(new Error("Expected initial claim"));
      expect(first.nativeInput).toMatchObject({
        inputId: input.id,
        address: identityId,
        protocol: "eve-keyed-input-v1",
        content: null,
      });
      yield* Effect.sleep("1100 millis");

      const next = yield* messaging.claimInbox({
        identityId,
        leaseSeconds: 30,
      });

      if (!next)
        return yield* Effect.fail(
          new Error("Expected recovery before preparation")
        );
      expect(next.nativeInput).toEqual(first.nativeInput);
      expect(next.leaseToken).not.toBe(first.leaseToken);

      const staleLease = {
        identityId,
        id: first.id,
        leaseToken: first.leaseToken,
      };

      expect(
        yield* messaging
          .prepareInboxHandoff({
            transcripts: [],
            lease: staleLease,
            content: "stale extraction",
          })
          .pipe(Effect.flip)
      ).toBeInstanceOf(LeaseLost);

      const prepared = yield* messaging.prepareInboxHandoff({
        transcripts: [],
        lease: { identityId, id: next.id, leaseToken: next.leaseToken },
        content: "current extraction",
      });

      expect(prepared).toEqual({
        ...first.nativeInput,
        content: "current extraction",
      });
      expect(
        yield* messaging
          .prepareInboxHandoff({
            transcripts: [],
            lease: staleLease,
            content: "late extraction",
          })
          .pipe(Effect.flip)
      ).toBeInstanceOf(LeaseLost);
    })
  ));

test("the first prepared transcript intents commit together and never mix or resurrect on replay", () =>
  run(
    Effect.fn("run.16")(function* (messaging, sql, identityId) {
      const input = yield* messaging.accept({
        identityId,
        eventId: "transcript-race",
        sourceMessageId: "voice",
        payload: { text: "voice fixture" },
      });

      const claim = yield* messaging.claimInbox({
        identityId,
        leaseSeconds: 30,
      });

      if (!claim) return yield* Effect.fail(new Error("Expected claim"));
      const lease = { identityId, id: claim.id, leaseToken: claim.leaseToken };

      const candidates = [
        ["alpha one", "alpha two"],
        ["beta one", "beta two"],
      ];

      yield* Effect.all(
        candidates.map((transcripts) =>
          messaging.prepareInboxHandoff({
            lease,
            content: "same immutable content",
            transcripts,
          })
        ),
        { concurrency: 2 }
      );

      const intents = yield* sql<{
        key: string;
        text: string;
      }>`SELECT delivery_key AS key, payload->>'text' AS text FROM channel_outbox WHERE identity_id = ${identityId} ORDER BY sequence`;

      expect(intents).toHaveLength(2);
      expect(intents.map((item) => item.key)).toEqual([
        `transcript:${input.id}:0:0`,
        `transcript:${input.id}:1:0`,
      ]);
      expect(
        candidates.some((candidate) =>
          candidate.every(
            (text, index) =>
              intents[index]?.text ===
              `I heard: ${text}\nIf this is incorrect, send a correction.`
          )
        )
      ).toBe(true);
      yield* sql`DELETE FROM channel_outbox WHERE identity_id = ${identityId}`;
      yield* messaging.prepareInboxHandoff({
        lease,
        content: "same immutable content",
        transcripts: ["late contradictory transcript"],
      });
      expect(
        yield* sql`SELECT id FROM channel_outbox WHERE identity_id = ${identityId}`
      ).toHaveLength(0);
      expect(
        yield* messaging
          .prepareInboxHandoff({
            lease,
            content: "different content",
            transcripts: [],
          })
          .pipe(Effect.flip)
      ).toBeInstanceOf(PayloadConflict);
    })
  ));

test("a conflicting transcript intent rolls back both preparation and earlier intents", () =>
  run(
    Effect.fn("run.17")(function* (messaging, sql, identityId) {
      const input = yield* messaging.accept({
        identityId,
        eventId: "transcript-rollback",
        sourceMessageId: "voice",
        payload: { text: "voice fixture" },
      });

      yield* messaging.enqueue({
        identityId,
        deliveryKey: `transcript:${input.id}:1:0`,
        payload: { text: "conflicting existing intent" },
      });

      const claim = yield* messaging.claimInbox({
        identityId,
        leaseSeconds: 30,
      });

      if (!claim) return yield* Effect.fail(new Error("Expected claim"));
      const lease = { identityId, id: claim.id, leaseToken: claim.leaseToken };
      expect(
        yield* messaging
          .prepareInboxHandoff({
            lease,
            content: "prepared voice",
            transcripts: ["first", "second"],
          })
          .pipe(Effect.flip)
      ).toBeInstanceOf(PayloadConflict);
      expect(
        (yield* messaging.checkInboxLease(lease)).nativeInput?.content
      ).toBeNull();

      const rows = yield* sql<{
        key: string;
      }>`SELECT delivery_key AS key FROM channel_outbox WHERE identity_id = ${identityId}`;

      expect(rows).toEqual([{ key: `transcript:${input.id}:1:0` }]);
    })
  ));

test("uncertain outbox resolve marks delivered, cancels, or authorizes duplicate-risk retry with audit", () =>
  run(
    Effect.fn("run.18")(function* (messaging, sql, identityId) {
      const actor = "better-auth:operator-proof";

      const makeUncertain = Effect.fn("messaging.makeUncertain")(function* (
        deliveryKey: string,
        text: string
      ) {
        yield* messaging.enqueue({
          identityId,
          deliveryKey,
          payload: { text },
        });

        const claim = yield* messaging.claimOutbox({
          identityId,
          leaseSeconds: 30,
        });

        if (!claim)
          return yield* Effect.fail(
            new Error(`Expected claim for ${deliveryKey}`)
          );
        yield* messaging.markOutboxUncertain({
          lease: {
            identityId,
            id: claim.id,
            leaseToken: claim.leaseToken,
          },
          reason: "handoff_unknown",
        });

        return claim.id;
      });

      const deliveredId = yield* makeUncertain("delivered", "one");
      expect(
        yield* messaging.claimOutbox({ identityId, leaseSeconds: 30 })
      ).toBeNull();

      const delivered = yield* messaging.resolveOutboxUncertain({
        identityId,
        id: deliveredId,
        actorPrincipalId: actor,
        note: "provider lookup recovered receipt",
        decision: {
          kind: "mark_delivered",
          providerMessageId: "tg:1001",
        },
      });

      expect(delivered).toMatchObject({
        id: deliveredId,
        status: "sent",
        resultId: "tg:1001",
        lastError: null,
      });
      expect(
        (yield* messaging.resolveOutboxUncertain({
          identityId,
          id: deliveredId,
          actorPrincipalId: actor,
          decision: {
            kind: "mark_delivered",
            providerMessageId: "tg:1001",
          },
        })).status
      ).toBe("sent");
      expect(
        yield* messaging
          .resolveOutboxUncertain({
            identityId,
            id: deliveredId,
            actorPrincipalId: actor,
            decision: {
              kind: "mark_delivered",
              providerMessageId: "tg:other",
            },
          })
          .pipe(Effect.flip)
      ).toBeInstanceOf(OutboxResolutionRejected);

      const cancelledId = yield* makeUncertain("cancelled", "two");

      const cancelled = yield* messaging.resolveOutboxUncertain({
        identityId,
        id: cancelledId,
        actorPrincipalId: actor,
        decision: { kind: "cancel", reason: "abandoned" },
      });

      expect(cancelled).toMatchObject({
        id: cancelledId,
        status: "cancelled",
        lastError: "abandoned",
      });

      const retryId = yield* makeUncertain("retry", "three");

      const retried = yield* messaging.resolveOutboxUncertain({
        identityId,
        id: retryId,
        actorPrincipalId: actor,
        decision: {
          kind: "authorize_retry",
          acknowledgment: "duplicate_delivery_risk_accepted",
        },
      });

      expect(retried).toMatchObject({
        id: retryId,
        status: "queued",
        lastError: "duplicate_retry_authorized",
      });
      expect(
        yield* messaging
          .resolveOutboxUncertain({
            identityId,
            id: retryId,
            actorPrincipalId: actor,
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion -- intentional incomplete decision
            decision: { kind: "authorize_retry" } as never,
          })
          .pipe(Effect.flip)
      ).toBeInstanceOf(InvalidMessage);

      const reclaim = yield* messaging.claimOutbox({
        identityId,
        leaseSeconds: 30,
      });

      expect(reclaim?.id).toBe(retryId);
      expect(reclaim?.attempts).toBe(2);

      const audits = yield* sql<{
        decision: string;
        detail: string;
        priorError: string | null;
        actor: string;
        note: string | null;
      }>`SELECT decision, detail, prior_error AS "priorError",
          actor_principal_id AS actor, note
        FROM channel_outbox_resolution
        WHERE identity_id = ${identityId}
        ORDER BY created_at, id`;

      expect(audits).toEqual([
        {
          decision: "mark_delivered",
          detail: "tg:1001",
          priorError: "handoff_unknown",
          actor,
          note: "provider lookup recovered receipt",
        },
        {
          decision: "cancel",
          detail: "abandoned",
          priorError: "handoff_unknown",
          actor,
          note: null,
        },
        {
          decision: "authorize_retry",
          detail: "duplicate_delivery_risk_accepted",
          priorError: "handoff_unknown",
          actor,
          note: null,
        },
      ]);
    })
  ));

test("uncertain outbox resolve refuses non-uncertain rows and inactive delivery or retry", () =>
  run(
    Effect.fn("run.19")(function* (messaging, sql, identityId) {
      const actor = "better-auth:operator-proof";
      yield* messaging.enqueue({
        identityId,
        deliveryKey: "queued-only",
        payload: { text: "still queued" },
      });

      const queued = yield* sql<{ id: string }>`
        SELECT id FROM channel_outbox
        WHERE identity_id = ${identityId} AND delivery_key = 'queued-only'`;

      const queuedId = queued[0]?.id;

      if (!queuedId)
        return yield* Effect.fail(new Error("Expected queued outbox row"));
      expect(
        yield* messaging
          .resolveOutboxUncertain({
            identityId,
            id: queuedId,
            actorPrincipalId: actor,
            decision: { kind: "cancel", reason: "abandoned" },
          })
          .pipe(Effect.flip)
      ).toBeInstanceOf(OutboxResolutionRejected);

      // Clear the queued blocker so the next claim can create uncertainty.
      yield* sql`UPDATE channel_outbox SET status = 'cancelled',
        last_error = 'test_cleanup' WHERE id = ${queuedId}`;

      yield* messaging.enqueue({
        identityId,
        deliveryKey: "stuck",
        payload: { text: "stuck" },
      });

      const claim = yield* messaging.claimOutbox({
        identityId,
        leaseSeconds: 30,
      });

      if (!claim) return yield* Effect.fail(new Error("Expected claim"));
      yield* messaging.markOutboxUncertain({
        lease: {
          identityId,
          id: claim.id,
          leaseToken: claim.leaseToken,
        },
        reason: "lease_expired",
      });
      yield* sql`UPDATE channel_identity SET revoked_at = clock_timestamp()
        WHERE id = ${identityId}`;
      expect(
        yield* messaging
          .resolveOutboxUncertain({
            identityId,
            id: claim.id,
            actorPrincipalId: actor,
            decision: {
              kind: "authorize_retry",
              acknowledgment: "duplicate_delivery_risk_accepted",
            },
          })
          .pipe(Effect.flip)
      ).toBeInstanceOf(IdentityInactive);
      expect(
        yield* messaging
          .resolveOutboxUncertain({
            identityId,
            id: claim.id,
            actorPrincipalId: actor,
            decision: {
              kind: "mark_delivered",
              providerMessageId: "tg:revoked",
            },
          })
          .pipe(Effect.flip)
      ).toBeInstanceOf(IdentityInactive);

      const cancelled = yield* messaging.resolveOutboxUncertain({
        identityId,
        id: claim.id,
        actorPrincipalId: actor,
        decision: { kind: "cancel", reason: "operator_cancelled" },
      });

      expect(cancelled.status).toBe("cancelled");
    })
  ));
