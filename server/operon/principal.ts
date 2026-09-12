import { PgClient } from "@effect/sql-pg";
import { Clock, Effect, Schema } from "effect";
import type { ToolContext } from "eve/tools";
import { admitPersonalMemoryFromSession } from "../personal-memory/group-memory-policy";
import { authorizePersonalMemoryPrincipal } from "../personal-memory/principal";
import type { OperonApprovalRequest } from "./mcp-client";

class OperonPrincipalError extends Schema.TaggedError<OperonPrincipalError>()(
  "OperonPrincipalError",
  {
    reason: Schema.Literals(["unauthenticated", "wrong_proposal"]),
  }
) {}

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

/** Called only inside Eve's approved tool execution, once again for each kernel review. */
export const verifyOperonApproval = Effect.fn("verifyOperonApproval")(
  function* (
    context: Pick<ToolContext, "session">,
    pending: {
      readonly workspaceId: string;
      readonly sessionId: string;
      readonly proposalId: string;
      readonly digest: string;
    },
    request: OperonApprovalRequest
  ) {
    if (
      context.session.id !== pending.sessionId ||
      request.tool !== "operon_review_mapping_proposal" ||
      request.arguments.proposalId !== pending.proposalId ||
      request.arguments.viewedDigest !== pending.digest ||
      request.arguments.verdict !== "approve"
    ) {
      return yield* new OperonPrincipalError({ reason: "wrong_proposal" });
    }
    const scope = yield* authorizeOperonSession(context);
    if (scope.workspaceId !== pending.workspaceId)
      return yield* new OperonPrincipalError({ reason: "wrong_proposal" });
    const sql = yield* PgClient.PgClient;
    const rows = yield* sql`SELECT u.name, u.email, m.role FROM public."user" u
    JOIN workspace_memberships m ON m.user_id = ('better-auth:' || u.id)
    WHERE m.workspace_id = ${scope.workspaceId} AND m.user_id = ${scope.userId}`;
    const row = yield* Schema.decodeUnknownEffect(
      Schema.Struct({
        name: Schema.NonEmptyString,
        email: Schema.NonEmptyString,
        role: Schema.Literals(["owner", "admin", "member"]),
      })
    )(rows[0]).pipe(
      Effect.mapError(
        () => new OperonPrincipalError({ reason: "unauthenticated" })
      )
    );
    return {
      userId: scope.userId,
      name: row.name,
      email: row.email,
      roles: [row.role],
      sessionId: context.session.id,
      issuer: "zoen",
      sessionExpiresAt: (yield* Clock.currentTimeMillis) + 30_000,
    };
  }
);
