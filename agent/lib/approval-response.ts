import type {
  ApprovalResponseContext,
  ApprovalResponseDecision,
} from "eve/tools/approval";
import { isSessionOwned } from "@db/services/sessions";
import { scopeFromPrincipal } from "../../shared/identity/principal-scope";
import { requireChannelPrincipal } from "../../server/channels/principal";
import { serverRuntime } from "../../server/runtime";

export async function authorizeApprovalResponse(context: {
  responder: ApprovalResponseContext["responder"];
  session: Pick<ApprovalResponseContext["session"], "id" | "initiator">;
}): Promise<ApprovalResponseDecision> {
  const { responder, session } = context;
  if (
    responder.principalType !== "user" ||
    responder.principalId !== session.initiator?.principalId
  ) {
    return {
      status: "rejected",
      reason: "Only the session owner can approve this action.",
    };
  }
  const channel = session.initiator.attributes.conversationChannel;
  if (channel === "telegram" || channel === "kapso") {
    if (
      responder.attributes.channelIdentityId !==
      session.initiator.attributes.channelIdentityId
    ) {
      return {
        status: "rejected",
        reason: "Respond through the original private channel.",
      };
    }
    await serverRuntime.runPromise(requireChannelPrincipal(channel, responder));
  }
  if (!(await isSessionOwned(scopeFromPrincipal(responder), session.id))) {
    return {
      status: "rejected",
      reason: "This session does not belong to the responder.",
    };
  }
  return { status: "allowed" };
}
