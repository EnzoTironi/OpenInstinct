import { isSessionOwned } from "@db/services/sessions";
import type {
  ApprovalResponseContext,
  ApprovalResponseDecision,
} from "eve/tools/approval";

import { requireChannelPrincipal } from "../../server/channels/principal";
import { serverRuntime } from "../../server/runtime";
import { scopeFromPrincipal } from "../../shared/identity/principal-scope";

function rejectApproval(reason: string): ApprovalResponseDecision {
  return { status: "rejected", reason };
}

function isSessionOwner(
  responder: ApprovalResponseContext["responder"],
  initiator: ApprovalResponseContext["session"]["initiator"]
) {
  return (
    responder.principalType === "user" &&
    Boolean(initiator) &&
    responder.principalId === initiator.principalId
  );
}

async function assertChannelResponder(
  responder: ApprovalResponseContext["responder"],
  initiator: NonNullable<ApprovalResponseContext["session"]["initiator"]>
): Promise<ApprovalResponseDecision | undefined> {
  const channel = initiator.attributes.conversationChannel;

  if (channel !== "telegram" && channel !== "kapso") {
    return undefined;
  }

  if (
    responder.attributes.channelIdentityId !==
    initiator.attributes.channelIdentityId
  ) {
    return rejectApproval("Respond through the original private channel.");
  }

  await serverRuntime.runPromise(requireChannelPrincipal(channel, responder));

  return undefined;
}

export async function authorizeApprovalResponse(context: {
  responder: ApprovalResponseContext["responder"];
  session: Pick<ApprovalResponseContext["session"], "id" | "initiator">;
}): Promise<ApprovalResponseDecision> {
  const { responder, session } = context;
  const initiator = session.initiator;

  if (!isSessionOwner(responder, initiator) || !initiator) {
    return rejectApproval("Only the session owner can approve this action.");
  }

  const channelRejection = await assertChannelResponder(responder, initiator);

  if (channelRejection) {
    return channelRejection;
  }

  if (!(await isSessionOwned(scopeFromPrincipal(responder), session.id))) {
    return rejectApproval("This session does not belong to the responder.");
  }

  return { status: "allowed" };
}
