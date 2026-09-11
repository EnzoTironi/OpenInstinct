/* oxlint-disable vitest/no-standalone-expect -- @effect/vitest it.effect bodies are test blocks */
import { randomUUID } from "node:crypto";

import { PgClient } from "@effect/sql-pg";
import { expect, it } from "@effect/vitest";
import { Effect, Layer, Result } from "effect";

import { ChannelAccounts } from "../../server/accounts";
import { Kapso } from "../../server/channels/kapso";
import {
  channelPrincipal,
  requireChannelPrincipal,
} from "../../server/channels/principal";
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

it.effect(
  "channel callbacks require the current identity, owner, workspace and conversation",
  () =>
    Effect.gen(function* () {
      const accounts = yield* ChannelAccounts;
      const sql = yield* PgClient.PgClient;

      const identity = yield* accounts.resolveVerifiedSender({
        channel: "telegram",
        installationId: randomUUID(),
        senderId: "918273",
      });

      yield* Effect.addFinalizer(() =>
        sql`DELETE FROM workspaces WHERE id = ${accessScopeForUser(`better-auth:${identity.userId}`).workspaceId}`.pipe(
          Effect.andThen(
            sql`DELETE FROM public."user" WHERE id = ${identity.userId}`
          ),
          Effect.catch((error) => Effect.die(error))
        )
      );
      const auth = channelPrincipal(identity, "message-5");
      expect(yield* requireChannelPrincipal("telegram", auth)).toEqual(
        identity
      );

      const invalid = [
        null,
        { ...auth, principalId: `better-auth:${randomUUID()}` },
        { ...auth, principalType: "service" },
        {
          ...auth,
          attributes: { ...auth.attributes, workspaceId: "another-workspace" },
        },
        {
          ...auth,
          attributes: { ...auth.attributes, conversationId: randomUUID() },
        },
        {
          ...auth,
          attributes: { ...auth.attributes, conversationChannel: "kapso" },
        },
        {
          ...auth,
          attributes: { ...auth.attributes, channelIdentityId: randomUUID() },
        },
        {
          ...auth,
          attributes: { ...auth.attributes, channelIdentityId: [identity.id] },
        },
      ];

      yield* Effect.forEach(
        invalid,
        Effect.fn("session.invalidPrincipal")(function* (principal) {
          const invalidResult = yield* requireChannelPrincipal(
            "telegram",
            principal
          ).pipe(Effect.result);

          expect(Result.isFailure(invalidResult)).toBe(true);
        }),
        { concurrency: 1 }
      );

      yield* sql`UPDATE public.channel_identity SET revoked_at = clock_timestamp() WHERE id = ${identity.id}`;

      const revokedResult = yield* requireChannelPrincipal(
        "telegram",
        auth
      ).pipe(Effect.result);

      expect(Result.isFailure(revokedResult)).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(live))
);
