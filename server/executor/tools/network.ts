import { Effect, Schema } from "effect";
import { defineDynamic, defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { toolInputSchema } from "../../../agent/lib/tool-input-schema";
import { workspaceOperationId } from "../../../agent/lib/workspace-operation";
import { serverRuntime } from "../../runtime";
import { UsernameSchema } from "../../accounts/directory";
import { searchWorkspaceBots } from "../../workspaces/bots";
import { workspaceActorFromPrincipal } from "../../workspaces/access";
import {
  openMatrixConversation,
  sendMatrixConversation,
} from "../../matrix/conversations";
import { awaitMatrixResult, readMatrixResult } from "../../matrix/result";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) => {
      const caller = context.session.auth.current;
      // A network grant cannot delegate again or borrow its owner's browser login.
      // Company group sharing needs a separate audience grant, not this personal action.
      if (
        caller?.authenticator !== "authjs" ||
        caller.attributes.chatKind === "group"
      )
        return null;
      return {
        "network-bots": defineTool({
          description:
            "Find published bots in the active trusted network. Company membership or mutually accepted personal trust is required. Contact does not grant private files, memories, credentials or other networks.",
          inputSchema: toolInputSchema(
            Schema.Struct({
              query: Schema.String.check(Schema.isMaxLength(30)),
            })
          ),
          execute: (input, execution) =>
            serverRuntime.runPromise(
              Effect.gen(function* () {
                const actor = yield* workspaceActorFromPrincipal(
                  execution.session.auth.current ?? undefined
                );
                return yield* searchWorkspaceBots(actor, input.query);
              }),
              { signal: execution.abortSignal }
            ),
        }),
        "network-contact": defineTool({
          description:
            "Ask another trusted person's or company's bot through Matrix and A2A, using this workspace's published bot identity. This sends the exact text to the named bot and requires approval. Share only content authorized for that recipient. Returns the result or a pending receipt; use network-result to check a pending receipt, never resend the question. The destination cannot recursively contact bots through this grant.",
          inputSchema: toolInputSchema(
            Schema.Struct({
              username: UsernameSchema,
              text: Schema.NonEmptyString.check(
                Schema.isTrimmed(),
                Schema.isMaxLength(8000)
              ),
            })
          ),
          approval: always(),
          execute: (input, execution) =>
            serverRuntime.runPromise(
              Effect.gen(function* () {
                const actor = yield* workspaceActorFromPrincipal(
                  execution.session.auth.current ?? undefined
                );
                const room = yield* openMatrixConversation(
                  actor,
                  input.username,
                  true
                );
                const event = yield* sendMatrixConversation(actor, {
                  id: room.id,
                  text: input.text,
                  operationId: workspaceOperationId(
                    execution.session.id,
                    execution.callId
                  ),
                });
                return yield* awaitMatrixResult(actor, room.id, event.event_id);
              }),
              { signal: execution.abortSignal }
            ),
        }),
        "network-result": defineTool({
          description:
            "Read an existing network-contact receipt in the active workspace. Does not send a message. If still pending, report that accurately and do not repeatedly resend or claim completion.",
          inputSchema: toolInputSchema(
            Schema.Struct({
              conversationId: Schema.String.check(Schema.isUUID()),
              eventId: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
            })
          ),
          execute: (input, execution) =>
            serverRuntime.runPromise(
              Effect.gen(function* () {
                const actor = yield* workspaceActorFromPrincipal(
                  execution.session.auth.current ?? undefined
                );
                return yield* readMatrixResult(
                  actor,
                  input.conversationId,
                  input.eventId
                );
              }),
              { signal: execution.abortSignal }
            ),
        }),
      };
    },
  },
});
