import { randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Effect, Layer } from "effect";
import { expect, test } from "vitest";
import { readChannelResponseContext } from "../../agent/lib/channel-response";
import { ChannelAccounts } from "../../server/accounts";
import { ChannelTransport } from "../../server/channels/transport";
import { Telegram } from "../../server/channels/telegram";
import { Kapso } from "../../server/channels/kapso";
import { Messaging } from "../../server/messaging";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { runtimeDatabase } from "./database";

const infrastructure = Layer.mergeAll(
  ChannelAccounts.layer,
  Messaging.layer,
  Telegram.layer,
  Kapso.layer
).pipe(Layer.provideMerge(runtimeDatabase));
const live = ChannelTransport.layer.pipe(Layer.provideMerge(infrastructure));

const fixture = Effect.gen(function* () {
  const accounts = yield* ChannelAccounts;
  const sql = yield* PgClient.PgClient;
  const identity = yield* accounts.resolveVerifiedSender({
    channel: "telegram",
    installationId: randomUUID(),
    senderId: randomUUID(),
  });
  yield* Effect.addFinalizer(() =>
    sql`DELETE FROM workspaces WHERE id = ${accessScopeForUser(`better-auth:${identity.userId}`).workspaceId}`.pipe(
      Effect.andThen(
        sql`DELETE FROM public."user" WHERE id = ${identity.userId}`
      ),
      Effect.orDie
    )
  );
  return {
    sql,
    messaging: yield* Messaging,
    input: {
      identityId: identity.id,
      sessionId: randomUUID(),
      sourceMessageId: randomUUID(),
      requestId: randomUUID(),
      turnId: randomUUID(),
      decision: "approve" as const,
    },
  };
});

test("response source requires accepted inbox state in the exact session", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { messaging, input } = yield* fixture;
      expect(
        yield* readChannelResponseContext(input).pipe(Effect.result)
      ).toMatchObject({ _tag: "Failure" });
      yield* messaging.accept({
        identityId: input.identityId,
        eventId: randomUUID(),
        sourceMessageId: input.sourceMessageId,
        payload: { text: "pode fazer", sourceOccurredAtMs: 1788880000000 },
      });
      expect(
        yield* readChannelResponseContext(input).pipe(Effect.result)
      ).toMatchObject({ _tag: "Failure" });
      const lease = yield* messaging.claimInbox({
        identityId: input.identityId,
        leaseSeconds: 60,
      });
      if (!lease) throw new Error("Expected a claimed synthetic inbox fixture");
      expect(
        yield* readChannelResponseContext(input).pipe(Effect.result)
      ).toMatchObject({ _tag: "Failure" });
      yield* messaging.markAccepted({
        lease: {
          id: lease.id,
          identityId: lease.identityId,
          leaseToken: lease.leaseToken,
        },
        receipt: { status: "accepted", sessionId: input.sessionId },
      });
      expect((yield* readChannelResponseContext(input)).source).toEqual({
        identityId: input.identityId,
        sessionId: input.sessionId,
        sourceMessageId: input.sourceMessageId,
        text: "pode fazer",
        sourceOccurredAtMs: 1788880000000,
      });
      expect(
        yield* readChannelResponseContext({
          ...input,
          sessionId: randomUUID(),
        }).pipe(Effect.result)
      ).toMatchObject({ _tag: "Failure" });
      expect(
        yield* readChannelResponseContext({
          ...input,
          sourceMessageId: randomUUID(),
        }).pipe(Effect.result)
      ).toMatchObject({ _tag: "Failure" });
    }).pipe(Effect.scoped, Effect.provide(live))
  ));

test("accepted sources without provider occurrence time do not acquire consent", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { messaging, input } = yield* fixture;
      yield* messaging.accept({
        identityId: input.identityId,
        eventId: randomUUID(),
        sourceMessageId: input.sourceMessageId,
        payload: { text: "pode fazer" },
      });
      const lease = yield* messaging.claimInbox({
        identityId: input.identityId,
        leaseSeconds: 60,
      });
      if (!lease) throw new Error("Expected a claimed synthetic inbox fixture");
      yield* messaging.markAccepted({
        lease: {
          id: lease.id,
          identityId: lease.identityId,
          leaseToken: lease.leaseToken,
        },
        receipt: { status: "accepted", sessionId: input.sessionId },
      });
      expect(
        yield* readChannelResponseContext(input).pipe(Effect.result)
      ).toMatchObject({
        _tag: "Failure",
        failure: { reason: "invalid_source" },
      });
    }).pipe(Effect.scoped, Effect.provide(live))
  ));

test("revocation and ambiguous accepted source records reject response context", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { sql, messaging, input } = yield* fixture;
      for (let index = 0; index < 2; index++) {
        yield* messaging.accept({
          identityId: input.identityId,
          eventId: randomUUID(),
          sourceMessageId: input.sourceMessageId,
          payload: { text: "pode fazer", sourceOccurredAtMs: 1788880000000 },
        });
        const lease = yield* messaging.claimInbox({
          identityId: input.identityId,
          leaseSeconds: 60,
        });
        if (!lease)
          throw new Error("Expected a claimed synthetic inbox fixture");
        yield* messaging.markAccepted({
          lease: {
            id: lease.id,
            identityId: lease.identityId,
            leaseToken: lease.leaseToken,
          },
          receipt: { status: "accepted", sessionId: input.sessionId },
        });
      }
      expect(
        yield* readChannelResponseContext(input).pipe(Effect.result)
      ).toMatchObject({
        _tag: "Failure",
        failure: { reason: "invalid_source" },
      });
      yield* sql`UPDATE channel_identity SET revoked_at = clock_timestamp() WHERE id = ${input.identityId}`;
      expect(
        yield* readChannelResponseContext(input).pipe(Effect.result)
      ).toMatchObject({
        _tag: "Failure",
        failure: { reason: "identity_inactive" },
      });
    }).pipe(Effect.scoped, Effect.provide(live))
  ));
