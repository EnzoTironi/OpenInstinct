import { accessScopeForUser } from "../../shared/identity/access-scope";
/* eslint-disable typescript/no-unsafe-type-assertion -- Synthetic callback data supplies only fields consumed by these handlers; all services remain real. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Config, Effect } from "effect";
import type { ChannelEvents } from "eve/channels";
import { test } from "vitest";
import { privateChannelEvents } from "../../agent/lib/private-channel-events";
import { channelPrincipal } from "../../server/channels/principal";
import { serverRuntime } from "../../server/runtime";
import { linkedIdentity } from "./identity-fixture";

test("terminal channel events persist once per turn and enforce current authority", async () => {
  const url = await Effect.runPromise(Config.string("DATABASE_URL"));
  assert.equal(new URL(url).pathname, "/companion_runtime_test");
  await serverRuntime.runPromise(
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const rows = yield* sql<{
        name: string;
      }>`SELECT current_database() AS name`;
      assert.equal(rows[0]?.name, "companion_runtime_test");
    })
  );
  const identity = await serverRuntime.runPromise(
    linkedIdentity({
      channel: "telegram",
      installationId: randomUUID(),
      senderId: "928374",
    })
  );
  try {
    const handlers = privateChannelEvents("telegram");
    const auth = channelPrincipal(identity);
    const sessionId = randomUUID();
    // Synthetic event/context data enters the actual handlers and database services.
    // No context operation or external service is replaced.
    // SAFETY: handlers read only session ID and auth; this fixture supplies both.
    const context = (
      current: typeof auth | null,
      initiator: typeof auth | null = auth
    ) =>
      ({
        session: { id: sessionId, auth: { current, initiator } },
      }) as Parameters<NonNullable<ChannelEvents["turn.failed"]>>[2];
    // SAFETY: all three handlers ignore their channel argument.
    const channel = undefined as Parameters<
      NonNullable<ChannelEvents["turn.failed"]>
    >[1];
    const failure = {
      turnId: randomUUID(),
      sequence: 1,
      code: "MODEL_CALL_FAILED",
      message: "synthetic-provider-secret",
      details: { token: "synthetic-private-detail" },
    };
    await Promise.all(
      Array.from({ length: 8 }, (_, sequence) =>
        handlers["turn.failed"](
          { ...failure, sequence },
          channel,
          context(auth)
        )
      )
    );
    await handlers["turn.cancelled"](
      { turnId: failure.turnId, sequence: 99 },
      channel,
      context(auth)
    );
    const cancelledTurn = randomUUID();
    await handlers["turn.cancelled"](
      { turnId: cancelledTurn, sequence: 100 },
      channel,
      context(null)
    );
    const invalid = [
      { ...auth, principalId: `better-auth:${randomUUID()}` },
      {
        ...auth,
        attributes: { ...auth.attributes, workspaceId: "wrong-workspace" },
      },
      {
        ...auth,
        attributes: { ...auth.attributes, conversationId: randomUUID() },
      },
    ];
    await Promise.all(
      invalid.map((principal) =>
        assert.rejects(async () =>
          handlers["turn.failed"](
            { ...failure, turnId: randomUUID() },
            channel,
            context(principal)
          )
        )
      )
    );
    await assert.rejects(async () =>
      handlers["turn.failed"](
        { ...failure, turnId: randomUUID() },
        channel,
        context(null, null)
      )
    );
    await serverRuntime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        yield* sql`UPDATE channel_identity SET revoked_at = clock_timestamp() WHERE id = ${identity.id}`;
      })
    );
    await assert.rejects(async () =>
      handlers["turn.cancelled"](
        { turnId: randomUUID(), sequence: 101 },
        channel,
        context(auth)
      )
    );
    await serverRuntime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        const rows = yield* sql<{
          delivery_key: string;
          payload: { text: string };
          status: string;
        }>`
        SELECT delivery_key, payload, status FROM channel_outbox WHERE identity_id = ${identity.id}
        ORDER BY delivery_key`;
        assert.deepEqual(
          rows,
          [failure.turnId, cancelledTurn]
            .map((turnId) => ({
              delivery_key: `turn-status:${sessionId}:${turnId}:0`,
              payload: {
                text: "This turn ended before completion.",
                attachments: [],
              },
              status: "queued",
            }))
            .toSorted((a, b) => a.delivery_key.localeCompare(b.delivery_key))
        );
      })
    );
  } finally {
    await serverRuntime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        yield* sql`DELETE FROM workspaces WHERE id = ${accessScopeForUser(`better-auth:${identity.userId}`).workspaceId}`;
        yield* sql`DELETE FROM public."user" WHERE id = ${identity.userId}`;
      })
    );
  }
});

test("authorization challenges persist exact public fields once and reject stale identity", async () => {
  const url = await Effect.runPromise(Config.string("DATABASE_URL"));
  assert.equal(new URL(url).pathname, "/companion_runtime_test");
  const identity = await serverRuntime.runPromise(
    linkedIdentity({
      channel: "telegram",
      installationId: randomUUID(),
      senderId: "928375",
    })
  );
  try {
    const handlers = privateChannelEvents("telegram");
    const auth = channelPrincipal(identity);
    const sessionId = randomUUID();
    // SAFETY: the actual handler reads only session.id and auth from this synthetic context.
    const callbackContext = (
      current: typeof auth | null,
      initiator: typeof auth | null = auth
    ) =>
      ({
        session: { id: sessionId, auth: { current, initiator } },
      }) as Parameters<NonNullable<ChannelEvents["authorization.required"]>>[2];
    const context = callbackContext(auth);
    // SAFETY: the handler does not read the channel argument.
    const channel = undefined as Parameters<
      NonNullable<ChannelEvents["authorization.required"]>
    >[1];
    const event = {
      attemptId: randomUUID(),
      turnId: randomUUID(),
      stepIndex: 0,
      sequence: 1,
      name: "google-workspace",
      description: "Connect to create the event.",
      authorization: {
        displayName: "Google Workspace",
        url: "https://example.com/authorize",
        instructions: "Use your linked account.",
        userCode: "TEST-CODE",
      },
      webhookUrl: "https://internal.example.com/private-callback-token",
    };
    await Promise.all(
      Array.from({ length: 8 }, (_, sequence) =>
        handlers["authorization.required"](
          { ...event, sequence },
          channel,
          context
        )
      )
    );
    await serverRuntime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        const rows = yield* sql<{
          payload: { text: string };
          status: string;
        }>`SELECT payload, status FROM channel_outbox WHERE identity_id = ${identity.id}`;
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.status, "queued");
        assert.equal(
          rows[0].payload.text,
          "Connect Google Workspace\n\nConnect to create the event.\n\nUse your linked account.\n\nCode: TEST-CODE\n\nhttps://example.com/authorize"
        );
      })
    );
    await assert.rejects(() =>
      handlers["authorization.required"](
        { ...event, description: "Changed replay" },
        channel,
        context
      )
    );
    const wrongOwner = {
      ...context,
      session: {
        ...context.session,
        auth: {
          current: { ...auth, principalId: `better-auth:${randomUUID()}` },
          initiator: auth,
        },
      },
    };
    await assert.rejects(() =>
      handlers["authorization.required"](
        { ...event, attemptId: randomUUID() },
        channel,
        wrongOwner
      )
    );
    await serverRuntime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        yield* sql`DELETE FROM workspace_memberships WHERE user_id = ${accessScopeForUser(`better-auth:${identity.userId}`).userId}`;
      })
    );
    await assert.rejects(() =>
      handlers["authorization.required"](
        { ...event, attemptId: randomUUID() },
        channel,
        context
      )
    );
    await serverRuntime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        const rows =
          yield* sql`SELECT id FROM channel_outbox WHERE identity_id = ${identity.id}`;
        assert.equal(rows.length, 1);
      })
    );
  } finally {
    await serverRuntime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        yield* sql`DELETE FROM workspaces WHERE id = ${accessScopeForUser(`better-auth:${identity.userId}`).workspaceId}`;
        yield* sql`DELETE FROM public."user" WHERE id = ${identity.userId}`;
      })
    );
  }
});
