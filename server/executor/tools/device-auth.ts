import { defineDynamic, defineTool, type ToolContext } from "eve/tools";
import { always } from "eve/tools/approval";
import { Effect } from "effect";
import { z } from "zod";
import { approvalMessageSchema } from "@agent/lib/approval-message";
import { authorizeApprovalResponse } from "@agent/lib/approval-response";
import { requireChannelPrincipal } from "../../channels/principal";
import { resolveModeValue } from "@agent/lib/mode";
import { applicationOrigin } from "@shared/environment/origin";
import { NativeDeviceAuth } from "../../accounts/device";
import { serverRuntime } from "../../runtime";

async function nativeSource(context: Pick<ToolContext, "session">) {
  const current = context.session.auth.current;
  const channel = current?.attributes.conversationChannel;
  if (
    context.session.parent ||
    current?.authenticator !== "verified-channel" ||
    (channel !== "telegram" && channel !== "kapso") ||
    context.session.auth.initiator?.authenticator !== "verified-channel"
  ) {
    throw new Error(
      "Use the original private messenger conversation to sign in."
    );
  }
  const identity = await serverRuntime.runPromise(
    requireChannelPrincipal(channel, current)
  );
  return { identityId: identity.id, sessionId: context.session.id };
}

const deviceAuthStart = defineTool({
  description:
    "Create a short-lived request for this private messenger identity: login signs in a browser; link verifies its association with the account recently signed in to that browser. Choose the user’s explicit purpose; never substitute login for link. Linking refuses other-account conflicts without moving identities or data. Give the link to the user, ask them to bind their browser and return to this chat. Opening the link cannot authorize sign-in. Do not confirm until the user returns and device-auth-status shows a bound browser.",
  inputSchema: z.object({ purpose: z.enum(["login", "link"]) }),
  async execute(input, context) {
    const source = await nativeSource(context);
    const origin = applicationOrigin();
    const issued = await serverRuntime.runPromise(
      Effect.gen(function* () {
        const devices = yield* NativeDeviceAuth;
        return yield* devices.issue({
          ...source,
          callId: context.callId,
          purpose: input.purpose,
        });
      })
    );
    return {
      ...issued.challenge,
      browserUrl: issued.entryToken
        ? `${origin}/sign-in/device?id=${issued.challenge.id}&purpose=${issued.challenge.purpose}#${issued.entryToken}`
        : null,
    };
  },
});

export const deviceAuthStatus = defineTool({
  description:
    "Read login and account-link requests bound to this exact private messenger conversation. Each request includes its immutable purpose. After the user returns from the browser, read this status, then request approval for the selected challenge and exact browserBoundAt timestamp. If several requests exist, ask which browser binding they recognize.",
  inputSchema: z.object({}),
  async execute(_input, context) {
    const source = await nativeSource(context);
    return serverRuntime.runPromise(
      Effect.gen(function* () {
        const devices = yield* NativeDeviceAuth;
        return { requests: yield* devices.pending(source) };
      })
    );
  },
});

const deviceAuthConfirm = defineTool({
  approval: { request: always(), response: authorizeApprovalResponse },
  description:
    "Confirm the exact login or account-link request. For login, authorize this browser to sign in; for link, confirm the association with the same account recently signed in to the bound browser. Linking never merges accounts or moves data. Requires explicit user approval. Copy challengeId and exact browserBoundAt from device-auth-status; copy its purpose and describe that purpose and binding time in approvalMessage so the user can recognize this browser. Never treat opening a link or a previous sign-in request as approval.",
  inputSchema: z.object({
    challengeId: z.uuid(),
    purpose: z.enum(["login", "link"]),
    browserBoundAt: z.iso.datetime(),
    approvalMessage: approvalMessageSchema,
  }),
  async execute(input, context) {
    const source = await nativeSource(context);
    return serverRuntime.runPromise(
      Effect.gen(function* () {
        const devices = yield* NativeDeviceAuth;
        return yield* devices.confirm({
          ...source,
          challengeId: input.challengeId,
          purpose: input.purpose,
          browserBoundAt: input.browserBoundAt,
        });
      })
    );
  },
});

export default defineDynamic({
  events: {
    "turn.started": (_event, context) => {
      const current = context.session.auth.current;
      if (current?.authenticator !== "verified-channel") return null;
      return resolveModeValue(context, {
        interactive: {
          "device-auth-start": deviceAuthStart,
          "device-auth-status": deviceAuthStatus,
          "device-auth-confirm": deviceAuthConfirm,
        },
      });
    },
  },
});
