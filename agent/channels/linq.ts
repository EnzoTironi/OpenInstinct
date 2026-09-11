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

async function sendLinqLinkMessage(options: {
  readonly url: string;
  readonly thread: LinqThread;
  readonly adapter: ReturnType<LinqActionResultArgs[1]["bot"]["getAdapter"]>;
  readonly idempotencyKey: string | undefined;
  readonly requestedReplyMessageId: string | undefined;
  readonly sessionId: string;
}) {
  const { chatId, pendingHandle } = options.adapter.decodeThreadId(
    options.thread.id
  );

  if (pendingHandle || !chatId) {
    throw new Error("A Linq reply requires an existing conversation.");
  }

  const apiKey = await credentials.apiKey();
  const client = new LinqAPIV3({ apiKey });

  const sendLink = (replyToMessageId?: string) => {
    const nativeMessage: LinqMessageContent = {
      parts: [{ type: "link", value: options.url }],
    };

    if (options.idempotencyKey) {
      nativeMessage.idempotency_key = options.idempotencyKey;
    }

    if (replyToMessageId) {
      nativeMessage.reply_to = { message_id: replyToMessageId };
    }

    return client.chats.messages.send(
      chatId,
      { message: nativeMessage },
      undefined
    );
  };

  try {
    await sendLink(options.requestedReplyMessageId);
  } catch (error) {
    if (
      !options.requestedReplyMessageId ||
      !unavailableReplyTargetSchema.safeParse(error).success
    ) {
      throw error;
    }

    console.warn("[linq] reply target is unavailable", {
      sessionId: options.sessionId,
    });
    await sendLink();
  }
}

type LinqOutgoingAttachments = NonNullable<
  Extract<AdapterPostableMessage, { raw: string }>["attachments"]
>;

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
    const references = extractImageArtifactMarkdownReferences(
      options.requestedText
    );

    const text =
      references.length === 0
        ? options.requestedText
        : [
            stripImageArtifactMarkdownReferences(options.requestedText),
            "I couldn't attach the image.",
          ]
            .filter(Boolean)
            .join("\n\n");

    const outgoing: Extract<
      Parameters<typeof options.thread.post>[0],
      { raw: string }
    > = { raw: text };

    if (options.attachments?.length) {
      outgoing.attachments = options.attachments;
    }

    await sendLinqMessage({
      outgoing,
      post: options.post,
      postReply: options.postReply,
      replyToMessageId: options.requestedReplyMessageId,
    });

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

  const failureMessage = Match.value(delivery.failedArtifactIds.length).pipe(
    Match.when(0, () => ""),
    Match.when(1, () => "I couldn't attach one image."),
    Match.orElse((count) => `I couldn't attach ${String(count)} images.`)
  );

  const text = [delivery.text, failureMessage].filter(Boolean).join("\n\n");

  const outgoing: Extract<
    Parameters<typeof options.thread.post>[0],
    { raw: string }
  > = { raw: text };

  if (options.attachments?.length) {
    outgoing.attachments = options.attachments;
  }

  if (delivery.files.length > 0) outgoing.files = delivery.files;
  await sendLinqMessage({
    outgoing,
    post: options.post,
    postReply: options.postReply,
    replyToMessageId: options.requestedReplyMessageId,
  });
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

  const requestedReplyMessageId =
    replyTarget?.conversationId === thread.id
      ? replyTarget.messageId
      : undefined;

  const idempotencyKey = report
    ? `scheduled-report:${report.runId}:${String(report.sequence)}`
    : undefined;

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
      await sendLinqMessage({
        outgoing: { attachments, raw: "" },
        post,
        postReply,
        replyToMessageId: requestedReplyMessageId,
      });
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
