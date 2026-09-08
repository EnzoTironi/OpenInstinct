import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "vitest";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { PgClient } from "@effect/sql-pg";
import { Config, Effect, Layer, Redacted } from "effect";
import {
  ChannelAccounts,
  ChannelAccountError,
} from "../../server/accounts/index.ts";

const secret = () => randomBytes(32).toString("base64url");

const rejected = <A>(
  effect: Effect.Effect<A, ChannelAccountError | SqlError>,
  reason: ChannelAccountError["reason"]
) =>
  effect.pipe(
    Effect.match({
      onFailure: (error) => {
        assert.ok(error instanceof ChannelAccountError);
        assert.equal(error.reason, reason);
      },
      onSuccess: () => assert.fail(`Expected ${reason}`),
    })
  );
test("channel identities, browser binding, races and revocation against migrated PostgreSQL", async () => {
  const url = await Effect.runPromise(Config.string("DATABASE_URL"));
  assert.ok(url, "DATABASE_URL must name a dedicated migrated test database");
  assert.equal(
    new URL(url).pathname,
    "/companion_accounts_test",
    "Integration requires the dedicated companion_accounts_test database"
  );
  const database = PgClient.layer({ url: Redacted.make(url) });
  const live = ChannelAccounts.layer.pipe(Layer.provideMerge(database));
  await Effect.runPromise(
    Effect.gen(function* () {
      const accounts = yield* ChannelAccounts;
      const sql = yield* PgClient.PgClient;
      const installationId = `test-${randomUUID()}`;
      const sender = {
        channel: "telegram",
        installationId,
        senderId: "12345",
      } as const;
      const userIds = new Set<string>();
      yield* Effect.gen(function* () {
        yield* rejected(
          accounts.resolveVerifiedSender({ ...sender, senderId: " 12345" }),
          "invalid_input"
        );
        const beforeUsers = yield* sql<{
          id: string;
        }>`SELECT id FROM public."user"`;
        const results = yield* Effect.all(
          Array.from({ length: 12 }, () =>
            accounts.resolveVerifiedSender(sender)
          ),
          { concurrency: "unbounded" }
        );
        const first = results[0];
        assert.ok(first);
        userIds.add(first.userId);
        assert.equal(new Set(results.map((identity) => identity.id)).size, 1);
        const created = yield* sql<{
          count: number;
        }>`SELECT count(*)::int AS count FROM public.channel_identity WHERE installation_id = ${installationId}`;
        assert.equal(created[0]?.count, 1);
        const afterUsers = yield* sql<{
          id: string;
        }>`SELECT id FROM public."user"`;
        const previousIds = new Set(beforeUsers.map((user) => user.id));
        const newIds = afterUsers.filter((user) => !previousIds.has(user.id));
        for (const user of newIds) userIds.add(user.id);
        assert.deepEqual(
          newIds.map((user) => user.id),
          [first.userId]
        );
        const browserSecret = secret();
        const challenge = yield* accounts.issueChallenge({
          channel: "telegram",
          installationId,
          browserSecret,
        });
        const previewSender = { ...sender, senderId: "preview-only" };
        const preview = yield* accounts.previewChallenge({
          token: challenge.token,
          sender: previewSender,
        });
        assert.deepEqual(preview, {
          id: challenge.challengeId,
          purpose: "login",
          expiresAt: challenge.expiresAt,
        });
        assert.match(
          challenge.expiresAt,
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
        );
        const expiry = yield* sql<{
          expiresAt: string;
          untouched: boolean;
        }>`SELECT
          to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "expiresAt",
          confirmed_at IS NULL AND identity_id IS NULL AND consumed_at IS NULL AS untouched
          FROM public.channel_auth_challenge WHERE id = ${challenge.challengeId}`;
        assert.equal(expiry[0]?.expiresAt, challenge.expiresAt);
        assert.equal(expiry[0].untouched, true);
        yield* rejected(
          accounts.getActiveIdentity(previewSender),
          "identity_inactive"
        );
        yield* rejected(
          accounts.previewChallenge({
            token: challenge.token,
            sender: { ...sender, channel: "kapso" },
          }),
          "invalid_challenge"
        );
        yield* rejected(
          accounts.previewChallenge({
            token: challenge.token,
            sender: { ...sender, installationId: "wrong" },
          }),
          "invalid_challenge"
        );
        yield* rejected(
          accounts.previewChallenge({ token: secret(), sender }),
          "invalid_challenge"
        );
        const statusInput = {
          challengeId: challenge.challengeId,
          browserSecret,
        };
        assert.deepEqual(yield* accounts.getChallengeStatus(statusInput), {
          status: "pending",
        });
        yield* rejected(
          accounts.getChallengeStatus({
            ...statusInput,
            browserSecret: secret(),
          }),
          "invalid_challenge"
        );
        yield* rejected(
          accounts.getChallengeStatus({
            ...statusInput,
            challengeId: randomUUID(),
          }),
          "invalid_challenge"
        );
        yield* rejected(
          accounts.consumeChallenge({
            challengeId: challenge.challengeId,
            browserSecret,
          }),
          "invalid_challenge"
        );
        yield* rejected(
          accounts.confirmChallenge({
            token: challenge.token,
            sender: { ...sender, installationId: "wrong-installation" },
          }),
          "invalid_challenge"
        );
        yield* accounts.confirmChallenge({ token: challenge.token, sender });
        yield* rejected(
          accounts.confirmChallenge({ token: challenge.token, sender }),
          "invalid_challenge"
        );
        yield* rejected(
          accounts.consumeChallenge({
            challengeId: challenge.challengeId,
            browserSecret: secret(),
          }),
          "invalid_challenge"
        );
        assert.deepEqual(yield* accounts.getChallengeStatus(statusInput), {
          status: "confirmed",
        });
        assert.deepEqual(yield* accounts.getChallengeStatus(statusInput), {
          status: "confirmed",
        });
        yield* rejected(
          accounts.previewChallenge({ token: challenge.token, sender }),
          "invalid_challenge"
        );
        const consumes = yield* Effect.all(
          Array.from({ length: 8 }, () =>
            accounts
              .consumeChallenge({
                challengeId: challenge.challengeId,
                browserSecret,
              })
              .pipe(
                Effect.match({
                  onSuccess: (value) => value,
                  onFailure: (error) => {
                    assert.ok(error instanceof ChannelAccountError);
                    assert.equal(error.reason, "invalid_challenge");
                    return null;
                  },
                })
              )
          ),
          { concurrency: "unbounded" }
        );
        assert.equal(consumes.filter(Boolean).length, 1);
        assert.deepEqual(yield* accounts.getChallengeStatus(statusInput), {
          status: "consumed",
        });
        assert.equal(
          consumes.find(Boolean)?.principalId,
          `better-auth:${first.userId}`
        );
        const stored = yield* sql<{
          token_hash: string;
          browser_secret_hash: string;
        }>`SELECT token_hash, browser_secret_hash
        FROM public.channel_auth_challenge WHERE id = ${challenge.challengeId}`;
        assert.notEqual(stored[0]?.token_hash, challenge.token);
        assert.notEqual(stored[0]?.browser_secret_hash, browserSecret);
        yield* rejected(
          accounts.revokeIdentity({
            identityId: first.id,
            userId: first.userId,
          }),
          "last_access"
        );
        const other = yield* accounts.resolveVerifiedSender({
          ...sender,
          senderId: "67890",
        });
        userIds.add(other.userId);
        yield* rejected(
          accounts.revokeIdentity({
            identityId: first.id,
            userId: other.userId,
          }),
          "identity_inactive"
        );
        const sessionId = randomUUID();
        yield* sql`INSERT INTO public.session (id, token, "userId", "expiresAt", "createdAt", "updatedAt")
        VALUES (${sessionId}, ${secret()}, ${first.userId}, clock_timestamp() + interval '1 hour', clock_timestamp(), clock_timestamp())`;
        const link = { userId: first.userId, sessionId };
        yield* sql`UPDATE public.session SET "createdAt" = clock_timestamp() - interval '11 minutes' WHERE id = ${sessionId}`;
        yield* rejected(
          accounts.issueChallenge({
            channel: "telegram",
            installationId,
            browserSecret,
            link,
          }),
          "session_invalid"
        );
        const rejectedLinks =
          yield* sql`SELECT id FROM public.channel_auth_challenge WHERE requesting_session_id = ${sessionId}`;
        assert.equal(rejectedLinks.length, 0);
        yield* sql`UPDATE public.session SET "createdAt" = clock_timestamp() WHERE id = ${sessionId}`;
        const conflict = yield* accounts.issueChallenge({
          channel: "telegram",
          installationId,
          browserSecret,
          link,
        });
        yield* rejected(
          accounts.confirmChallenge({
            token: conflict.token,
            sender: { ...sender, senderId: "67890" },
          }),
          "account_conflict"
        );
        const linkedSender = {
          ...sender,
          channel: "kapso",
          senderId: "5511999999999",
        } as const;
        const linking = yield* accounts.issueChallenge({
          channel: "kapso",
          installationId,
          browserSecret,
          link,
        });
        assert.deepEqual(
          yield* accounts.previewChallenge({
            token: linking.token,
            sender: linkedSender,
          }),
          {
            id: linking.challengeId,
            purpose: "link",
            expiresAt: linking.expiresAt,
          }
        );
        yield* rejected(
          accounts.getActiveIdentity(linkedSender),
          "identity_inactive"
        );
        yield* accounts.confirmChallenge({
          token: linking.token,
          sender: linkedSender,
        });
        yield* rejected(
          accounts.consumeChallenge({
            challengeId: linking.challengeId,
            browserSecret,
            currentSessionId: "wrong",
          }),
          "session_invalid"
        );
        yield* rejected(
          accounts.getActiveIdentity(linkedSender),
          "identity_inactive"
        );
        const linked = yield* accounts.consumeChallenge({
          challengeId: linking.challengeId,
          browserSecret,
          currentSessionId: sessionId,
        });
        assert.equal(linked.userId, first.userId);
        const staleSender = { ...sender, senderId: "stale-link-proof" };
        const staleLink = yield* accounts.issueChallenge({
          channel: "telegram",
          installationId,
          browserSecret,
          link,
        });
        yield* accounts.confirmChallenge({
          token: staleLink.token,
          sender: staleSender,
        });
        yield* rejected(
          accounts.getActiveIdentity(staleSender),
          "identity_inactive"
        );
        yield* sql`UPDATE public.session SET "createdAt" = clock_timestamp() - interval '11 minutes' WHERE id = ${sessionId}`;
        yield* rejected(
          accounts.consumeChallenge({
            challengeId: staleLink.challengeId,
            browserSecret,
            currentSessionId: sessionId,
          }),
          "session_invalid"
        );
        yield* rejected(
          accounts.getActiveIdentity(staleSender),
          "identity_inactive"
        );
        yield* sql`UPDATE public.session SET "createdAt" = clock_timestamp() WHERE id = ${sessionId}`;
        yield* sql`UPDATE public.channel_auth_challenge SET created_at = clock_timestamp() - interval '6 minutes', expires_at = clock_timestamp() - interval '1 second' WHERE id = ${staleLink.challengeId}`;
        yield* rejected(
          accounts.consumeChallenge({
            challengeId: staleLink.challengeId,
            browserSecret,
            currentSessionId: sessionId,
          }),
          "invalid_challenge"
        );
        yield* rejected(
          accounts.getActiveIdentity(staleSender),
          "identity_inactive"
        );
        const newLoginSender = {
          ...sender,
          senderId: "new-login-at-consumption",
        };
        const newLogin = yield* accounts.issueChallenge({
          channel: "telegram",
          installationId,
          browserSecret,
        });
        yield* accounts.confirmChallenge({
          token: newLogin.token,
          sender: newLoginSender,
        });
        yield* rejected(
          accounts.getActiveIdentity(newLoginSender),
          "identity_inactive"
        );
        const activatedLogin = yield* accounts.consumeChallenge({
          challengeId: newLogin.challengeId,
          browserSecret,
        });
        userIds.add(activatedLogin.userId);
        assert.equal(
          (yield* accounts.getActiveIdentity(newLoginSender)).userId,
          activatedLogin.userId
        );
        const abandonedSender = {
          ...sender,
          senderId: "abandoned-login-proof",
        };
        const abandoned = yield* accounts.issueChallenge({
          channel: "telegram",
          installationId,
          browserSecret,
        });
        const beforeProofUsers = yield* sql<{
          count: number;
        }>`SELECT count(*)::int AS count FROM public."user"`;
        yield* accounts.confirmChallenge({
          token: abandoned.token,
          sender: abandonedSender,
        });
        yield* rejected(
          accounts.getActiveIdentity(abandonedSender),
          "identity_inactive"
        );
        const afterProofUsers = yield* sql<{
          count: number;
        }>`SELECT count(*)::int AS count FROM public."user"`;
        assert.equal(afterProofUsers[0]?.count, beforeProofUsers[0]?.count);
        yield* rejected(
          accounts.consumeChallenge({
            challengeId: abandoned.challengeId,
            browserSecret: secret(),
          }),
          "invalid_challenge"
        );
        yield* rejected(
          accounts.getActiveIdentity(abandonedSender),
          "identity_inactive"
        );
        yield* sql`UPDATE public.channel_auth_challenge SET created_at = clock_timestamp() - interval '6 minutes', expires_at = clock_timestamp() - interval '1 second' WHERE id = ${abandoned.challengeId}`;
        yield* rejected(
          accounts.consumeChallenge({
            challengeId: abandoned.challengeId,
            browserSecret,
          }),
          "invalid_challenge"
        );
        yield* rejected(
          accounts.getActiveIdentity(abandonedSender),
          "identity_inactive"
        );
        const expiring = yield* accounts.issueChallenge({
          channel: "telegram",
          installationId,
          browserSecret,
        });
        yield* sql`UPDATE public.channel_auth_challenge SET created_at = clock_timestamp() - interval '6 minutes', expires_at = clock_timestamp() - interval '1 second' WHERE id = ${expiring.challengeId}`;
        yield* rejected(
          accounts.confirmChallenge({ token: expiring.token, sender }),
          "invalid_challenge"
        );
        yield* rejected(
          accounts.previewChallenge({ token: expiring.token, sender }),
          "invalid_challenge"
        );
        const expiredConsumption = yield* accounts.issueChallenge({
          channel: "telegram",
          installationId,
          browserSecret,
        });
        yield* accounts.confirmChallenge({
          token: expiredConsumption.token,
          sender,
        });
        yield* sql`UPDATE public.channel_auth_challenge SET created_at = clock_timestamp() - interval '6 minutes', expires_at = clock_timestamp() - interval '1 second' WHERE id = ${expiredConsumption.challengeId}`;
        yield* rejected(
          accounts.consumeChallenge({
            challengeId: expiredConsumption.challengeId,
            browserSecret,
          }),
          "invalid_challenge"
        );
        assert.deepEqual(
          yield* accounts.getChallengeStatus({
            challengeId: expiredConsumption.challengeId,
            browserSecret,
          }),
          { status: "expired" }
        );
        const pending = yield* accounts.issueChallenge({
          channel: "telegram",
          installationId,
          browserSecret,
        });
        yield* accounts.confirmChallenge({ token: pending.token, sender });
        yield* accounts.revokeIdentity({
          identityId: first.id,
          userId: first.userId,
        });
        yield* rejected(
          accounts.getActiveIdentity(sender),
          "identity_inactive"
        );
        yield* rejected(
          accounts.resolveVerifiedSender(sender),
          "identity_inactive"
        );
        yield* rejected(
          accounts.consumeChallenge({
            challengeId: pending.challengeId,
            browserSecret,
          }),
          "invalid_challenge"
        );
        assert.deepEqual(
          yield* accounts.getChallengeStatus({
            challengeId: pending.challengeId,
            browserSecret,
          }),
          { status: "expired" }
        );
        yield* rejected(
          accounts.previewChallenge({ token: pending.token, sender }),
          "invalid_challenge"
        );
        const sessions =
          yield* sql`SELECT id FROM public.session WHERE "userId" = ${first.userId}`;
        assert.equal(sessions.length, 0);
        yield* rejected(
          accounts.revokeIdentity({
            identityId: linked.identityId,
            userId: first.userId,
          }),
          "last_access"
        );
      }).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            yield* sql`DELETE FROM public.channel_auth_challenge WHERE installation_id = ${installationId}`;
            yield* sql`DELETE FROM public.channel_identity WHERE installation_id = ${installationId}`;
            for (const id of userIds)
              yield* sql`DELETE FROM public."user" WHERE id = ${id}`;
          }).pipe(Effect.orDie)
        )
      );
    }).pipe(Effect.provide(live))
  );
}, 30_000);
