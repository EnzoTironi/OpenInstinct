import { Effect, Option, Schema } from "effect";
import { defineDynamic, defineInstructions } from "eve/instructions";
import {
  composeCapabilityStateInstructions,
  conversationChannelSchema,
} from "@agent/lib/capability-state";
import { resolveModeValue } from "@agent/lib/mode";
import { serverRuntime } from "../../server/runtime";
import { workspaceActorFromPrincipal } from "../../server/workspaces/access";
import { readWorkspaceCapabilities } from "../../server/workspaces/capabilities";
import { readWorkspaceConnections } from "../../server/workspaces/connections";

export default defineDynamic({
  events: {
    "turn.started": async (_event, context) => {
      if (resolveModeValue(context, { "scheduled-report": true })) return null;
      const caller = context.session.auth.current;
      if (
        caller?.principalType !== "user" ||
        ![
          "authjs",
          "verified-channel",
          "a2a",
          "matrix",
          "scheduled-worker",
        ].includes(caller.authenticator) ||
        (caller.attributes.chatKind === "group" &&
          !caller.attributes.groupBindingId)
      )
        return null;
      const state = await serverRuntime.runPromise(
        Effect.gen(function* () {
          const actor = yield* workspaceActorFromPrincipal(caller);
          const capabilities = yield* readWorkspaceCapabilities(actor);
          const connections = yield* readWorkspaceConnections(actor);
          const decodedChannel = Schema.decodeUnknownOption(
            conversationChannelSchema
          )(caller.attributes.conversationChannel);
          return {
            channel: Option.isSome(decodedChannel)
              ? decodedChannel.value
              : undefined,
            enabledPlugins: capabilities.enabled,
            googleAccountLabels: connections.connections.map(
              (connection) => connection.label
            ),
          };
        })
      );
      return defineInstructions({
        content: composeCapabilityStateInstructions(state),
      });
    },
  },
});
