import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import { PgClient } from "@effect/sql-pg";
import {
  Config,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Redacted,
  Schedule,
} from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { test } from "vitest";

import {
  ChannelAccounts,
  ChannelAccountError,
} from "../../server/accounts/index.ts";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { runtimeDatabase } from "./database";

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
  const live = ChannelAccounts.layer.pipe(Layer.provideMerge(runtimeDatabase));
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
          { concurrency: 8 }
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
          purpose: "login" as const,
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
          { concurrency: 8 }
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
            purpose: "link" as const,
            userId: link.userId,
            sessionId: link.sessionId,
            channel: "telegram",
            installationId,
            browserSecret,
          }),
          "session_invalid"
        );

        const rejectedLinks =
          yield* sql`SELECT id FROM public.channel_auth_challenge WHERE requesting_session_id = ${sessionId}`;

        assert.equal(rejectedLinks.length, 0);
        yield* sql`UPDATE public.session SET "createdAt" = clock_timestamp() WHERE id = ${sessionId}`;

        const conflict = yield* accounts.issueChallenge({
          purpose: "link" as const,
          userId: link.userId,
          sessionId: link.sessionId,
          channel: "telegram",
          installationId,
          browserSecret,
        });

        yield* rejected(
          accounts.previewChallenge({
            token: conflict.token,
            sender: { ...sender, senderId: "67890" },
          }),
          "account_conflict"
        );
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
          purpose: "link" as const,
          userId: link.userId,
          sessionId: link.sessionId,
          channel: "kapso",
          installationId,
          browserSecret,
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
          purpose: "link" as const,
          userId: link.userId,
          sessionId: link.sessionId,
          channel: "telegram",
          installationId,
          browserSecret,
        });

        yield* sql`UPDATE public.session SET "createdAt" = clock_timestamp() - interval '11 minutes' WHERE id = ${sessionId}`;
        yield* rejected(
          accounts.previewChallenge({
            token: staleLink.token,
            sender: staleSender,
          }),
          "session_invalid"
        );
        yield* sql`UPDATE public.session SET "createdAt" = clock_timestamp(), "expiresAt" = clock_timestamp() - interval '1 second' WHERE id = ${sessionId}`;
        yield* rejected(
          accounts.previewChallenge({
            token: staleLink.token,
            sender: staleSender,
          }),
          "session_invalid"
        );
        yield* sql`UPDATE public.session SET "expiresAt" = clock_timestamp() + interval '1 hour', "userId" = ${other.userId} WHERE id = ${sessionId}`;
        yield* rejected(
          accounts.previewChallenge({
            token: staleLink.token,
            sender: staleSender,
          }),
          "session_invalid"
        );
        yield* sql`UPDATE public.session SET "userId" = ${first.userId} WHERE id = ${sessionId}`;
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
          purpose: "login" as const,
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
          purpose: "login" as const,
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
          purpose: "login" as const,
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
          purpose: "login" as const,
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
          purpose: "login" as const,
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

        const revokedLogin = yield* accounts.issueChallenge({
          purpose: "login" as const,
          channel: "telegram",
          installationId,
          browserSecret,
        });

        yield* rejected(
          accounts.previewChallenge({ token: revokedLogin.token, sender }),
          "identity_inactive"
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

            for (const id of userIds) {
              yield* sql`DELETE FROM workspaces WHERE id = ${accessScopeForUser(`better-auth:${id}`).workspaceId}`;
              yield* sql`DELETE FROM public."user" WHERE id = ${id}`;
            }
          }).pipe(Effect.orDie)
        )
      );
    }).pipe(Effect.provide(live))
  );
}, 30_000);

test("session issuance serializes with revocation across real PostgreSQL connections", async () => {
  const url = await Effect.runPromise(
    Config.string("DATABASE_URL").pipe(Effect.provide(runtimeDatabase))
  );

  const storage = PgClient.layer({ url: Redacted.make(url) });
  const live = ChannelAccounts.layer.pipe(Layer.provideMerge(runtimeDatabase));
  await Effect.runPromise(
    Effect.gen(function* () {
      const accounts = yield* ChannelAccounts;
      const sql = yield* PgClient.PgClient;

      for (const order of ["before", "during", "after"] as const) {
        const installationId = `issuance-${randomUUID()}`;
        const browserSecret = secret();

        const challenge = yield* accounts.issueChallenge({
          purpose: "login" as const,
          channel: "telegram",
          installationId,
          browserSecret,
        });

        const sender = {
          channel: "telegram" as const,
          installationId,
          senderId: "first-contact",
        };

        yield* accounts.confirmChallenge({ token: challenge.token, sender });

        const owner = yield* accounts.consumeChallenge({
          challengeId: challenge.challengeId,
          browserSecret,
        });

        try {
          // A second synthetic access path makes revocation legal; all storage is real.
          yield* sql`INSERT INTO public.channel_identity (id, channel, installation_id, sender_id, user_id, verified_at, created_at, updated_at)
          VALUES (${randomUUID()}, 'telegram', ${installationId}, 'backup', ${owner.userId}, clock_timestamp(), clock_timestamp(), clock_timestamp())`;
          const sessionId = randomUUID();

          const createSession = Effect.gen(function* () {
            const separateConnection = yield* PgClient.PgClient;
            yield* separateConnection`INSERT INTO public.session (id, token, "userId", "expiresAt", "createdAt", "updatedAt")
            VALUES (${sessionId}, ${secret()}, ${owner.userId}, clock_timestamp() + interval '1 hour', clock_timestamp(), clock_timestamp())`;

            return sessionId;
          }).pipe(Effect.provide(storage));

          if (order === "before") {
            yield* accounts.revokeIdentity(owner);
            yield* rejected(
              accounts.withLoginSession(owner, createSession),
              "identity_inactive"
            );
          } else if (order === "after") {
            assert.equal(
              yield* accounts.withLoginSession(owner, createSession),
              sessionId
            );

            const inserted =
              yield* sql`SELECT id FROM public.session WHERE id = ${sessionId}`;

            assert.equal(inserted.length, 1);
            yield* accounts.revokeIdentity(owner);
          } else {
            const entered = yield* Deferred.make<undefined>();
            const release = yield* Deferred.make<undefined>();

            const finalization = yield* accounts
              .withLoginSession(
                owner,
                Effect.gen(function* () {
                  yield* Deferred.succeed(entered, undefined);
                  yield* Deferred.await(release);

                  return yield* createSession;
                })
              )
              .pipe(Effect.forkChild);

            yield* Deferred.await(entered);

            const revocation = yield* accounts
              .revokeIdentity(owner)
              .pipe(Effect.forkChild);

            yield* sql<{
              waiting: boolean;
            }>`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory'
            AND classid = 724193 AND objid = 1 AND NOT granted) AS waiting`.pipe(
              Effect.repeat({
                until: (rows) => rows[0]?.waiting === true,
                schedule: Schedule.spaced("10 millis"),
              }),
              Effect.timeout("5 seconds"),
              Effect.ensuring(Deferred.succeed(release, undefined))
            );
            assert.equal(yield* Fiber.join(finalization), sessionId);
            yield* Fiber.join(revocation);
          }

          const sessions =
            yield* sql`SELECT id FROM public.session WHERE "userId" = ${owner.userId}`;

          assert.equal(sessions.length, 0);
        } finally {
          yield* sql`DELETE FROM public.channel_auth_challenge WHERE installation_id = ${installationId}`;
          yield* sql`DELETE FROM public.channel_identity WHERE installation_id = ${installationId}`;
          yield* sql`DELETE FROM workspaces WHERE id = ${accessScopeForUser(`better-auth:${owner.userId}`).workspaceId}`;
          yield* sql`DELETE FROM public."user" WHERE id = ${owner.userId}`;
        }
      }
    }).pipe(Effect.provide(live))
  );
});
