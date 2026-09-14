import { randomBytes, randomUUID } from "node:crypto";
import { Effect, Layer, Result } from "effect";
import { expect, test, vi } from "vitest";
import { ChannelAccounts } from "../../server/accounts";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { workspaceFixture } from "./workspace-fixture";
import { runtimeDatabase } from "./database";
import type * as Environment from "../../shared/environment/env";

vi.mock("@shared/environment/env", async (original) => {
  const loaded = await original<typeof Environment>();
  return {
    env: {
      ...loaded.env,
      ZOEN_REGISTRATION_MODE: "closed",
      ZOEN_BETA_IDENTITIES: ["telegram:100001"],
    },
  };
});

const services = ChannelAccounts.layer.pipe(
  Layer.provideMerge(WorkspaceRepository.layer),
  Layer.provideMerge(runtimeDatabase)
);

test("closed beta denies uninvited registration but preserves invited users and authenticated linking", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* workspaceFixture();
      const accounts = yield* ChannelAccounts;
      const sender = {
        channel: "telegram" as const,
        installationId: randomUUID(),
        senderId: "100001",
      };
      const outsider = { ...sender, senderId: "100002" };
      const denied = yield* accounts
        .resolveVerifiedSender(outsider)
        .pipe(Effect.result);
      expect(Result.isFailure(denied) && denied.failure).toMatchObject({
        reason: "registration_closed",
      });
      expect(
        yield* fixture.sql`SELECT id FROM channel_identity WHERE installation_id = ${sender.installationId}`
      ).toEqual([]);

      const identity = yield* accounts.resolveVerifiedSender(sender);
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* fixture.sql`DELETE FROM workspaces WHERE id = ${accessScopeForUser(`better-auth:${identity.userId}`).workspaceId}`;
          yield* fixture.sql`DELETE FROM public.user WHERE id = ${identity.userId}`;
        }).pipe(Effect.orDie)
      );
      expect(yield* accounts.resolveVerifiedSender(sender)).toEqual(identity);

      const login = yield* accounts.issueChallenge({
        purpose: "login",
        channel: sender.channel,
        installationId: sender.installationId,
        browserSecret: randomBytes(32).toString("base64url"),
      });
      const refused = yield* accounts
        .confirmChallenge({ token: login.token, sender: outsider })
        .pipe(Effect.result);
      expect(Result.isFailure(refused) && refused.failure).toMatchObject({
        reason: "registration_closed",
      });

      const linkSecret = randomBytes(32).toString("base64url");
      const link = yield* accounts.issueChallenge({
        purpose: "link",
        channel: sender.channel,
        installationId: sender.installationId,
        browserSecret: linkSecret,
        userId: fixture.actor.userId.slice("better-auth:".length),
        sessionId: fixture.actor.authSessionId,
      });
      yield* accounts.confirmChallenge({ token: link.token, sender: outsider });
      yield* accounts.consumeChallenge({
        challengeId: link.challengeId,
        browserSecret: linkSecret,
        currentSessionId: fixture.actor.authSessionId,
      });
      const linked = yield* accounts.resolveVerifiedSender(outsider);
      expect(`better-auth:${linked.userId}`).toBe(fixture.actor.userId);
    }).pipe(Effect.scoped, Effect.provide(services))
  ));
