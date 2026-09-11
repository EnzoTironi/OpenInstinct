import { randomUUID } from "node:crypto";

import { PgClient } from "@effect/sql-pg";
import { Effect, Layer, Result } from "effect";
import { expect, test } from "vitest";

import { readChannelResponseContext } from "../../agent/lib/channel-response";
import { ChannelAccounts } from "../../server/accounts";
import { Kapso } from "../../server/channels/kapso";
import { Telegram } from "../../server/channels/telegram";
import { ChannelTransport } from "../../server/channels/transport";
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

      const result1 = yield* readChannelResponseContext(input).pipe(
        Effect.result
      );

      expect(Result.isFailure(result1)).toBe(true);
      yield* messaging.accept({
        identityId: input.identityId,
        eventId: randomUUID(),
        sourceMessageId: input.sourceMessageId,
        payload: { text: "pode fazer", sourceOccurredAtMs: 1788880000000 },
      });

      const result2 = yield* readChannelResponseContext(input).pipe(
        Effect.result
      );

      expect(Result.isFailure(result2)).toBe(true);

      const lease = yield* messaging.claimInbox({
        identityId: input.identityId,
        leaseSeconds: 60,
      });

      if (!lease) throw new Error("Expected a claimed synthetic inbox fixture");

      const result3 = yield* readChannelResponseContext(input).pipe(
        Effect.result
      );

      expect(Result.isFailure(result3)).toBe(true);
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

      const result4 = yield* readChannelResponseContext({
        ...input,
        sessionId: randomUUID(),
      }).pipe(Effect.result);

      expect(Result.isFailure(result4)).toBe(true);

      const result5 = yield* readChannelResponseContext({
        ...input,
        sourceMessageId: randomUUID(),
      }).pipe(Effect.result);

      expect(Result.isFailure(result5)).toBe(true);
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
        failure: { reason: "invalid_source" },
      });
      yield* sql`UPDATE channel_identity SET revoked_at = clock_timestamp() WHERE id = ${input.identityId}`;
      expect(
        yield* readChannelResponseContext(input).pipe(Effect.result)
      ).toMatchObject({
        failure: { reason: "identity_inactive" },
      });
    }).pipe(Effect.scoped, Effect.provide(live))
  ));
