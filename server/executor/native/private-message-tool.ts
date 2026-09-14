import { Effect, Schema } from "effect";
import { defineTool, toolOutput } from "eve/tools";
import { ChannelTransport } from "../../channels/transport";
import { serverRuntime } from "../../runtime";
import { requireChannelPrincipal } from "../../channels/principal";
import { taskReportDeliveryId } from "@agent/lib/task-report";

const Message = Schema.Struct({
  kind: Schema.Literal("message"),
  text: Schema.NonEmptyString.check(Schema.isMaxLength(16_384)),
  replyTo: Schema.optionalKey(
    Schema.Struct({ kind: Schema.Literal("current") })
  ),
});

export const privateMessageTool = (channel: "telegram" | "kapso") =>
  defineTool({
    description:
      "Send a plain-text message to this conversation. Use this for questions, progress and final answers. Put links in the text. Use replyTo current to quote the current incoming message. Attachments and reactions are not supported on this installation yet. Delivery is durable; never repeat a queued or uncertain message with another call.",
    inputSchema: {
      "~standard": Schema.toStandardJSONSchemaV1(
        Schema.toStandardSchemaV1(Message, {
          parseOptions: { onExcessProperty: "error" },
        })
      )["~standard"],
    },
    execute(input, context) {
      if (context.session.parent)
        throw new Error(
          "Return the result to the parent conversation instead of sending a message."
        );
      return serverRuntime.runPromise(
        Effect.gen(function* () {
          const auth =
            context.session.auth.current ??
            context.session.auth.initiator ??
            null;
          const identity = yield* requireChannelPrincipal(channel, auth);
          const reply = input.replyTo
            ? yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)(
                auth?.attributes.sourceMessageId
              )
            : undefined;
          const transport = yield* ChannelTransport;
          const reportId = taskReportDeliveryId(context);
          const enqueue = reportId
            ? transport.enqueueTaskReport
            : transport.enqueueText;
          const base = {
            identityId: identity.id,
            deliveryKey:
              reportId ?? `tool:${context.session.id}:${context.callId}`,
            text: input.text,
          };
          const intent = reply ? { ...base, replyToMessageId: reply } : base;
          yield* enqueue(intent);
          yield* transport.drainOutbox(identity.id);
          // Read the exact intent again through idempotent enqueue, not aggregate lane state.
          const receipts = yield* enqueue(intent);
          return {
            deliveries: receipts.map((receipt) => ({
              id: receipt.id,
              status: receipt.status,
            })),
          };
        })
      );
    },
    toModelOutput(output) {
      return toolOutput.text(
        `${JSON.stringify(output)}. Sent means accepted by the messaging provider, not read by the user. Queued/dispatching messages will be handled by the delivery service. Uncertain messages must not be resent. Do not repeat the message in assistant text.`
      );
    },
  });
