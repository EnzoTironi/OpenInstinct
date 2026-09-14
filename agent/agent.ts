import { defineAgent, defineDynamic } from "eve";
import { Effect } from "effect";
import { scheduledRunIdentity } from "@agent/lib/schedules/identity";
import { isScheduledAgentRunLeaseActive } from "@db/services/scheduled-agent-run-leases";
import { getGatewayModel } from "@db/services/settings";
import { scopeFromPrincipal } from "../shared/identity/principal-scope";
import { requireChannelPrincipal } from "../server/channels/principal";
import { serverRuntime } from "../server/runtime";
import { workspaceActorFromPrincipal } from "../server/workspaces/access";
import { installationModel } from "./lib/installation-model";
import { workspaceModel } from "./lib/workspace-model";

export default defineAgent({
  experimental: {
    // 0.52 public compiler only allows instrumentationProviders + workflow.
    // Native task tools remain the framework default; Companion recovery still
    // overlays taskReport / cohortId on session context.
    workflow: {
      world: "@workflow/world-postgres",
    },
  },
  model: defineDynamic({
    events: {
      "step.started": async (_event, ctx) => {
        const scheduledRun = scheduledRunIdentity(ctx.session.auth);
        if (
          scheduledRun &&
          !(await isScheduledAgentRunLeaseActive(
            scheduledRun.runId,
            scheduledRun.leaseToken
          ))
        ) {
          throw new Error("The scheduled run lease is no longer active.");
        }
        const caller = ctx.session.auth.current ?? ctx.session.auth.initiator;
        if (!caller) throw new Error("An authenticated user is required.");
        const channel = caller.attributes.conversationChannel;
        if (channel === "telegram" || channel === "kapso") {
          const identity = await serverRuntime.runPromise(
            requireChannelPrincipal(channel, caller)
          );
          if (
            caller.attributes.conversationId !== identity.id &&
            !caller.attributes.groupBindingId
          ) {
            // A verified group can converse using the installation's model.
            // Reading a member's private model settings would grant extra scope.
            const model = await Effect.runPromise(installationModel);
            if (!model)
              throw new Error(
                "A model must be configured for group conversations."
              );
            return model;
          }
        }
        const actor =
          caller.authenticator === "authjs" ||
          caller.authenticator === "verified-channel" ||
          caller.authenticator === "a2a" ||
          caller.authenticator === "matrix" ||
          caller.authenticator === "scheduled-worker"
            ? await serverRuntime.runPromise(
                workspaceActorFromPrincipal(caller)
              )
            : undefined;
        const scope =
          caller.authenticator === "a2a" || caller.attributes.groupBindingId
            ? await serverRuntime.runPromise(
                workspaceActorFromPrincipal(caller)
              )
            : scopeFromPrincipal(caller);
        return (
          (actor
            ? await serverRuntime.runPromise(workspaceModel(actor))
            : null) ??
          (await Effect.runPromise(installationModel)) ??
          (await getGatewayModel(scope))
        );
      },
    },
  }),
  reasoning: "low",
  compaction: {
    thresholdPercent: 0.7,
  },
});
