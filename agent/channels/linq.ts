import { resolveLinqReplyTarget } from "@agent/lib/reply-targets";
import {
  finalizeScheduledReportDelivery,
  releaseScheduledReportDelivery,
  scheduledReportFromSession,
} from "@agent/lib/schedules/report-lifecycle";
import { getAuth } from "@db/services/auth";
import { LinqAPIV3 } from "@linqapp/sdk";
import { sendMessageToolResultSchema } from "@shared/chat/message-delivery";
import { reactToMessageToolResultSchema } from "@shared/chat/reaction";
import { env } from "@shared/environment";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { normalizeAuthPhoneNumber } from "@shared/identity/phone-number";
import { connectLinqCredentials } from "@vercel/connect/eve";
import type { AdapterPostableMessage } from "chat";
import { Result, Schema, Match } from "effect";
import { vercelOidc } from "eve/channels/auth";
import {
  defaultLinqAuth,
  linqChannel,
  type LinqChannelCredentials,
} from "eve/channels/linq";
import { z } from "zod";

import { scopeFromPrincipal } from "../../shared/identity/principal-scope";
import { prepareLinqImageArtifactDelivery } from "../lib/linq-image-artifact/delivery";
import {
  extractImageArtifactMarkdownReferences,
  stripImageArtifactMarkdownReferences,
} from "../lib/linq-image-artifact/markdown";

const decodeReactToMessageToolResultSchema = Schema.decodeUnknownResult(
  reactToMessageToolResultSchema
);

const decodeSendMessageToolResultSchema = Schema.decodeUnknownResult(
  sendMessageToolResultSchema
);

const verifiedPhoneUserSchema = z.object({
  id: z.string().min(1),
  phoneNumberVerified: z.literal(true),
});

const unavailableReplyTargetSchema = z.object({
  status: z.union([z.literal(400), z.literal(404)]),
});

type LinqMessageContent = Parameters<
  LinqAPIV3["chats"]["messages"]["send"]
>[1]["message"];

const trustedForwarder = vercelOidc();

// The Linq adapter only rejects a webhook when the verifier returns `false`,
// while eve's OIDC verifier reports failure as `null`. Translate explicitly so
// an unverified forwarder can never reach message dispatch.
export const linqWebhookVerifier: NonNullable<
  LinqChannelCredentials["webhookVerifier"]
> = async (request) => (await trustedForwarder(request)) ?? false;

const credentials = (
  env.LINQ_CONNECTOR
    ? {
        ...connectLinqCredentials(env.LINQ_CONNECTOR),
        webhookVerifier: linqWebhookVerifier,
      }
    : {
        apiKey() {
          throw new Error(
            "LINQ_CONNECTOR is not configured for this deployment."
          );
        },
        webhookVerifier: () => false,
      }
) satisfies LinqChannelCredentials;

type LinqActionResultArgs = Parameters<
  NonNullable<
    NonNullable<Parameters<typeof linqChannel>[0]["events"]>["action.result"]
  >
>;

async function handleLinqReactionResult(
  reaction: (typeof reactToMessageToolResultSchema.Type)["output"],
  context: LinqActionResultArgs[1],
  session: LinqActionResultArgs[2]
) {
  if (!context.thread) {
    throw new Error(
      "react_to_message requires an active Linq conversation thread."
    );
  }

  const messageId = context.thread.toJSON().currentMessage?.id;

  if (!messageId) {
    throw new Error("react_to_message requires a current Linq message.");
  }

  const adapter = context.bot.getAdapter("linq");

  if (reaction.operation === "remove") {
    await adapter.removeReaction(context.thread.id, messageId, reaction.type);
  } else {
    await adapter.addReaction(context.thread.id, messageId, reaction.type);
  }

  await finalizeScheduledReportDelivery(session);
}

type LinqThread = NonNullable<LinqActionResultArgs[1]["thread"]>;

function linqPostHelpers(options: {
  readonly thread: LinqThread;
  readonly adapter: ReturnType<LinqActionResultArgs[1]["bot"]["getAdapter"]>;
  readonly idempotencyKey: string | undefined;
}) {
  const { thread, adapter, idempotencyKey } = options;

  const post = idempotencyKey
    ? (content: AdapterPostableMessage) =>
        adapter.postMessage(thread.id, content, { idempotencyKey })
    : (content: AdapterPostableMessage) => thread.post(content);

  const postReply = (
    content: AdapterPostableMessage,
    replyToMessageId: string
  ) => {
    if (idempotencyKey) {
      return adapter.postMessage(thread.id, content, {
        idempotencyKey,
        replyToMessageId,
      });
    }

    return adapter.postMessage(thread.id, content, {
      replyToMessageId,
    });
  };

  return { post, postReply };
}

function buildLinqLinkContent(
  url: string,
  idempotencyKey: string | undefined,
  replyToMessageId: string | undefined
): LinqMessageContent {
  const nativeMessage: LinqMessageContent = {
    parts: [{ type: "link", value: url }],
  };

  if (idempotencyKey) {
    nativeMessage.idempotency_key = idempotencyKey;
  }

  if (replyToMessageId) {
    nativeMessage.reply_to = { message_id: replyToMessageId };
  }

  return nativeMessage;
}

function isUnavailableReplyTarget(error: unknown): error is object {
  return unavailableReplyTargetSchema.safeParse(error).success;
}

async function sendLinqLinkViaClient(input: {
  readonly chatId: string;
  readonly client: LinqAPIV3;
  readonly idempotencyKey: string | undefined;
  readonly replyToMessageId: string | undefined;
  readonly url: string;
}) {
  return input.client.chats.messages.send(
    input.chatId,
    {
      message: buildLinqLinkContent(
        input.url,
        input.idempotencyKey,
        input.replyToMessageId
      ),
    },
    undefined
  );
}

function shouldRetryLinqLinkWithoutReply(
  cause: unknown,
  requestedReplyMessageId: string | undefined
) {
  return Boolean(requestedReplyMessageId && isUnavailableReplyTarget(cause));
}

function requireLinqChatId(
  thread: LinqThread,
  adapter: ReturnType<LinqActionResultArgs[1]["bot"]["getAdapter"]>
) {
  const { chatId, pendingHandle } = adapter.decodeThreadId(thread.id);

  if (pendingHandle) {
    throw new Error("A Linq reply requires an existing conversation.");
  }

  if (!chatId) {
    throw new Error("A Linq reply requires an existing conversation.");
  }

  return chatId;
}

async function retryLinqLinkWithoutReply(input: {
  readonly chatId: string;
  readonly client: LinqAPIV3;
  readonly idempotencyKey: string | undefined;
  readonly sessionId: string;
  readonly url: string;
}) {
  console.warn("[linq] reply target is unavailable", {
    sessionId: input.sessionId,
  });
  await sendLinqLinkViaClient({
    chatId: input.chatId,
    client: input.client,
    idempotencyKey: input.idempotencyKey,
    replyToMessageId: undefined,
    url: input.url,
  });
}

async function sendLinqLinkMessage(options: {
  readonly url: string;
  readonly thread: LinqThread;
  readonly adapter: ReturnType<LinqActionResultArgs[1]["bot"]["getAdapter"]>;
  readonly idempotencyKey: string | undefined;
  readonly requestedReplyMessageId: string | undefined;
  readonly sessionId: string;
}) {
  const chatId = requireLinqChatId(options.thread, options.adapter);
  const apiKey = await credentials.apiKey();
  const client = new LinqAPIV3({ apiKey });

  try {
    await sendLinqLinkViaClient({
      chatId,
      client,
      idempotencyKey: options.idempotencyKey,
      replyToMessageId: options.requestedReplyMessageId,
      url: options.url,
    });
  } catch (error) {
    if (
      !shouldRetryLinqLinkWithoutReply(error, options.requestedReplyMessageId)
    ) {
      throw error;
    }

    await retryLinqLinkWithoutReply({
      chatId,
      client,
      idempotencyKey: options.idempotencyKey,
      sessionId: options.sessionId,
      url: options.url,
    });
  }
}

type LinqOutgoingAttachments = NonNullable<
  Extract<AdapterPostableMessage, { raw: string }>["attachments"]
>;

function textWithoutCaller(requestedText: string) {
  const references = extractImageArtifactMarkdownReferences(requestedText);

  if (references.length === 0) return requestedText;

  return [
    stripImageArtifactMarkdownReferences(requestedText),
    "I couldn't attach the image.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function artifactFailureMessage(failedCount: number) {
  return Match.value(failedCount).pipe(
    Match.when(0, () => ""),
    Match.when(1, () => "I couldn't attach one image."),
    Match.orElse((count) => `I couldn't attach ${String(count)} images.`)
  );
}

function withOptionalAttachments(
  raw: string,
  attachments: LinqOutgoingAttachments | undefined
) {
  const outgoing: Extract<AdapterPostableMessage, { raw: string }> = { raw };

  if (attachments?.length) {
    outgoing.attachments = attachments;
  }

  return outgoing;
}

async function deliverLinqTextWithoutCaller(options: {
  readonly requestedText: string;
  readonly attachments: LinqOutgoingAttachments | undefined;
  readonly post: (
    content: AdapterPostableMessage
  ) => Promise<{ readonly id: string }>;
  readonly postReply: (
    content: AdapterPostableMessage,
    replyToMessageId: string
  ) => Promise<{ readonly id: string }>;
  readonly requestedReplyMessageId: string | undefined;
}) {
  await sendLinqMessage({
    outgoing: withOptionalAttachments(
      textWithoutCaller(options.requestedText),
      options.attachments
    ),
    post: options.post,
    postReply: options.postReply,
    replyToMessageId: options.requestedReplyMessageId,
  });
}

async function deliverLinqTextMessage(options: {
  readonly requestedText: string;
  readonly attachments: LinqOutgoingAttachments | undefined;
  readonly thread: LinqThread;
  readonly post: (
    content: AdapterPostableMessage
  ) => Promise<{ readonly id: string }>;
  readonly postReply: (
    content: AdapterPostableMessage,
    replyToMessageId: string
  ) => Promise<{ readonly id: string }>;
  readonly requestedReplyMessageId: string | undefined;
  readonly session: LinqActionResultArgs[2];
  readonly report: ReturnType<typeof scheduledReportFromSession>;
}) {
  const caller =
    options.session.session.auth.current ??
    options.session.session.auth.initiator;

  if (!caller) {
    await deliverLinqTextWithoutCaller(options);

    return;
  }

  const delivery = await prepareLinqImageArtifactDelivery(
    options.requestedText,
    {
      rootSessionId:
        options.report?.workerSessionId ?? options.session.session.id,
      scope: scopeFromPrincipal(caller),
    }
  );

  if (delivery.failedArtifactIds.length > 0) {
    console.warn("[linq] browser image delivery failed", {
      artifactIds: delivery.failedArtifactIds,
      sessionId: options.session.session.id,
    });
  }

  const text = [
    delivery.text,
    artifactFailureMessage(delivery.failedArtifactIds.length),
  ]
    .filter(Boolean)
    .join("\n\n");

  const outgoing = withOptionalAttachments(text, options.attachments);

  if (delivery.files.length > 0) outgoing.files = delivery.files;
  await sendLinqMessage({
    outgoing,
    post: options.post,
    postReply: options.postReply,
    replyToMessageId: options.requestedReplyMessageId,
  });
}

function replyMessageIdForThread(
  replyTarget: ReturnType<typeof resolveLinqReplyTarget>,
  threadId: string
) {
  if (replyTarget?.conversationId !== threadId) return undefined;

  return replyTarget.messageId;
}

function reportIdempotencyKey(
  report: ReturnType<typeof scheduledReportFromSession>
) {
  if (!report) return undefined;

  return `scheduled-report:${report.runId}:${String(report.sequence)}`;
}

async function deliverAttachmentOnlyLinqMessage(options: {
  readonly attachments: LinqOutgoingAttachments;
  readonly post: (
    content: AdapterPostableMessage
  ) => Promise<{ readonly id: string }>;
  readonly postReply: (
    content: AdapterPostableMessage,
    replyToMessageId: string
  ) => Promise<{ readonly id: string }>;
  readonly requestedReplyMessageId: string | undefined;
  readonly session: LinqActionResultArgs[2];
}) {
  await sendLinqMessage({
    outgoing: { attachments: options.attachments, raw: "" },
    post: options.post,
    postReply: options.postReply,
    replyToMessageId: options.requestedReplyMessageId,
  });
  await finalizeScheduledReportDelivery(options.session);
}

async function handleLinqSendMessageResult(
  message: (typeof sendMessageToolResultSchema.Type)["output"],
  context: LinqActionResultArgs[1],
  session: LinqActionResultArgs[2]
) {
  const { thread } = context;

  if (!thread) {
    throw new Error(
      "send_message requires an active Linq conversation thread."
    );
  }

  const report = scheduledReportFromSession(session);

  const replyTarget = resolveLinqReplyTarget(
    message.replyTo,
    session.session.auth
  );

  const requestedReplyMessageId = replyMessageIdForThread(
    replyTarget,
    thread.id
  );

  const idempotencyKey = reportIdempotencyKey(report);
  const adapter = context.bot.getAdapter("linq");

  if (message.kind === "link") {
    await sendLinqLinkMessage({
      url: message.url,
      thread,
      adapter,
      idempotencyKey,
      requestedReplyMessageId,
      sessionId: session.session.id,
    });
    await finalizeScheduledReportDelivery(session);

    return;
  }

  const attachments = message.attachments?.map(({ kind, ...attachment }) => ({
    ...attachment,
    type: kind,
  }));

  const { post, postReply } = linqPostHelpers({
    thread,
    adapter,
    idempotencyKey,
  });

  const { text: requestedText } = message;

  if (!requestedText) {
    if (attachments?.length) {
      await deliverAttachmentOnlyLinqMessage({
        attachments,
        post,
        postReply,
        requestedReplyMessageId,
        session,
      });

      return;
    }

    await finalizeScheduledReportDelivery(session);

    return;
  }

  await deliverLinqTextMessage({
    requestedText,
    attachments,
    thread,
    post,
    postReply,
    requestedReplyMessageId,
    session,
    report,
  });
  await finalizeScheduledReportDelivery(session);
}

export default linqChannel({
  credentials,
  events: {
    async "action.result"(event, context, session) {
      const reaction = decodeReactToMessageToolResultSchema(event.result);

      if (event.status === "completed" && Result.isSuccess(reaction)) {
        await handleLinqReactionResult(
          reaction.success.output,
          context,
          session
        );

        return;
      }

      const message = decodeSendMessageToolResultSchema(event.result);

      if (event.status === "completed" && Result.isSuccess(message)) {
        await handleLinqSendMessageResult(
          message.success.output,
          context,
          session
        );
      }
    },
    async "message.completed"(event, _context, session) {
      if (event.finishReason === "tool-calls") return;
      const report = scheduledReportFromSession(session);

      if (report) {
        await finalizeScheduledReportDelivery(session, "suppressed");
      }
    },
    async "session.completed"(_event, _context, session) {
      const report = scheduledReportFromSession(session);

      if (report) {
        await finalizeScheduledReportDelivery(session, "suppressed");
      }
    },
    async "turn.cancelled"(_event, _context, session) {
      await releaseScheduledReportDelivery(
        session,
        "Scheduled result reporting was cancelled."
      );
    },
    async "turn.failed"(event, _context, session) {
      await releaseScheduledReportDelivery(session, event.message);
    },
  },
  async onMessage(context, message) {
    if (message.author.isBot) return null;

    const auth = defaultLinqAuth(message);
    const authorUserName = z.string().safeParse(message.author.userName);

    const phoneNumber = authorUserName.success
      ? normalizeAuthPhoneNumber(authorUserName.data)
      : undefined;

    const verifiedUserId = phoneNumber
      ? await findVerifiedAuthUserIdByPhoneNumber(phoneNumber)
      : undefined;

    if (!verifiedUserId || !phoneNumber) {
      // Phone possession is the only sign-in factor, so a handle that is not
      // linked to a verified user is unauthenticated: never mint a principal
      // or a workspace for it.
      console.warn("[linq] ignoring message from an unlinked handle", {
        threadId: context.thread.id,
      });

      return null;
    }

    const principalId = `better-auth:${verifiedUserId}`;
    const scope = accessScopeForUser(principalId);

    return {
      auth: {
        ...auth,
        attributes: {
          ...auth.attributes,
          conversationChannel: "linq",
          conversationId: context.thread.id,
          linqThreadId: context.thread.id,
          linqMessageId: message.id,
          phoneNumber,
          workspaceId: scope.workspaceId,
        },
        principalId,
      },
    };
  },
});

async function sendLinqMessage({
  outgoing,
  post,
  postReply,
  replyToMessageId,
}: {
  readonly outgoing: Extract<AdapterPostableMessage, { raw: string }>;
  readonly post: (
    content: AdapterPostableMessage
  ) => Promise<{ readonly id: string }>;
  readonly postReply: (
    content: AdapterPostableMessage,
    replyToMessageId: string
  ) => Promise<{ readonly id: string }>;
  readonly replyToMessageId?: string;
}) {
  if (!replyToMessageId) {
    await post(outgoing);

    return;
  }

  try {
    await postReply(outgoing, replyToMessageId);

    return;
  } catch (error) {
    if (!unavailableReplyTargetSchema.safeParse(error).success) throw error;
    console.warn("[linq] reply target is unavailable", {
      replyToMessageId,
    });
    await post(outgoing);
  }
}

async function findVerifiedAuthUserIdByPhoneNumber(phoneNumber: string) {
  const auth = await getAuth();
  const context = await auth.$context;

  const user = await context.adapter.findOne({
    model: "user",
    where: [{ field: "phoneNumber", value: phoneNumber }],
  });

  const parsed = verifiedPhoneUserSchema.safeParse(user);

  return parsed.success ? parsed.data.id : undefined;
}
