import { defineHook, type HookContext } from "eve/hooks";
import { saveChat } from "@db/services/chats";
import { ensureScope } from "@db/services/scope";
import { claimSession } from "@db/services/sessions";
import {
  isSharedPrincipal,
  scopeFromPrincipal,
} from "../../shared/identity/principal-scope";
import { serverRuntime } from "../../server/runtime";
import { workspaceActorFromPrincipal } from "../../server/workspaces/access";
import { bindProtocolSession } from "../../server/a2a/tasks";
import { Effect, Schema } from "effect";

export default defineHook({
  events: {
    async "session.started"(_event, ctx) {
      await claimOwnedSession(ctx);
    },
    async "message.received"(_event, ctx) {
      const scope = await claimOwnedSession(ctx);
      if (!scope) return;

      await saveChat(scope, {
        channel: ctx.channel.kind,
        sessionId: ctx.session.id,
      });
    },
  },
});

async function claimOwnedSession(ctx: HookContext) {
  const initiator = ctx.session.auth.initiator;
  if (!initiator) return undefined;

  // Native group history belongs to its channel address, never to the sender's
  // private chat list. Bound workspace groups use their explicit grant below.
  if (
    initiator.authenticator === "verified-channel" &&
    isSharedPrincipal(initiator) &&
    !initiator.attributes.groupBindingId
  )
    return undefined;

  const scope =
    initiator.authenticator === "a2a" || initiator.attributes.groupBindingId
      ? await serverRuntime.runPromise(workspaceActorFromPrincipal(initiator))
      : scopeFromPrincipal(initiator);
  await ensureScope(scope);
  await claimSession(scope, ctx.session.id);
  if (
    initiator.authenticator === "a2a" &&
    Schema.is(Schema.String)(initiator.attributes.protocolTaskId)
  ) {
    const taskId = initiator.attributes.protocolTaskId;
    await serverRuntime.runPromise(
      Effect.gen(function* () {
        const actor = yield* workspaceActorFromPrincipal(initiator);
        yield* bindProtocolSession(actor, taskId, ctx.session.id);
      })
    );
  }
  return scope;
}
