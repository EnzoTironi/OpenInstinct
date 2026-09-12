import { randomBytes, randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";
import type { ToolContext } from "eve/tools";
import type { AccessScope } from "@shared/identity/access-scope";
import { admitPersonalMemoryFromSession } from "../personal-memory/group-memory-policy";
import { authorizePersonalMemoryPrincipal } from "../personal-memory/principal";

class OperonPrincipalError extends Schema.TaggedError<OperonPrincipalError>()(
  "OperonPrincipalError",
  {
    reason: Schema.Literals(["unauthenticated", "wrong_proposal"]),
  }
) {}

export interface CompanionOperonBinding {
  readonly scope: AccessScope;
  readonly sessionToken: string;
}

export const authorizeOperonSession = Effect.fn("authorizeOperonSession")(
  function* (context: Pick<ToolContext, "session">) {
    yield* admitPersonalMemoryFromSession(context.session.auth.current);
    const scope = yield* authorizePersonalMemoryPrincipal(
      context.session.auth.current
    );
    const sql = yield* PgClient.PgClient;
    const sessions =
      yield* sql`SELECT session_id FROM agent_sessions WHERE session_id = ${context.session.id}
    AND workspace_id = ${scope.workspaceId} AND created_by_user_id = ${scope.userId}`;
    if (sessions.length !== 1)
      return yield* new OperonPrincipalError({ reason: "unauthenticated" });
    return scope;
  }
);

function betterAuthUserId(scope: AccessScope) {
  return scope.userId.replace(/^better-auth:/u, "");
}

function sessionTokenOf(
  row: unknown
): Effect.Effect<string, OperonPrincipalError> {
  return Schema.decodeUnknownEffect(
    Schema.Struct({ token: Schema.NonEmptyString })
  )(row).pipe(
    Effect.map((value) => value.token),
    Effect.mapError(
      () => new OperonPrincipalError({ reason: "unauthenticated" })
    )
  );
}

/**
 * Companion Better Auth session.token for ApproverBinding.
 *
 * Context: Operon MCP stdio receives this token as OPERON_APPROVER_SESSION_TOKEN.
 * Inputs: Eve tool context after the human is bound to a workspace.
 * Outputs: workspace scope plus the live Better Auth session.token.
 * Side effects: may insert a session row in Companion's existing user/session tables.
 * Does not call `operon approver session` and does not start a second Better Auth.
 */
export const readCompanionSessionToken = Effect.fn(
  "readCompanionSessionToken"
)(function* (context: Pick<ToolContext, "session">) {
  const scope = yield* authorizeOperonSession(context);
  const sql = yield* PgClient.PgClient;
  const userId = betterAuthUserId(scope);
  const authSessionId = context.session.auth.current?.attributes.authSessionId;
  const keyed =
    typeof authSessionId === "string" && authSessionId.length > 0
      ? yield* sql`SELECT token FROM public.session WHERE id = ${authSessionId}
        AND "userId" = ${userId} AND "expiresAt" > clock_timestamp()`
      : [];
  const rows =
    keyed.length === 1
      ? keyed
      : yield* sql`SELECT token FROM public.session WHERE "userId" = ${userId}
        AND "expiresAt" > clock_timestamp() ORDER BY "createdAt" DESC LIMIT 1`;
  if (rows[0] !== undefined) {
    return {
      scope,
      sessionToken: yield* sessionTokenOf(rows[0]),
    } satisfies CompanionOperonBinding;
  }
  const sessionId = randomUUID();
  const sessionToken = randomBytes(32).toString("base64url");
  yield* sql`INSERT INTO public.session
    (id, token, "userId", "expiresAt", "createdAt", "updatedAt")
    VALUES (${sessionId}, ${sessionToken}, ${userId},
      clock_timestamp() + interval '7 days', clock_timestamp(), clock_timestamp())`;
  return { scope, sessionToken } satisfies CompanionOperonBinding;
});

/** Called only inside Eve's approved tool execution. Digest TOCTOU, not a Principal. */
export const assertOperonConfirm = Effect.fn("assertOperonConfirm")(
  function* (
    context: Pick<ToolContext, "session">,
    pending: {
      readonly workspaceId: string;
      readonly sessionId: string;
      readonly proposalId: string;
      readonly digest: string;
    },
    viewedDigest: string
  ) {
    if (
      context.session.id !== pending.sessionId ||
      viewedDigest !== pending.digest
    ) {
      return yield* new OperonPrincipalError({ reason: "wrong_proposal" });
    }
    const bound = yield* readCompanionSessionToken(context);
    if (bound.scope.workspaceId !== pending.workspaceId)
      return yield* new OperonPrincipalError({ reason: "wrong_proposal" });
    return bound;
  }
);
