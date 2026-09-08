import { JsonSchema, Schema } from "effect";
import { defineDynamic, defineTool, toolOutput } from "eve/tools";
import { resolveModeValue } from "../lib/mode";
import {
  addReactionToMessageOutputSchema,
  reactToMessageOutputSchema,
} from "@shared/chat/reaction";
import { sendMessageOutputSchema } from "@shared/chat/message-delivery";
import { privateMessageTool } from "@agent/lib/private-message-tool";

function defineSendMessage() {
  const standard = Schema.toStandardJSONSchemaV1(
    Schema.toStandardSchemaV1(sendMessageOutputSchema)
  )["~standard"];

  return defineTool({
    description:
      "Send exactly one user-visible message to the current conversation. This is the delivery path for questions, progress updates, blockers, and final answers that need words. Choose kind message for plain text, private image artifacts, and HTTPS attachments; text and attachments may be combined, including in replies. Text is delivered exactly as written, so write it like a brief natural text message and do not use Markdown. Put nearly every response in a native quoted thread by setting replyTo: use current for an ordinary answer, clarification, status update, or follow-up prompted by the current user message, including when the user changes topics; use task with a task ID from Eve's Task state for delayed background work; and use automation with the automation ID supplied by a scheduled report. Omit replyTo only when the message is genuinely standalone and does not answer any particular user message, such as an unsolicited announcement or proactive notice, or when no applicable handle is available. Use only handles present in the current context. Choose kind link with a URL to send a standalone native preview. Put an ordinary URL in message text when a preview is not wanted. Call send_message multiple times only when you intentionally want separate messages. Call it directly without an assistant-text preamble, and do not repeat delivered content afterward.",
    inputSchema: {
      "~standard": {
        ...standard,
        jsonSchema: {
          ...standard.jsonSchema,
          input(options) {
            // Eve persists JSON Schema; attachments allow metadata that our decoder strips.
            const document = Schema.toJsonSchemaDocument(
              sendMessageOutputSchema,
              {
                includeAnnotationKey: (key) => key === "additionalProperties",
              }
            );
            if (options.target === "draft-2020-12") return document.schema;
            if (options.target === "draft-07")
              return JsonSchema.toDocumentDraft07(document).schema;
            throw new Error(
              `Unsupported JSON Schema target: ${options.target}`
            );
          },
        },
      },
    },
    execute(message) {
      return message;
    },
    toModelOutput() {
      return toolOutput.text(
        "This successful call has already created one user-visible message for the current conversation. Do not repeat the same content through another send_message call or in assistant text. If the current request is fulfilled, end the turn now with DELIVERY_COMPLETE. Send another message only for distinct information the user still needs, such as a later result after an earlier progress update."
      );
    },
  });
}

export default defineDynamic({
  // This resolver only selects tool definitions; cold recovery can safely rebuild them.
  rebindMissingCallbacks: true,
  events: {
    "turn.started": (_event, context) => {
      const principal =
        context.session.auth.current ?? context.session.auth.initiator;
      const channel = principal?.attributes.conversationChannel;
      if (channel === "telegram" || channel === "kapso") {
        const tools = { send_message: privateMessageTool(channel) };
        return resolveModeValue(context, {
          interactive: tools,
          "scheduled-report": tools,
        });
      }
      const isLinq = context.channel.kind === "channel:linq";
      const send_message = defineSendMessage();

      const reactionSchema = isLinq
        ? reactToMessageOutputSchema
        : addReactionToMessageOutputSchema;
      const reactionStandard = Schema.toStandardJSONSchemaV1(
        Schema.toStandardSchemaV1(reactionSchema)
      )["~standard"];
      const react_to_message = defineTool({
        description: isLinq
          ? "Add or remove a native iMessage Tapback on the user's current message. Use this instead of send_message when a reaction fully communicates a lightweight acknowledgement and words would add nothing. Supports thumbs_up, thumbs_down, heart, laugh, exclamation (emphasis), and question."
          : "Acknowledge the user's current message with one compact reaction displayed in the conversation. Use this instead of send_message when the reaction fully communicates the response and words would add nothing. Supports thumbs_up, thumbs_down, heart, laugh, exclamation (emphasis), and question.",
        inputSchema: {
          "~standard": {
            ...reactionStandard,
            jsonSchema: {
              ...reactionStandard.jsonSchema,
              input(options) {
                const document = Schema.toJsonSchemaDocument(reactionSchema, {
                  includeAnnotationKey: (key) => key === "additionalProperties",
                });
                if (options.target === "draft-2020-12") return document.schema;
                if (options.target === "draft-07")
                  return JsonSchema.toDocumentDraft07(document).schema;
                throw new Error(
                  `Unsupported JSON Schema target: ${options.target}`
                );
              },
            },
          },
        },
        execute(reaction) {
          return reaction;
        },
        toModelOutput() {
          return toolOutput.text(
            "The reaction was submitted to the active conversation. Do not repeat it in assistant text."
          );
        },
      });

      const interactive = { react_to_message, send_message };

      type MessagingTools =
        | typeof interactive
        | { send_message: typeof send_message };

      return resolveModeValue<MessagingTools>(context, {
        interactive,
        "scheduled-report": { send_message },
      });
    },
  },
});
