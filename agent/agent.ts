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
        if (
          caller.authenticator === "authjs" ||
          caller.authenticator === "verified-channel"
        ) {
          await serverRuntime.runPromise(workspaceActorFromPrincipal(caller));
        }
        const channel = caller.attributes.conversationChannel;
        if (channel === "telegram" || channel === "kapso") {
          await serverRuntime.runPromise(
            requireChannelPrincipal(channel, caller)
          );
        }
        const scope = scopeFromPrincipal(caller);
        return (
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
