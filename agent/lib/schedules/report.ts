import {
  claimScheduledReport,
  finalizeScheduledReport,
  releaseScheduledReport,
} from "@db/services/scheduled-agent-jobs";
import type { AttachSessionFn } from "eve/channels";
import type { ScheduleToFn } from "eve/schedules";

import { serverRuntime } from "../../../server/runtime";
import { deliverNativeScheduledReport } from "../../../server/schedules/native-report";
import type { scheduledConversationChannelSchema } from "../../../shared/schedules/conversation";
import linq from "../../channels/linq";

type ClaimedScheduledReport = NonNullable<
  Awaited<ReturnType<typeof claimScheduledReport>>
>;

interface ReportDelivery {
  readonly attachSession?: AttachSessionFn;
  readonly to: ScheduleToFn;
}

function isNativeScheduledChannel(
  channel: typeof scheduledConversationChannelSchema.Type
) {
  return channel === "telegram" || channel === "kapso";
}

function releaseErrorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

async function deliverLinqScheduledReport(
  delivery: ReportDelivery,
  claimed: ClaimedScheduledReport,
  leaseToken: string,
  prompt: string
) {
  const attributes = scheduledReportAttributes(claimed, leaseToken);

  const session = await delivery
    .to(linq, {
      adapterName: "linq",
      threadId: claimed.job.conversationId,
    })
    .send(prompt, {
      auth: {
        attributes,
        authenticator: "scheduled-result",
        issuer: "open-instinct",
        principalId: claimed.job.createdByUserId,
        principalType: "user" as const,
      },
      turnPolicy: "queue" as const,
    });

  console.info("[scheduled-run] report session accepted", {
    channel: claimed.job.conversationChannel,
    reportSequence: claimed.run.reportSequence,
    runId: claimed.run.id,
    sessionId: session.id,
  });
}

async function deliverEveScheduledReport(
  delivery: ReportDelivery,
  claimed: ClaimedScheduledReport,
  leaseToken: string,
  prompt: string
) {
  if (!delivery.attachSession) {
    throw new Error("Eve debug reports require an active session handle.");
  }

  const attributes = scheduledReportAttributes(claimed, leaseToken);

  const result = await delivery
    .attachSession(claimed.job.conversationId)
    .send(prompt, {
      auth: {
        attributes,
        authenticator: "scheduled-result",
        issuer: "open-instinct",
        principalId: claimed.job.createdByUserId,
        principalType: "user" as const,
      },
      turnPolicy: "queue" as const,
    });

  if (result.status === "session_not_active") {
    await finalizeScheduledReport(claimed.run.id, leaseToken, "suppressed");
  }

  console.info("[scheduled-run] report turn accepted", {
    channel: claimed.job.conversationChannel,
    reportSequence: claimed.run.reportSequence,
    resultStatus: result.status,
    runId: claimed.run.id,
  });
}

async function deliverClaimedScheduledReport(
  delivery: ReportDelivery,
  claimed: ClaimedScheduledReport,
  leaseToken: string
) {
  console.info("[scheduled-run] dispatching report", {
    channel: claimed.job.conversationChannel,
    reportSequence: claimed.run.reportSequence,
    runId: claimed.run.id,
    runStatus: claimed.run.status,
  });

  const prompt = scheduledReportPrompt(claimed);

  if (claimed.job.conversationChannel === "linq") {
    await deliverLinqScheduledReport(delivery, claimed, leaseToken, prompt);

    return;
  }

  await deliverEveScheduledReport(delivery, claimed, leaseToken, prompt);
}

async function releaseFailedScheduledReport(
  claimed: ClaimedScheduledReport,
  leaseToken: string,
  cause: unknown
) {
  const released = await releaseScheduledReport(
    claimed.run.id,
    leaseToken,
    releaseErrorMessage(cause)
  );

  console.warn("[scheduled-run] report dispatch failed", {
    cause,
    released,
    reportSequence: claimed.run.reportSequence,
    runId: claimed.run.id,
  });
}

export async function dispatchScheduledReport(
  delivery: ReportDelivery,
  runId: string,
  conversationChannel: typeof scheduledConversationChannelSchema.Type
) {
  if (isNativeScheduledChannel(conversationChannel)) {
    await serverRuntime.runPromise(deliverNativeScheduledReport(runId));

    return;
  }

  const claimed = await claimScheduledReport(runId);
  const leaseToken = claimed?.run.reportLeaseToken;

  if (!claimed || !leaseToken) return;

  try {
    await deliverClaimedScheduledReport(delivery, claimed, leaseToken);
  } catch (error) {
    await releaseFailedScheduledReport(claimed, leaseToken, error);
  }
}

function scheduledReportPrompt(claimed: ClaimedScheduledReport) {
  const replyContext = claimed.job.replyAnchorMessageId
    ? `Reply handle: {"kind":"automation","id":"${claimed.job.id}"}. Pass this exact value as send_message.replyTo for every user-visible message about this scheduled task. Omit replyTo only when the message is genuinely unrelated to the scheduled task.`
    : "No reply handle is available for this automation. Omit send_message.replyTo.";

  if (claimed.run.pendingInputRequests) {
    return [
      "A background scheduled run is waiting for the user before it can continue.",
      `Original task: ${claimed.job.prompt}`,
      `Scheduled for: ${claimed.run.scheduledFor.toISOString()}`,
      replyContext,
      `Internal run ID: ${claimed.run.id}`,
      `Pending request: ${JSON.stringify(claimed.run.pendingInputRequests)}`,
      "First check whether the existing conversation clearly answers the request. If it does, call schedules-answer now. Otherwise ask the user clearly, keeping the internal run ID out of the user-visible message so schedules-answer can resume this run after they reply.",
    ].join("\n\n");
  }

  if (!claimed.run.outcome) {
    throw new Error("A completed scheduled run requires an outcome.");
  }

  return [
    "A background scheduled run has completed.",
    `Original task: ${claimed.job.prompt}`,
    `Scheduled for: ${claimed.run.scheduledFor.toISOString()}`,
    replyContext,
    `Worker outcome: ${JSON.stringify(claimed.run.outcome)}`,
  ].join("\n\n");
}

function scheduledReportAttributes(
  claimed: ClaimedScheduledReport,
  leaseToken: string
) {
  const attributes = new Map<string, string>([
    ["conversationChannel", claimed.job.conversationChannel],
    ["conversationId", claimed.job.conversationId],
    ["scheduleId", claimed.job.id],
    ["scheduledReportLeaseToken", leaseToken],
    ["scheduledReportSequence", String(claimed.run.reportSequence)],
    ["scheduledRunId", claimed.run.id],
    ["workspaceId", claimed.job.workspaceId],
  ]);

  if (
    claimed.job.conversationChannel === "linq" &&
    claimed.job.replyAnchorMessageId
  ) {
    attributes.set(
      "linqReplyAnchorMessageId",
      claimed.job.replyAnchorMessageId
    );
  }

  if (claimed.run.workerSessionId) {
    attributes.set("scheduledRunSessionId", claimed.run.workerSessionId);
  }

  return Object.fromEntries(attributes);
}
