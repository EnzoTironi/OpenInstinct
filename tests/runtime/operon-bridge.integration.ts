import { randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Effect } from "effect";
import type { ToolContext } from "eve/tools";
import { expect, test } from "vitest";
import { ChannelAccounts } from "../../server/accounts";
import { channelPrincipal } from "../../server/channels/principal";
import {
  searchEmail,
  syncEmail,
} from "../../server/operon/email-flow";
import { operonClientLayer } from "../../server/operon/mcp-client";
import {
  assertOperonConfirm,
  readCompanionSessionToken,
} from "../../server/operon/principal";
import { serverRuntime } from "../../server/runtime";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { runtimeDatabase } from "./database";

test("the PostgreSQL bridge checks the native owner, exact confirmation and revocation", async () => {
  await Effect.runPromise(Effect.void.pipe(Effect.provide(runtimeDatabase)));
  const accounts = await serverRuntime.runPromise(ChannelAccounts);
  const identity = await serverRuntime.runPromise(
    accounts.resolveVerifiedSender({
      channel: "telegram",
      installationId: randomUUID(),
      senderId: randomUUID(),
    })
  );
  const principal = channelPrincipal(identity);
  const scope = accessScopeForUser(principal.principalId);
  const sessionId = randomUUID();
  const context: Pick<ToolContext, "session"> = {
    session: {
      id: sessionId,
      auth: { current: principal, initiator: principal },
      turn: { id: randomUUID(), sequence: 1 },
    },
  };
  try {
    await serverRuntime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        yield* sql`INSERT INTO agent_sessions (session_id, workspace_id, created_by_user_id) VALUES (${sessionId}, ${scope.workspaceId}, ${scope.userId})`;
      })
    );
    const bound = await serverRuntime.runPromise(
      readCompanionSessionToken(context)
    );
    expect(bound.scope).toEqual(scope);
    expect(bound.sessionToken.length).toBeGreaterThan(0);
    const snapshot = {
      ownerEmail: "pilot@example.test",
      messages: [
        {
          from: { displayName: "Ana", email: "ana@example.test" },
          to: [{ displayName: "Pilot", email: "pilot@example.test" }],
          cc: [],
          messageId: randomUUID(),
          threadId: randomUUID(),
          dateMs: Date.now(),
        },
      ],
    };
    const result = await serverRuntime.runPromise(
      syncEmail(snapshot).pipe(
        Effect.provide(
          operonClientLayer({
            scope: bound.scope,
            role: "builder",
            sessionToken: bound.sessionToken,
            confirm: true,
          })
        )
      )
    );
    await Promise.all(
      ["Bia", "Caio"].map((name) =>
        serverRuntime.runPromise(
          syncEmail({
            ...snapshot,
            messages: snapshot.messages.map((message) =>
              Object.assign({}, message, {
                messageId: randomUUID(),
                from: {
                  displayName: name,
                  email: `${name.toLowerCase()}@example.test`,
                },
              })
            ),
          }).pipe(
            Effect.provide(
              operonClientLayer({
                scope: bound.scope,
                role: "builder",
                sessionToken: bound.sessionToken,
                confirm: true,
              })
            )
          )
        )
      )
    );
    const concurrentHits = await Promise.all(
      ["Bia", "Caio"].map((name) =>
        serverRuntime.runPromise(
          searchEmail(name).pipe(
            Effect.provide(
              operonClientLayer({
                scope: bound.scope,
                role: "consumer",
                sessionToken: bound.sessionToken,
              })
            )
          )
        )
      )
    );
    expect(concurrentHits.map((hits) => hits.length)).toEqual([1, 1]);
    const pending = {
      workspaceId: scope.workspaceId,
      sessionId,
      proposalId: result.proposalId,
      digest: result.digest,
      card: result.card,
    };
    const wrong = await serverRuntime.runPromise(
      assertOperonConfirm(
        context,
        { ...pending, proposalId: randomUUID() },
        randomUUID().replaceAll("-", "")
      ).pipe(Effect.flip)
    );
    expect(wrong).toMatchObject({ reason: "wrong_proposal" });
    const confirmed = await serverRuntime.runPromise(
      assertOperonConfirm(context, pending, pending.digest)
    );
    expect(confirmed.sessionToken).toBe(bound.sessionToken);
    expect(
      await serverRuntime.runPromise(
        searchEmail("Ana").pipe(
          Effect.provide(
            operonClientLayer({
              scope: accessScopeForUser(`better-auth:${randomUUID()}`),
              role: "consumer",
              sessionToken: bound.sessionToken,
            })
          )
        )
      )
    ).toEqual([]);
    await serverRuntime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        yield* sql`UPDATE channel_identity SET revoked_at = clock_timestamp() WHERE id = ${identity.id}`;
      })
    );
    const revoked = await serverRuntime.runPromise(
      assertOperonConfirm(context, pending, pending.digest).pipe(Effect.flip)
    );
    expect(revoked).toMatchObject({
      _tag: "PersonalMemoryError",
      reason: "unauthenticated",
    });
  } finally {
    await serverRuntime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        yield* sql`DELETE FROM operon_workspace_state WHERE workspace_id = ${scope.workspaceId}`;
        yield* sql`DELETE FROM agent_sessions WHERE session_id = ${sessionId}`;
        yield* sql`DELETE FROM public.session WHERE "userId" = ${identity.userId}`;
        yield* sql`DELETE FROM channel_identity WHERE id = ${identity.id}`;
      })
    );
  }
}, 30_000);
