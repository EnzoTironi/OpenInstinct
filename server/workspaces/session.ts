import { Effect } from "effect";
import { readAuthSession } from "@db/services/auth/session";
import { ensureScope } from "@db/services/scope";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { requireWorkspaceAccess, WorkspaceAccessDenied } from "./access";

export const resolveWorkspaceActor = Effect.fn("resolveWorkspaceActor")(
  function* (headers: Headers) {
    const session = yield* readAuthSession(headers);
    if (!session) return yield* new WorkspaceAccessDenied();
    const personal = accessScopeForUser(`better-auth:${session.user.id}`);
    yield* Effect.tryPromise({
      try: () => ensureScope(personal),
      catch: () => new WorkspaceAccessDenied(),
    });
    return yield* requireWorkspaceAccess({
      userId: personal.userId,
      workspaceId: headers.get("x-zoen-workspace") ?? personal.workspaceId,
      authSessionId: session.session.id,
    });
  }
);
