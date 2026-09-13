import { headers } from "next/headers";
import { cache } from "react";
import { getAuthSession } from "@db/services/auth/session";
import { serverRuntime } from "../../server/runtime";
import { resolveWorkspaceActor } from "../../server/workspaces/session";
import {
  accessScopeForUser,
  type AccessScope,
} from "@shared/identity/access-scope";

export const requireRequestScope = cache(async (): Promise<AccessScope> => {
  const session = await getAuthSession(await headers());
  if (!session) throw new UnauthenticatedError();
  const requestHeaders = await headers();
  if (!requestHeaders.has("x-zoen-workspace"))
    return accessScopeForUser(`better-auth:${session.user.id}`);
  const actor = await serverRuntime.runPromise(
    resolveWorkspaceActor(requestHeaders)
  );
  return { userId: actor.userId, workspaceId: actor.workspaceId };
});

export class UnauthenticatedError extends Error {
  constructor() {
    super("Sign in to continue.");
    this.name = "UnauthenticatedError";
  }
}
