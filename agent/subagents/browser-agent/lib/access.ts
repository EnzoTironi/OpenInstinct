import type { SessionContext } from "eve/context";
import { isSessionOwned } from "@db/services/sessions";
import { scopeFromPrincipal } from "../../../../shared/identity/principal-scope";
import { assertLiveWorkerAuthority } from "./live-authority";

export async function requireWorkerScope(context: {
  readonly session: Pick<SessionContext["session"], "id" | "auth" | "parent">;
}) {
  const parent = context.session.parent;
  if (!parent) throw new Error("Browser tools require a delegated worker.");

  const caller = context.session.auth.current ?? context.session.auth.initiator;
  if (!caller) throw new Error("An authenticated user is required.");
  const scope = scopeFromPrincipal(caller);
  const [ownsWorker, ownsParent] = await Promise.all([
    isSessionOwned(scope, context.session.id),
    isSessionOwned(scope, parent.rootSessionId),
  ]);
  if (!ownsWorker || !ownsParent) {
    throw new Error("The authenticated user does not own this worker session.");
  }
  await assertLiveWorkerAuthority(caller);
  return scope;
}
