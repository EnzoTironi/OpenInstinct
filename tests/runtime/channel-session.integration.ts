import { randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Effect, Layer } from "effect";
import { expect, test } from "vitest";
import { ChannelAccounts } from "../../server/accounts";
import { Messaging } from "../../server/messaging";
import { ChannelTransport } from "../../server/channels/transport";
import { Telegram } from "../../server/channels/telegram";
import { Kapso } from "../../server/channels/kapso";
import {
  channelPrincipal,
  requireChannelPrincipal,
} from "../../agent/lib/channel-session";
import { runtimeDatabase } from "./database";

const infrastructure = Layer.mergeAll(
  ChannelAccounts.layer,
  Messaging.layer,
  Telegram.layer,
  Kapso.layer
).pipe(Layer.provideMerge(runtimeDatabase));
const live = ChannelTransport.layer.pipe(Layer.provideMerge(infrastructure));

test("channel callbacks require the current identity, owner, workspace and conversation", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const accounts = yield* ChannelAccounts;
      const sql = yield* PgClient.PgClient;
      const identity = yield* accounts.resolveVerifiedSender({
        channel: "telegram",
        installationId: randomUUID(),
        senderId: "918273",
      });
      yield* Effect.addFinalizer(() =>
        sql`DELETE FROM public."user" WHERE id = ${identity.userId}`.pipe(
          Effect.orDie
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
      for (const principal of invalid) {
        expect(
          yield* requireChannelPrincipal("telegram", principal).pipe(
            Effect.result
          )
        ).toMatchObject({ _tag: "Failure" });
      }
      yield* sql`UPDATE public.channel_identity SET revoked_at = clock_timestamp() WHERE id = ${identity.id}`;
      expect(
        yield* requireChannelPrincipal("telegram", auth).pipe(Effect.result)
      ).toMatchObject({ _tag: "Failure" });
    }).pipe(Effect.scoped, Effect.provide(live))
  ));
