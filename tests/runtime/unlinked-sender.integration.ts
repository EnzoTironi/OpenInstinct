import { randomBytes, randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Effect, Layer, Result, type Scope } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { expect, test, vi } from "vitest";
import {
  ChannelAccountError,
  ChannelAccounts,
  type VerifiedSender,
} from "../../server/accounts";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { workspaceFixture } from "./workspace-fixture";
import { linkedIdentity } from "./identity-fixture";
import { runtimeDatabase } from "./database";
import type * as Environment from "../../shared/environment/env";

vi.mock("@shared/environment", async (original) => {
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
const secret = () => randomBytes(32).toString("base64url");
const reasonOf = <A>(
  effect: Effect.Effect<A, ChannelAccountError | SqlError>
) =>
  effect.pipe(
    Effect.result,
    Effect.map((result) =>
      Result.isFailure(result) && result.failure instanceof ChannelAccountError
        ? result.failure.reason
        : result
    )
  );
const unknownSender = Effect.fn("unknownSender")(function* () {
  const sql = yield* PgClient.PgClient;
  const sender = {
    channel: "telegram" as const,
    installationId: randomUUID(),
    senderId: "100001",
  };
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      yield* sql`DELETE FROM public.channel_auth_challenge WHERE installation_id = ${sender.installationId}`;
      yield* sql`DELETE FROM public.channel_pending_sender WHERE installation_id = ${sender.installationId}`;
      yield* sql`DELETE FROM public.channel_identity WHERE installation_id = ${sender.installationId}`;
    }).pipe(Effect.orDie)
  );
  return sender;
});
const removeUser = (userId: string) =>
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    yield* sql`DELETE FROM workspaces WHERE id = ${accessScopeForUser(`better-auth:${userId}`).workspaceId}`;
    yield* sql`DELETE FROM public."user" WHERE id = ${userId}`;
  }).pipe(Effect.orDie);
const userCount = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const rows = yield* sql<{
    count: number;
  }>`SELECT count(*)::int AS count FROM public."user"`;
  return rows[0]?.count;
});
const identityRows = (sender: typeof VerifiedSender.Type) =>
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    return yield* sql<{
      userId: string;
      revoked: boolean;
    }>`SELECT user_id AS "userId", revoked_at IS NOT NULL AS revoked FROM public.channel_identity
      WHERE channel = ${sender.channel} AND installation_id = ${sender.installationId} AND sender_id = ${sender.senderId}`;
  });
const pendingRows = (sender: typeof VerifiedSender.Type) =>
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    return yield* sql<{
      contactCount: number;
      prompted: boolean;
    }>`SELECT contact_count AS "contactCount", prompted_at IS NOT NULL AS prompted FROM public.channel_pending_sender
      WHERE channel = ${sender.channel} AND installation_id = ${sender.installationId} AND sender_id = ${sender.senderId}`;
  });
const run = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    ChannelAccounts | WorkspaceRepository | PgClient.PgClient | Scope.Scope
  >
) => Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(services)));

test("an unknown private sender is recorded once per day and never becomes a user", () =>
  run(
    Effect.gen(function* () {
      const accounts = yield* ChannelAccounts;
      const sender = yield* unknownSender();
      const before = yield* userCount;
      expect(yield* accounts.resolveVerifiedSender(sender)).toEqual({
        status: "unlinked",
        sender,
      });
      expect(yield* accounts.recordUnlinkedContact(sender)).toEqual({
        prompt: true,
      });
      expect(yield* accounts.recordUnlinkedContact(sender)).toEqual({
        prompt: false,
      });
      expect(yield* pendingRows(sender)).toEqual([
        { contactCount: 2, prompted: true },
      ]);
      expect(yield* userCount).toBe(before);
      expect(yield* identityRows(sender)).toEqual([]);
    })
  ));

test("a login challenge cannot be confirmed by an unknown sender", () =>
  run(
    Effect.gen(function* () {
      const accounts = yield* ChannelAccounts;
      const sender = yield* unknownSender();
      const browserSecret = secret();
      const before = yield* userCount;
      const login = yield* accounts.issueChallenge({
        purpose: "login",
        channel: sender.channel,
        installationId: sender.installationId,
        browserSecret,
      });
      expect(
        yield* reasonOf(
          accounts.previewChallenge({ token: login.token, sender })
        )
      ).toBe("sender_unlinked");
      expect(
        yield* reasonOf(
          accounts.confirmChallenge({ token: login.token, sender })
        )
      ).toBe("sender_unlinked");
      expect(
        yield* accounts.getChallengeStatus({
          challengeId: login.challengeId,
          browserSecret,
        })
      ).toEqual({ status: "pending" });
      expect(yield* userCount).toBe(before);
      expect(yield* identityRows(sender)).toEqual([]);
    })
  ));

test("a Google user links a messenger through the browser challenge, then signs in with it", () =>
  run(
    Effect.gen(function* () {
      const accounts = yield* ChannelAccounts;
      const fixture = yield* workspaceFixture();
      const userId = fixture.actor.userId.slice("better-auth:".length);
      const sender = yield* unknownSender();
      yield* accounts.recordUnlinkedContact(sender);
      const linkSecret = secret();
      const link = yield* accounts.issueChallenge({
        purpose: "link",
        userId,
        sessionId: fixture.actor.authSessionId,
        browserSecret: linkSecret,
        channel: sender.channel,
        installationId: sender.installationId,
      });
      expect(
        yield* accounts.confirmChallenge({ token: link.token, sender })
      ).toEqual({ challengeId: link.challengeId });
      const linked = yield* accounts.consumeChallenge({
        challengeId: link.challengeId,
        browserSecret: linkSecret,
        currentSessionId: fixture.actor.authSessionId,
      });
      expect(linked).toMatchObject({ userId, purpose: "link" });
      expect(yield* pendingRows(sender)).toEqual([]);
      expect(yield* identityRows(sender)).toEqual([{ userId, revoked: false }]);

      const loginSecret = secret();
      const login = yield* accounts.issueChallenge({
        purpose: "login",
        channel: sender.channel,
        installationId: sender.installationId,
        browserSecret: loginSecret,
      });
      expect(
        yield* accounts.confirmChallenge({ token: login.token, sender })
      ).toEqual({ challengeId: login.challengeId });
      const signedIn = yield* accounts.consumeChallenge({
        challengeId: login.challengeId,
        browserSecret: loginSecret,
      });
      expect(signedIn).toMatchObject({
        userId,
        identityId: linked.identityId,
        purpose: "login",
      });
      expect(yield* accounts.resolveVerifiedSender(sender)).toEqual({
        status: "linked",
        identity: { id: linked.identityId, userId, ...sender },
      });
    })
  ));

test("confirmation is an idempotent receipt bound to the first confirming sender", () =>
  run(
    Effect.gen(function* () {
      const accounts = yield* ChannelAccounts;
      const sender = yield* unknownSender();
      const identity = yield* linkedIdentity(sender);
      yield* Effect.addFinalizer(() => removeUser(identity.userId));
      const browserSecret = secret();
      const login = yield* accounts.issueChallenge({
        purpose: "login",
        channel: sender.channel,
        installationId: sender.installationId,
        browserSecret,
      });
      const receipt = yield* accounts.confirmChallenge({
        token: login.token,
        sender,
      });
      expect(receipt).toEqual({ challengeId: login.challengeId });
      expect(
        yield* accounts.confirmChallenge({ token: login.token, sender })
      ).toEqual(receipt);
      expect(
        yield* reasonOf(
          accounts.confirmChallenge({
            token: login.token,
            sender: { ...sender, senderId: "100002" },
          })
        )
      ).toBe("invalid_challenge");
      expect(
        yield* reasonOf(
          accounts.consumeChallenge({
            challengeId: login.challengeId,
            browserSecret: secret(),
          })
        )
      ).toBe("invalid_challenge");
      expect(
        yield* accounts.getChallengeStatus({
          challengeId: login.challengeId,
          browserSecret,
        })
      ).toEqual({ status: "confirmed" });
    })
  ));

test("tampered and expired tokens are refused", () =>
  run(
    Effect.gen(function* () {
      const accounts = yield* ChannelAccounts;
      const sql = yield* PgClient.PgClient;
      const sender = yield* unknownSender();
      const identity = yield* linkedIdentity(sender);
      yield* Effect.addFinalizer(() => removeUser(identity.userId));
      const browserSecret = secret();
      const login = yield* accounts.issueChallenge({
        purpose: "login",
        channel: sender.channel,
        installationId: sender.installationId,
        browserSecret,
      });
      const tampered = `${login.token.startsWith("A") ? "B" : "A"}${login.token.slice(1)}`;
      expect(
        yield* reasonOf(accounts.previewChallenge({ token: tampered, sender }))
      ).toBe("invalid_challenge");
      expect(
        yield* reasonOf(accounts.confirmChallenge({ token: tampered, sender }))
      ).toBe("invalid_challenge");
      yield* sql`UPDATE public.channel_auth_challenge
        SET created_at = clock_timestamp() - interval '6 minutes', expires_at = clock_timestamp() - interval '1 second'
        WHERE id = ${login.challengeId}`;
      expect(
        yield* reasonOf(
          accounts.confirmChallenge({ token: login.token, sender })
        )
      ).toBe("invalid_challenge");
      expect(
        yield* accounts.getChallengeStatus({
          challengeId: login.challengeId,
          browserSecret,
        })
      ).toEqual({ status: "expired" });
    })
  ));

test("a second person cannot link a messenger that already belongs to someone", () =>
  run(
    Effect.gen(function* () {
      const accounts = yield* ChannelAccounts;
      const fixture = yield* workspaceFixture();
      const sender = yield* unknownSender();
      const owner = yield* linkedIdentity(sender);
      yield* Effect.addFinalizer(() => removeUser(owner.userId));
      const takeover = yield* accounts.issueChallenge({
        purpose: "link",
        userId: fixture.guest.userId.slice("better-auth:".length),
        sessionId: fixture.guest.authSessionId,
        browserSecret: secret(),
        channel: sender.channel,
        installationId: sender.installationId,
      });
      expect(
        yield* reasonOf(
          accounts.confirmChallenge({ token: takeover.token, sender })
        )
      ).toBe("account_conflict");
      expect(yield* identityRows(sender)).toEqual([
        { userId: owner.userId, revoked: false },
      ]);
    })
  ));
