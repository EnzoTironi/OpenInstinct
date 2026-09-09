import { accessScopeForUser } from "../../shared/identity/access-scope";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { ResolvedInstallationSecrets } from "@db/services/installation-secrets";
import { Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { test } from "vitest";
import {
  ChannelAccountError,
  ChannelAccounts,
} from "../../server/accounts/index.ts";
import {
  ChannelAuthPromptError,
  ChannelAuthPrompts,
} from "../../server/channel-auth/prompts.ts";

import { runtimeDatabase } from "./database";

const rejected = <A>(
  operation: Effect.Effect<
    A,
    ChannelAccountError | ChannelAuthPromptError | SqlError
  >,
  reason: ChannelAuthPromptError["reason"]
) =>
  operation.pipe(
    Effect.match({
      onSuccess: () => assert.fail(`Expected ${reason}`),
      onFailure: (failure) => {
        assert.ok(failure instanceof ChannelAuthPromptError);
        assert.equal(failure.reason, reason);
      },
    })
  );

test("encrypted confirmation outbox is idempotent, fenced and never retries uncertain delivery", async () => {
  const accountsLayer = ChannelAccounts.layer.pipe(
    Layer.provideMerge(runtimeDatabase)
  );
  const testKey = randomBytes(32).toString("base64url");
  const secrets = ResolvedInstallationSecrets.layerFromResolved({
    betterAuthSecret: testKey,
    secretEncryptionKey: randomBytes(32).toString("base64"),
  });
  const live = ChannelAuthPrompts.layer.pipe(
    Layer.provideMerge(secrets),
    Layer.provideMerge(accountsLayer)
  );
  await Effect.runPromise(
    Effect.gen(function* () {
      const accounts = yield* ChannelAccounts;
      const prompts = yield* ChannelAuthPrompts;
      const sql = yield* PgClient.PgClient;
      const installationId = `prompts-${randomUUID()}`;
      const sender = {
        channel: "telegram" as const,
        installationId,
        senderId: "private-sender",
      };
      const issue = accounts.issueChallenge({
        channel: "telegram",
        installationId,
        browserSecret: randomBytes(32).toString("base64url"),
      });
      try {
        const unavailableKey = yield* issue;
        const unavailableLive = ChannelAuthPrompts.layer.pipe(
          Layer.provideMerge(
            ResolvedInstallationSecrets.layerFromResolved({
              betterAuthSecret: "short",
              secretEncryptionKey: randomBytes(32).toString("base64"),
            })
          ),
          Layer.provideMerge(accountsLayer)
        );
        yield* Effect.gen(function* () {
          const shortPrompts = yield* ChannelAuthPrompts;
          yield* shortPrompts.prepare({
            token: unavailableKey.token,
            sender,
            eventId: randomUUID(),
          });
        }).pipe(
          Effect.provide(Layer.fresh(unavailableLive)),
          Effect.matchEffect({
            onSuccess: () =>
              Effect.sync(() => assert.fail("Expected crypto_unavailable")),
            onFailure: (failure) =>
              Effect.sync(() => {
                assert.ok(failure instanceof ChannelAuthPromptError);
                assert.equal(failure.reason, "crypto_unavailable");
              }),
          })
        );
        const unqueued =
          yield* sql`SELECT challenge_id FROM public.channel_auth_prompt WHERE challenge_id = ${unavailableKey.challengeId}`;
        assert.equal(unqueued.length, 0);
        const challenge = yield* issue;
        const request = {
          token: challenge.token,
          sender,
          eventId: randomUUID(),
        };
        const beforeUsers = yield* sql<{
          count: number;
        }>`SELECT count(*)::int AS count FROM public."user"`;
        const receipts = yield* Effect.all(
          Array.from({ length: 8 }, () => prompts.prepare(request)),
          { concurrency: "unbounded" }
        );
        for (const receipt of receipts)
          assert.deepEqual(receipt, {
            challengeId: challenge.challengeId,
            status: "queued",
          });
        const afterUsers = yield* sql<{
          count: number;
        }>`SELECT count(*)::int AS count FROM public."user"`;
        assert.equal(afterUsers[0]?.count, beforeUsers[0]?.count);
        const identities =
          yield* sql`SELECT id FROM public.channel_identity WHERE installation_id = ${installationId}`;
        assert.equal(identities.length, 0);
        const encrypted = yield* sql<{
          tokenCiphertext: string;
          count: number;
        }>`SELECT token_ciphertext AS "tokenCiphertext", count(*) OVER ()::int AS count
        FROM public.channel_auth_prompt WHERE challenge_id = ${challenge.challengeId}`;
        const ciphertext = encrypted[0]?.tokenCiphertext;
        assert.ok(ciphertext);
        assert.equal(encrypted[0]?.count, 1);
        assert.notEqual(ciphertext, challenge.token);
        assert.equal(ciphertext.includes(challenge.token), false);
        assert.equal(ciphertext.includes(sender.senderId), false);
        yield* rejected(
          prompts.prepare({
            ...request,
            sender: { ...sender, senderId: "other-sender" },
          }),
          "conflict"
        );
        const other = yield* issue;
        yield* rejected(
          prompts.prepare({ ...request, token: other.token }),
          "conflict"
        );
        assert.deepEqual(
          yield* prompts.prepare({ ...request, eventId: randomUUID() }),
          { challengeId: challenge.challengeId, status: "queued" }
        );
        yield* rejected(prompts.pending(101), "invalid_input");
        assert.ok(
          (yield* prompts.pending(100)).includes(challenge.challengeId)
        );
        const claims = yield* Effect.all(
          Array.from({ length: 8 }, () => prompts.claim(challenge.challengeId)),
          { concurrency: "unbounded" }
        );
        assert.equal(claims.filter(Boolean).length, 1);
        const claimed = claims.find((value) => value !== null);
        assert.ok(claimed);
        assert.equal(claimed.token, challenge.token);
        assert.equal(claimed.senderId, sender.senderId);
        yield* rejected(
          prompts.checkLease({ ...claimed.lease, leaseToken: randomUUID() }),
          "lease_lost"
        );
        yield* rejected(
          prompts.markSent(
            { ...claimed.lease, leaseToken: randomUUID() },
            "wrong-worker"
          ),
          "lease_lost"
        );
        yield* prompts.checkLease(claimed.lease);
        yield* prompts.markSent(claimed.lease, "synthetic-message-id");
        yield* rejected(prompts.markUncertain(claimed.lease), "lease_lost");
        assert.deepEqual(yield* prompts.prepare(request), {
          challengeId: challenge.challengeId,
          status: "sent",
        });
        assert.equal(yield* prompts.claim(challenge.challengeId), null);
        const sent = yield* sql<{
          tokenCiphertext: string | null;
          attempts: number;
          providerMessageId: string;
        }>`SELECT token_ciphertext AS "tokenCiphertext", attempts,
        provider_message_id AS "providerMessageId" FROM public.channel_auth_prompt WHERE challenge_id = ${challenge.challengeId}`;
        assert.equal(sent[0]?.tokenCiphertext, null);
        assert.equal(sent[0].attempts, 1);
        assert.equal(sent[0].providerMessageId, "synthetic-message-id");
        const expiredLease = yield* issue;
        const leaseRequest = {
          token: expiredLease.token,
          sender,
          eventId: randomUUID(),
        };
        yield* prompts.prepare(leaseRequest);
        const leased = yield* prompts.claim(expiredLease.challengeId);
        assert.ok(leased);
        yield* sql`UPDATE public.channel_auth_prompt SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE challenge_id = ${expiredLease.challengeId}`;
        yield* rejected(prompts.checkLease(leased.lease), "lease_lost");
        assert.deepEqual(yield* prompts.prepare(leaseRequest), {
          challengeId: expiredLease.challengeId,
          status: "uncertain",
        });
        assert.equal(yield* prompts.claim(expiredLease.challengeId), null);
        yield* rejected(
          prompts.markSent(leased.lease, "late-result"),
          "lease_lost"
        );
        const expiredChallenge = yield* issue;
        yield* prompts.prepare({
          token: expiredChallenge.token,
          sender,
          eventId: randomUUID(),
        });
        yield* sql`UPDATE public.channel_auth_challenge SET created_at = clock_timestamp() - interval '6 minutes', expires_at = clock_timestamp() - interval '1 second' WHERE id = ${expiredChallenge.challengeId}`;
        assert.equal(yield* prompts.claim(expiredChallenge.challengeId), null);
        const cancelled = yield* sql<{
          status: string;
          tokenCiphertext: string | null;
        }>`SELECT status, token_ciphertext AS "tokenCiphertext" FROM public.channel_auth_prompt WHERE challenge_id = ${expiredChallenge.challengeId}`;
        assert.equal(cancelled[0]?.status, "cancelled");
        assert.equal(cancelled[0].tokenCiphertext, null);
        const confirmedChallenge = yield* issue;
        yield* prompts.prepare({
          token: confirmedChallenge.token,
          sender,
          eventId: randomUUID(),
        });
        const confirmedLease = yield* prompts.claim(
          confirmedChallenge.challengeId
        );
        assert.ok(confirmedLease);
        yield* accounts.confirmChallenge({
          token: confirmedChallenge.token,
          sender,
        });
        yield* rejected(prompts.checkLease(confirmedLease.lease), "lease_lost");
        yield* sql`UPDATE public.channel_auth_prompt SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE challenge_id = ${confirmedChallenge.challengeId}`;
        yield* prompts.pending(100);
        const unresolved = yield* sql<{
          status: string;
          tokenCiphertext: string | null;
        }>`SELECT status, token_ciphertext AS "tokenCiphertext"
          FROM public.channel_auth_prompt WHERE challenge_id = ${confirmedChallenge.challengeId}`;
        assert.equal(unresolved[0]?.status, "uncertain");
        assert.equal(unresolved[0].tokenCiphertext, null);
        assert.equal(
          yield* prompts.claim(confirmedChallenge.challengeId),
          null
        );
        for (const invalidation of ["confirm", "expire"] as const) {
          const inFlight = yield* issue;
          const inFlightRequest = {
            token: inFlight.token,
            sender,
            eventId: randomUUID(),
          };
          yield* prompts.prepare(inFlightRequest);
          const dispatch = yield* prompts.claim(inFlight.challengeId);
          assert.ok(dispatch);
          yield* prompts.checkLease(dispatch.lease);
          // Provider I/O may already be running when the challenge becomes inactive.
          if (invalidation === "confirm")
            yield* accounts.confirmChallenge({ token: inFlight.token, sender });
          else
            yield* sql`UPDATE public.channel_auth_challenge SET created_at = clock_timestamp() - interval '6 minutes', expires_at = clock_timestamp() - interval '1 second' WHERE id = ${inFlight.challengeId}`;
          yield* prompts.pending(100);
          assert.deepEqual(yield* prompts.prepare(inFlightRequest), {
            challengeId: inFlight.challengeId,
            status: "dispatching",
          });
          yield* rejected(prompts.checkLease(dispatch.lease), "lease_lost");
          yield* prompts.markSent(dispatch.lease, "synthetic-inflight-receipt");
          const settled = yield* sql<{
            status: string;
            providerMessageId: string | null;
            tokenCiphertext: string | null;
          }>`SELECT status,
            provider_message_id AS "providerMessageId", token_ciphertext AS "tokenCiphertext" FROM public.channel_auth_prompt WHERE challenge_id = ${inFlight.challengeId}`;
          assert.equal(settled[0]?.status, "sent");
          assert.equal(
            settled[0].providerMessageId,
            "synthetic-inflight-receipt"
          );
          assert.equal(settled[0].tokenCiphertext, null);
          assert.equal(yield* prompts.claim(inFlight.challengeId), null);
        }
        for (const terminal of ["uncertain", "failed"] as const) {
          const item = yield* issue;
          const itemRequest = {
            token: item.token,
            sender,
            eventId: randomUUID(),
          };
          yield* prompts.prepare(itemRequest);
          const lease = yield* prompts.claim(item.challengeId);
          assert.ok(lease);
          if (terminal === "uncertain")
            yield* prompts.markUncertain(lease.lease);
          else yield* prompts.markRejected(lease.lease);
          assert.deepEqual(yield* prompts.prepare(itemRequest), {
            challengeId: item.challengeId,
            status: terminal,
          });
          assert.equal(yield* prompts.claim(item.challengeId), null);
        }
        const swapped = yield* issue;
        yield* prompts.prepare({
          token: swapped.token,
          sender,
          eventId: randomUUID(),
        });
        yield* sql`UPDATE public.channel_auth_prompt SET token_ciphertext = ${ciphertext} WHERE challenge_id = ${swapped.challengeId}`;
        assert.equal(yield* prompts.claim(swapped.challengeId), null);
        const tampered = yield* sql<{
          status: string;
          tokenCiphertext: string | null;
        }>`SELECT status, token_ciphertext AS "tokenCiphertext" FROM public.channel_auth_prompt WHERE challenge_id = ${swapped.challengeId}`;
        assert.equal(tampered[0]?.status, "failed");
        assert.equal(tampered[0].tokenCiphertext, null);
        const retained =
          yield* sql`SELECT challenge_id FROM public.channel_auth_prompt WHERE installation_id = ${installationId}
        AND status IN ('sent', 'uncertain', 'failed', 'cancelled') AND token_ciphertext IS NOT NULL`;
        assert.equal(retained.length, 0);
      } finally {
        yield* sql`DELETE FROM public.channel_auth_prompt WHERE installation_id = ${installationId}`;
        yield* sql`DELETE FROM public.channel_auth_challenge WHERE installation_id = ${installationId}`;
      }
    }).pipe(Effect.provide(live))
  );
});

test("prompt preparation delegates revoked link rejection to account preview", async () => {
  const live = ChannelAuthPrompts.layer.pipe(
    Layer.provideMerge(
      ResolvedInstallationSecrets.layerFromResolved({
        betterAuthSecret: randomBytes(32).toString("base64url"),
        secretEncryptionKey: randomBytes(32).toString("base64"),
      })
    ),
    Layer.provideMerge(
      ChannelAccounts.layer.pipe(Layer.provideMerge(runtimeDatabase))
    )
  );
  await Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const accounts = yield* ChannelAccounts;
      const prompts = yield* ChannelAuthPrompts;
      const installationId = `revoked-prompt-${randomUUID()}`;
      const sender = {
        channel: "telegram" as const,
        installationId,
        senderId: "revoked-sender",
      };
      const owner = yield* accounts.resolveVerifiedSender(sender);
      try {
        yield* sql`INSERT INTO public.channel_identity (id, channel, installation_id, sender_id, user_id, verified_at, created_at, updated_at)
        VALUES (${randomUUID()}, 'telegram', ${installationId}, 'backup', ${owner.userId}, clock_timestamp(), clock_timestamp(), clock_timestamp())`;
        yield* accounts.revokeIdentity({
          identityId: owner.id,
          userId: owner.userId,
        });
        const sessionId = randomUUID();
        yield* sql`INSERT INTO public.session (id, token, "userId", "expiresAt", "createdAt", "updatedAt")
        VALUES (${sessionId}, ${randomBytes(32).toString("base64url")}, ${owner.userId}, clock_timestamp() + interval '1 hour', clock_timestamp(), clock_timestamp())`;
        const challenge = yield* accounts.issueChallenge({
          channel: "telegram",
          installationId,
          browserSecret: randomBytes(32).toString("base64url"),
          link: { userId: owner.userId, sessionId },
        });
        yield* prompts
          .prepare({ token: challenge.token, sender, eventId: randomUUID() })
          .pipe(
            Effect.match({
              onSuccess: () =>
                assert.fail("Revoked sender must not receive a link prompt"),
              onFailure: (failure) => {
                assert.ok(failure instanceof ChannelAccountError);
                assert.equal(failure.reason, "identity_inactive");
              },
            })
          );
        const rows =
          yield* sql`SELECT challenge_id FROM public.channel_auth_prompt WHERE challenge_id = ${challenge.challengeId}`;
        assert.equal(rows.length, 0);
      } finally {
        yield* sql`DELETE FROM public.channel_auth_prompt WHERE installation_id = ${installationId}`;
        yield* sql`DELETE FROM public.channel_auth_challenge WHERE installation_id = ${installationId}`;
        yield* sql`DELETE FROM public.channel_identity WHERE installation_id = ${installationId}`;
        yield* sql`DELETE FROM workspaces WHERE id = ${accessScopeForUser(`better-auth:${owner.userId}`).workspaceId}`;
        yield* sql`DELETE FROM public."user" WHERE id = ${owner.userId}`;
      }
    }).pipe(Effect.provide(live))
  );
});
