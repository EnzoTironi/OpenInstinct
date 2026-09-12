import { randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { ConfigProvider, Effect, Layer } from "effect";
import { expect, test } from "vitest";
import { ChannelAccounts } from "../../server/accounts";
import { Kapso } from "../../server/channels/kapso";
import { ProviderRetryable } from "../../server/channels/provider-errors";
import { Telegram } from "../../server/channels/telegram";
import {
  ChannelTransport,
  ChannelTransportError,
  splitChannelText,
} from "../../server/channels/transport";
import { Messaging, PayloadConflict } from "../../server/messaging";

import { runtimeDatabase } from "./database";
import { accessScopeForUser } from "../../shared/identity/access-scope";

const unusedAdapterMethod = () => Effect.die("unused");

const dependencies = Layer.mergeAll(
  Messaging.layer,
  ChannelAccounts.layer,
  Telegram.layer,
  Kapso.layer
).pipe(Layer.provideMerge(runtimeDatabase));
const services = ChannelTransport.layer.pipe(Layer.provideMerge(dependencies));
const fixture = Effect.fn("transport.fixture")(function* (
  body: (
    transport: ChannelTransport["Service"],
    messaging: Messaging["Service"],
    sql: PgClient.PgClient,
    identities: readonly string[],
    userId: string
  ) => Effect.Effect<void, unknown>
) {
  const sql = yield* PgClient.PgClient;
  const userId = randomUUID();
  const scope = accessScopeForUser(`better-auth:${userId}`);
  yield* Effect.acquireRelease(
    sql`INSERT INTO "user" (id, name, email) VALUES (${userId}, 'Transport proof', ${`${userId}@example.invalid`})`,
    () =>
      sql`DELETE FROM workspaces WHERE id = ${scope.workspaceId}`.pipe(
        Effect.andThen(sql`DELETE FROM "user" WHERE id = ${userId}`),
        Effect.orDie
      )
  );
  yield* sql`INSERT INTO workspaces (id) VALUES (${scope.workspaceId})`;
  yield* sql`INSERT INTO workspace_memberships (workspace_id, user_id, role)
    VALUES (${scope.workspaceId}, ${scope.userId}, 'owner')`;
  const identities = Array.from({ length: 7 }, () => randomUUID());
  yield* Effect.forEach(
    identities,
    (
      id,
      index
    ) => sql`INSERT INTO channel_identity (id, channel, installation_id, sender_id, user_id)
    VALUES (${id}, ${index === 6 ? "kapso" : "telegram"}, 'transport-proof', ${id}, ${userId})`
  );
  yield* body(
    yield* ChannelTransport,
    yield* Messaging,
    sql,
    identities,
    userId
  );
});
const run = (body: Parameters<typeof fixture>[0]) =>
  Effect.runPromise(
    fixture(body).pipe(Effect.scoped, Effect.provide(services))
  );

test("input delivery requires every original chunk, current revision and matching identity", () =>
  run((transport, _messaging, sql, identities) =>
    Effect.gen(function* () {
      const [identityId, otherIdentityId] = identities;
      if (!identityId || !otherIdentityId)
        throw new Error("Missing identities");
      const inputRequest = {
        sessionId: "session-delivery-proof",
        requestId: "request-delivery-proof",
        revision: "a".repeat(64),
      };
      const text = "details ".repeat(700);
      const receipts = yield* transport.enqueueText({
        identityId,
        deliveryKey: `input:${inputRequest.sessionId}:${inputRequest.requestId}`,
        text,
        inputRequest,
      });
      expect(receipts).toHaveLength(2);
      expect(
        yield* transport.deliveredInput(identityId, inputRequest)
      ).toBeNull();
      const first = receipts[0];
      if (!first) throw new Error("Missing first receipt");
      // These rows model accepted delivery facts; this test does not qualify a provider send.
      yield* sql`UPDATE channel_outbox SET status = 'sent',
        sent_at = '2026-09-08T12:00:00Z', provider_message_id = 'part-1'
        WHERE id = ${first.id}`;
      expect(
        yield* transport.deliveredInput(identityId, inputRequest)
      ).toBeNull();
      yield* sql`UPDATE channel_outbox SET status = 'sent',
        sent_at = '2026-09-08T12:00:02Z', provider_message_id = 'part-2'
        WHERE identity_id = ${identityId} AND id <> ${first.id}`;
      expect(
        yield* transport.deliveredInput(identityId, inputRequest)
      ).toMatchObject({
        identityId,
        ...inputRequest,
        text,
        deliveredAtMs: 1_788_868_802_000,
        providerMessageIds: ["part-1", "part-2"],
      });
      expect(
        yield* transport.deliveredInput(otherIdentityId, inputRequest)
      ).toBeNull();
      expect(
        yield* transport.deliveredInput(identityId, {
          ...inputRequest,
          revision: "b".repeat(64),
        })
      ).toBeNull();
      yield* sql`UPDATE channel_outbox SET status = 'uncertain' WHERE id = ${first.id}`;
      expect(
        yield* transport.deliveredInput(identityId, inputRequest)
      ).toBeNull();
    })
  ));

test("splits at 4000 UTF-16 units without splitting surrogate pairs or changing text", async () => {
  const text = `${"a".repeat(3999)}😀${"b".repeat(12_383)}`;
  const chunks = await Effect.runPromise(splitChannelText(text));
  expect(chunks.join("")).toBe(text);
  expect(chunks[0]).toHaveLength(3999);
  expect(
    chunks.every((chunk) => chunk.length <= 4000 && chunk.isWellFormed())
  ).toBe(true);
  expect(chunks).toHaveLength(5);
  await expect(
    Effect.runPromise(splitChannelText(`${text}x`))
  ).rejects.toBeInstanceOf(ChannelTransportError);
  await expect(
    Effect.runPromise(splitChannelText("\uD800"))
  ).rejects.toBeInstanceOf(ChannelTransportError);
});

test.each(["inbox", "outbox"] as const)(
  "%s candidates are fair per identity and exclude blockers",
  (lane) =>
    run((transport, messaging, sql, identities) =>
      Effect.gen(function* () {
        const table = sql(
          lane === "inbox" ? "channel_inbox" : "channel_outbox"
        );
        const received = sql(lane === "inbox" ? "received_at" : "created_at");
        const [
          noisy,
          other,
          uncertain,
          expired,
          busy,
          revoked,
          anotherChannel,
        ] = identities;
        if (
          !noisy ||
          !other ||
          !uncertain ||
          !expired ||
          !busy ||
          !revoked ||
          !anotherChannel
        )
          throw new Error("Missing fixtures");
        const put = (identityId: string, key: string) =>
          lane === "inbox"
            ? messaging.accept({
                identityId,
                eventId: key,
                sourceMessageId: key,
                payload: { text: "fixture" },
              })
            : messaging.enqueue({
                identityId,
                deliveryKey: key,
                payload: { text: "fixture" },
              });
        yield* Effect.forEach(identities, (id) => put(id, "first"));
        yield* Effect.forEach(
          Array.from({ length: 30 }, (_, index) => String(index)),
          (key) => put(noisy, key)
        );
        yield* Effect.forEach([uncertain, expired, busy], (id) =>
          put(id, "second")
        );
        const claim =
          lane === "inbox" ? messaging.claimInbox : messaging.claimOutbox;
        const stop =
          lane === "inbox"
            ? messaging.markInboxUncertain
            : messaging.markOutboxUncertain;
        const lease = yield* claim({ identityId: uncertain, leaseSeconds: 30 });
        if (!lease) throw new Error("Missing lease");
        yield* stop({
          lease: {
            id: lease.id,
            identityId: lease.identityId,
            leaseToken: lease.leaseToken,
          },
          reason: "handoff_unknown",
        });
        if (lane === "inbox")
          yield* sql`UPDATE channel_inbox SET native_input = NULL WHERE id = ${lease.id}`;
        yield* claim({ identityId: expired, leaseSeconds: 30 });
        yield* claim({ identityId: busy, leaseSeconds: 30 });
        yield* sql`UPDATE ${table} SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE identity_id = ${expired} AND status = 'dispatching'`;
        yield* sql`UPDATE channel_identity SET revoked_at = clock_timestamp() WHERE id = ${revoked}`;
        yield* Effect.forEach(
          identities,
          (id, index) =>
            sql`UPDATE ${table} SET ${received} = clock_timestamp() - ${100 - index} * interval '1 minute' WHERE identity_id = ${id}`
        );
        const candidates =
          lane === "inbox"
            ? transport.inboxCandidates
            : transport.outboxCandidates;
        expect(
          (yield* candidates("telegram", 25)).map((identity) => identity.id)
        ).toEqual(
          lane === "inbox"
            ? [noisy, other, expired]
            : [noisy, other, expired, revoked]
        );
        expect(
          (yield* candidates("telegram", 2)).map((identity) => identity.id)
        ).toEqual([noisy, other]);
        expect(
          (yield* candidates("kapso", 25)).map((identity) => identity.id)
        ).toEqual([anotherChannel]);
        expect(
          yield* candidates("telegram", 26).pipe(Effect.flip)
        ).toBeInstanceOf(ChannelTransportError);
        if (lane === "outbox") {
          expect(yield* transport.drainOutbox(revoked)).toEqual({
            state: "idle",
            sent: 0,
            failed: 0,
            uncertain: 0,
          });
          const rows = yield* sql<{
            status: string;
          }>`SELECT status FROM channel_outbox WHERE identity_id = ${revoked}`;
          expect(rows.every((row) => row.status === "cancelled")).toBe(true);
          expect(yield* transport.drainOutbox(expired)).toEqual({
            state: "uncertain",
            sent: 0,
            failed: 0,
            uncertain: 1,
          });
          expect(
            (yield* candidates("telegram", 25)).map((identity) => identity.id)
          ).toEqual([noisy, other]);
        }
      })
    )
);

test("validates active identity and rejects mismatched channel or revocation", () =>
  run((transport, _messaging, sql, identities, userId) =>
    Effect.gen(function* () {
      const id = identities[0];
      if (!id) throw new Error("Missing fixture");
      expect(yield* transport.activeIdentity(id, "telegram")).toMatchObject({
        id,
        userId,
        channel: "telegram",
      });
      expect(
        yield* transport.activeIdentity(id, "kapso").pipe(Effect.flip)
      ).toMatchObject({ reason: "channel_mismatch" });
      yield* sql`UPDATE channel_identity SET revoked_at = clock_timestamp() WHERE id = ${id}`;
      expect(
        yield* transport.activeIdentity(id, "telegram").pipe(Effect.flip)
      ).toMatchObject({ reason: "identity_inactive" });
      expect(
        yield* transport
          .enqueueText({
            identityId: id,
            deliveryKey: "revoked",
            text: "blocked",
          })
          .pipe(Effect.flip)
      ).toMatchObject({ reason: "identity_inactive" });
    })
  ));

test("enqueues stable chunks idempotently and rolls back partial writes on conflict", () =>
  run((transport, messaging, sql, identities) =>
    Effect.gen(function* () {
      const id = identities[0];
      if (!id) throw new Error("Missing fixture");
      const text = `${"a".repeat(3999)}😀${"b".repeat(5000)}`;
      const input = {
        identityId: id,
        deliveryKey: "reply",
        text,
        replyToMessageId: "123",
      };
      const first = yield* transport.enqueueText(input);
      const replay = yield* transport.enqueueText(input);
      expect(replay.map((receipt) => receipt.id)).toEqual(
        first.map((receipt) => receipt.id)
      );
      expect(first.map((receipt) => receipt.key)).toEqual([
        "reply:0",
        "reply:1",
        "reply:2",
      ]);
      expect(first.map((receipt) => receipt.payload.text).join("")).toBe(text);
      expect(
        first.every((receipt) => receipt.payload.replyToMessageId === "123")
      ).toBe(true);
      expect(
        yield* transport
          .enqueueText({ ...input, text: `${text}changed` })
          .pipe(Effect.flip)
      ).toBeInstanceOf(PayloadConflict);
      expect(
        yield* transport
          .enqueueText({ ...input, text: "a".repeat(3999) })
          .pipe(Effect.flip)
      ).toBeInstanceOf(PayloadConflict);
      yield* transport.enqueueText({
        identityId: id,
        deliveryKey: "extend",
        text: "x".repeat(4000),
      });
      expect(
        yield* transport
          .enqueueText({
            identityId: id,
            deliveryKey: "extend",
            text: "x".repeat(4001),
          })
          .pipe(Effect.flip)
      ).toBeInstanceOf(PayloadConflict);
      yield* messaging.enqueue({
        identityId: id,
        deliveryKey: "atomic:1",
        payload: { text: "existing" },
      });
      expect(
        yield* transport
          .enqueueText({
            identityId: id,
            deliveryKey: "atomic",
            text: "x".repeat(4001),
          })
          .pipe(Effect.flip)
      ).toBeInstanceOf(PayloadConflict);
      const partial =
        yield* sql`SELECT id FROM channel_outbox WHERE identity_id = ${id} AND delivery_key = 'atomic:0'`;
      expect(partial).toHaveLength(0);
    })
  ));

test("unsupported stored media fails before any provider configuration or send", () =>
  run((transport, messaging, sql, identities) =>
    Effect.gen(function* () {
      const id = identities[0];
      if (!id) throw new Error("Missing fixture");
      const receipt = yield* messaging.enqueue({
        identityId: id,
        deliveryKey: "media",
        payload: { attachments: [{ id: "opaque", mediaType: "image/png" }] },
      });
      expect(yield* transport.drainOutbox(id).pipe(Effect.flip)).toMatchObject({
        reason: "unsupported_payload",
      });
      const rows = yield* sql<{
        status: string;
        last_error: string;
      }>`SELECT status, last_error FROM channel_outbox WHERE id = ${receipt.id}`;
      expect(rows[0]).toEqual({
        status: "failed",
        last_error: "adapter_rejected",
      });
      expect(yield* transport.drainOutbox(id)).toEqual({
        state: "idle",
        sent: 0,
        failed: 0,
        uncertain: 0,
      });
    })
  ));

test.each([
  { config: {}, reason: "configuration" },
  {
    config: {
      TELEGRAM_BOT_ID: "123456",
      TELEGRAM_BOT_USERNAME: "transport_bot",
    },
    reason: "installation_mismatch",
  },
])("fails $reason before dispatch without provider I/O", ({ config, reason }) =>
  run((transport, messaging, sql, identities) =>
    Effect.gen(function* () {
      const id = identities[0];
      if (!id) throw new Error("Missing fixture");
      const receipt = yield* messaging.enqueue({
        identityId: id,
        deliveryKey: "preflight",
        payload: { text: "must not leave database" },
      });
      const failure = yield* transport
        .drainOutbox(id)
        .pipe(
          Effect.provideService(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromUnknown(config)
          ),
          Effect.flip
        );
      expect(failure).toMatchObject({ reason });
      const rows = yield* sql<{
        status: string;
      }>`SELECT status FROM channel_outbox WHERE id = ${receipt.id}`;
      expect(rows[0]?.status).toBe("failed");
    })
  )
);

test("claims atomic text chunks in enqueue order despite tied timestamps and reversed UUID order", () =>
  run((transport, messaging, sql, identities) =>
    Effect.gen(function* () {
      const identityId = identities[0];
      if (!identityId) throw new Error("Missing fixture");
      const chunks = ["a", "b", "c", "d"].map((letter) => letter.repeat(4000));
      const receipts = yield* transport.enqueueText({
        identityId,
        deliveryKey: "ordered",
        text: chunks.join(""),
      });
      expect(receipts).toHaveLength(4);
      const timestamps = yield* sql<{
        count: number;
      }>`SELECT count(DISTINCT created_at)::int AS count
        FROM channel_outbox WHERE identity_id = ${identityId}`;
      expect(timestamps[0]?.count).toBe(1);
      // Make the old UUID tie-breaker deterministically wrong using real stored fixtures.
      const prefix = randomUUID().slice(0, 24);
      yield* Effect.forEach(
        receipts,
        (receipt, index) =>
          sql`UPDATE channel_outbox SET id = ${`${prefix}${String(4 - index).padStart(12, "0")}`}
          WHERE id = ${receipt.id}`
      );
      const delivered: string[] = [];
      yield* Effect.forEach(chunks, (text, index) =>
        Effect.gen(function* () {
          const claim = yield* messaging.claimOutbox({
            identityId,
            leaseSeconds: 30,
          });
          if (!claim) throw new Error("Missing ordered claim");
          expect(claim.key).toBe(`ordered:${String(index)}`);
          expect(claim.payload.text).toBe(text);
          delivered.push(text);
          // This receipt exercises queue settlement only; it is not provider evidence.
          const settled = yield* messaging.markSent({
            lease: { identityId, id: claim.id, leaseToken: claim.leaseToken },
            receipt: {
              status: "sent",
              providerMessageId: `storage-order-fixture-${String(index)}`,
            },
          });
          expect(settled.status).toBe("sent");
        })
      );
      expect(delivered.join("")).toBe(chunks.join(""));
      expect(
        yield* messaging.claimOutbox({ identityId, leaseSeconds: 30 })
      ).toBeNull();
    })
  ));

test("rejects a stored chunk key hole even when its count matches the requested chunks", () =>
  run((transport, messaging, sql, identities) =>
    Effect.gen(function* () {
      const identityId = identities[0];
      if (!identityId) throw new Error("Missing fixture");
      yield* messaging.enqueue({
        identityId,
        deliveryKey: "hole:0",
        payload: { text: "a".repeat(4000) },
      });
      yield* messaging.enqueue({
        identityId,
        deliveryKey: "hole:2",
        payload: { text: "unexpected extra chunk" },
      });
      expect(
        yield* transport
          .enqueueText({
            identityId,
            deliveryKey: "hole",
            text: "a".repeat(4001),
          })
          .pipe(Effect.flip)
      ).toBeInstanceOf(PayloadConflict);
      const rows = yield* sql<{
        key: string;
      }>`SELECT delivery_key AS key FROM channel_outbox
        WHERE identity_id = ${identityId} ORDER BY delivery_key`;
      expect(rows.map((row) => row.key)).toEqual(["hole:0", "hole:2"]);
    })
  ));

test("settled task reports retain the first atomic delivery across concurrent rewording", () =>
  run((transport, messaging, sql, identities) =>
    Effect.gen(function* () {
      const identityId = identities[0];
      if (!identityId) throw new Error("Missing fixture");
      const deliveryKey = `task-report:${"a".repeat(64)}`;
      const wording = [
        "First combined result. ".repeat(220),
        "A reworded duplicate.",
      ];
      const [first, second] = yield* Effect.all(
        wording.map((text) =>
          transport.enqueueTaskReport({ identityId, deliveryKey, text })
        ),
        { concurrency: "unbounded" }
      );
      expect(first?.map((receipt) => receipt.id)).toEqual(
        second?.map((receipt) => receipt.id)
      );
      const saved = yield* sql<{
        text: string;
      }>`SELECT payload->>'text' AS text FROM channel_outbox WHERE identity_id = ${identityId} ORDER BY delivery_key`;
      expect(wording).toContain(saved.map((receipt) => receipt.text).join(""));
      const replay = yield* transport.enqueueTaskReport({
        identityId,
        deliveryKey,
        text: "A third version in a later turn.",
      });
      expect(replay.map((receipt) => receipt.id)).toEqual(
        first?.map((receipt) => receipt.id)
      );
      const distinct = yield* transport.enqueueTaskReport({
        identityId,
        deliveryKey: `task-report:${"b".repeat(64)}`,
        text: "Another completed cohort.",
      });
      expect(distinct[0]?.id).not.toBe(first?.[0]?.id);
      yield* transport.enqueueText({
        identityId,
        deliveryKey: "ordinary-message",
        text: "Original ordinary message",
      });
      expect(
        yield* transport
          .enqueueText({
            identityId,
            deliveryKey: "ordinary-message",
            text: "Conflicting ordinary message",
          })
          .pipe(Effect.flip)
      ).toBeInstanceOf(PayloadConflict);
      yield* sql`UPDATE channel_identity SET revoked_at = clock_timestamp() WHERE id = ${identityId}`;
      expect(
        yield* transport
          .enqueueTaskReport({
            identityId,
            deliveryKey,
            text: "After revocation",
          })
          .pipe(Effect.flip)
      ).toBeInstanceOf(ChannelTransportError);
    })
  ));

test("the dispatcher recovers native inputs before and after preparation while blocking unmarked inputs and output", () =>
  run((transport, messaging, sql, identities) =>
    Effect.gen(function* () {
      const [preparedId, unpreparedId, outboundId, unmarkedId] = identities;
      if (!preparedId || !unpreparedId || !outboundId || !unmarkedId)
        throw new Error("Missing identities");
      yield* Effect.forEach(
        [preparedId, unpreparedId, unmarkedId],
        (identityId) =>
          Effect.gen(function* () {
            yield* messaging.accept({
              identityId,
              eventId: "recovery-candidate",
              sourceMessageId: "source",
              payload: { text: "one" },
            });
            const claim = yield* messaging.claimInbox({
              identityId,
              leaseSeconds: 30,
            });
            if (!claim) throw new Error("Expected initial claim");
            if (identityId === unmarkedId)
              yield* sql`UPDATE channel_inbox SET native_input = NULL WHERE id = ${claim.id}`;
            const lease = {
              identityId,
              id: claim.id,
              leaseToken: claim.leaseToken,
            };
            if (identityId === preparedId)
              yield* messaging.prepareInboxHandoff({
                transcripts: [],
                lease,
                content: "one",
              });
            yield* messaging.markInboxUncertain({
              lease,
              reason: "handoff_unknown",
            });
          })
      );
      yield* messaging.enqueue({
        identityId: outboundId,
        deliveryKey: "uncertain-send",
        payload: { text: "reply" },
      });
      const outbound = yield* messaging.claimOutbox({
        identityId: outboundId,
        leaseSeconds: 30,
      });
      if (!outbound) throw new Error("Expected outbox claim");
      yield* messaging.markOutboxUncertain({
        lease: {
          identityId: outboundId,
          id: outbound.id,
          leaseToken: outbound.leaseToken,
        },
        reason: "adapter_unavailable",
      });
      const candidates = yield* transport.inboxCandidates("telegram", 25);
      expect(candidates.map((candidate) => candidate.id)).toContain(preparedId);
      expect(candidates.map((candidate) => candidate.id)).toContain(
        unpreparedId
      );
      expect(candidates.map((candidate) => candidate.id)).not.toContain(
        unmarkedId
      );
      expect(
        (yield* transport.outboxCandidates("telegram", 25)).map(
          (candidate) => candidate.id
        )
      ).not.toContain(outboundId);
    })
  ));

test("HTTP 429 schedules retry_after deferral instead of terminal failure", () => {
  const rateLimitedTelegramService = {
    parse: unusedAdapterMethod,
    downloadMedia: unusedAdapterMethod,
    sendLoginConfirmation: unusedAdapterMethod,
    editLoginConfirmation: unusedAdapterMethod,
    answerCallbackQuery: unusedAdapterMethod,
    sendText: () =>
      Effect.fail(
        new ProviderRetryable({
          provider: "telegram",
          status: 429,
          retryAfterSeconds: 12,
        })
      ),
  } satisfies Telegram["Service"];
  const rateLimitedTelegram = Layer.succeed(
    Telegram,
    rateLimitedTelegramService
  );
  const idleKapsoService = {
    parse: unusedAdapterMethod,
    downloadMedia: unusedAdapterMethod,
    sendText: unusedAdapterMethod,
  } satisfies Kapso["Service"];
  const idleKapso = Layer.succeed(Kapso, idleKapsoService);
  const localDependencies = Layer.mergeAll(
    Messaging.layer,
    ChannelAccounts.layer,
    rateLimitedTelegram,
    idleKapso
  ).pipe(Layer.provideMerge(runtimeDatabase));
  const localServices = ChannelTransport.layer.pipe(
    Layer.provideMerge(localDependencies)
  );
  const localRun = (body: Parameters<typeof fixture>[0]) =>
    Effect.runPromise(
      fixture(body).pipe(Effect.scoped, Effect.provide(localServices))
    );
  return localRun((transport, messaging, sql, identities) =>
    Effect.gen(function* () {
      const identityId = identities[0];
      if (!identityId) throw new Error("Missing fixture");
      yield* sql`UPDATE channel_identity SET installation_id = '123456'
        WHERE id = ${identityId}`;
      const receipt = yield* messaging.enqueue({
        identityId,
        deliveryKey: "rate-limit-one",
        payload: { text: "temporary throttle" },
      });
      const follower = yield* messaging.enqueue({
        identityId,
        deliveryKey: "rate-limit-two",
        payload: { text: "must wait behind deferred head" },
      });
      expect(
        yield* transport.drainOutbox(identityId).pipe(
          Effect.provideService(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromUnknown({
              TELEGRAM_BOT_ID: "123456",
              TELEGRAM_BOT_USERNAME: "transport_bot",
            })
          )
        )
      ).toEqual({
        state: "deferred",
        sent: 0,
        failed: 0,
        uncertain: 0,
      });
      const rows = yield* sql<{
        id: string;
        status: string;
        last_error: string | null;
        ready: boolean;
      }>`SELECT id, status, last_error,
        (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp()) AS ready
        FROM channel_outbox WHERE identity_id = ${identityId}
        ORDER BY sequence`;
      expect(rows[0]).toMatchObject({
        id: receipt.id,
        status: "queued",
        last_error: "adapter_rate_limited",
        ready: false,
      });
      expect(rows[1]).toMatchObject({
        id: follower.id,
        status: "queued",
        last_error: null,
      });
      expect(
        yield* messaging.claimOutbox({ identityId, leaseSeconds: 30 })
      ).toBeNull();
      yield* sql`UPDATE channel_outbox
        SET lease_expires_at = clock_timestamp() - interval '1 second'
        WHERE id = ${receipt.id}`;
      const claim = yield* messaging.claimOutbox({
        identityId,
        leaseSeconds: 30,
      });
      expect(claim?.id).toBe(receipt.id);
      expect(claim?.key).toBe("rate-limit-one");
    })
  );
});
