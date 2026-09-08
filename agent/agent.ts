import { defineAgent, defineDynamic } from "eve";
import { scheduledRunIdentity } from "@agent/lib/schedules/identity";
import { isScheduledAgentRunLeaseActive } from "@db/services/scheduled-agent-run-leases";
import { getGatewayModel } from "@db/services/settings";
import { scopeFromPrincipal } from "@agent/lib/principal-scope";
import { requireChannelPrincipal } from "@agent/lib/channel-session";
import { serverRuntime } from "../server/runtime";
import { installationModel } from "./lib/installation-model";

export default defineAgent({
  experimental: {
    tasks: true,
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
          await serverRuntime.runPromise(
            requireChannelPrincipal(channel, caller)
          );
        }
        const scope = scopeFromPrincipal(caller);
        return (
          (await serverRuntime.runPromise(installationModel)) ??
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
