import { scheduledRunIdentity } from "@agent/lib/schedules/identity";
import { isScheduledAgentRunLeaseActive } from "@db/services/scheduled-agent-run-leases";
import { getGatewayModel } from "@db/services/settings";
import { Effect } from "effect";
import { defineAgent, defineDynamic } from "eve";
import type { SessionAuth } from "eve/context";

import { requireChannelPrincipal } from "../server/channels/principal";
import { serverRuntime } from "../server/runtime";
import { scopeFromPrincipal } from "../shared/identity/principal-scope";
import { installationModel } from "./lib/installation-model";

interface StepStartedContext {
  readonly session: { readonly auth: SessionAuth };
}

async function assertScheduledRunLeaseActive(auth: SessionAuth) {
  const scheduledRun = scheduledRunIdentity(auth);

  if (!scheduledRun) return;

  const active = await isScheduledAgentRunLeaseActive(
    scheduledRun.runId,
    scheduledRun.leaseToken
  );

  if (!active) {
    throw new Error("The scheduled run lease is no longer active.");
  }
}

async function requireAuthenticatedCaller(auth: SessionAuth) {
  const caller = auth.current ?? auth.initiator;

  if (!caller) throw new Error("An authenticated user is required.");

  return caller;
}

async function enforceChannelPrincipalIfNeeded(
  caller: Awaited<ReturnType<typeof requireAuthenticatedCaller>>
) {
  const channel = caller.attributes.conversationChannel;
  const needsPrincipal = channel === "telegram" || channel === "kapso";

  if (!needsPrincipal) return;

  await serverRuntime.runPromise(requireChannelPrincipal(channel, caller));
}

async function resolveStepModel(auth: SessionAuth) {
  await assertScheduledRunLeaseActive(auth);
  const caller = await requireAuthenticatedCaller(auth);

  await enforceChannelPrincipalIfNeeded(caller);

  const scope = scopeFromPrincipal(caller);

  return (
    (await Effect.runPromise(installationModel)) ??
    (await getGatewayModel(scope))
  );
}

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
      "step.started": async (_event, ctx: StepStartedContext) =>
        resolveStepModel(ctx.session.auth),
    },
  }),
  reasoning: "low",
  compaction: {
    thresholdPercent: 0.7,
  },
});
