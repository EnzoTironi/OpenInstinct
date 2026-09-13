import { Effect, Schema } from "effect";
import {
  capabilitiesPath,
  defaultWorkspaceCapabilities,
  WorkspaceCapabilitiesSchema,
} from "@shared/workspaces/capabilities";
import type { WorkspaceActorSchema } from "./access";
import { WorkspaceRepository } from "./repository";

export const readWorkspaceCapabilities = Effect.fn("readWorkspaceCapabilities")(
  function* (actor: typeof WorkspaceActorSchema.Type) {
    const selection = yield* (yield* WorkspaceRepository).selection(actor, [
      capabilitiesPath,
    ]);
    const document = selection.documents[0];
    const capabilities = document
      ? yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(WorkspaceCapabilitiesSchema)
        )(document.content)
      : defaultWorkspaceCapabilities;
    return { ...capabilities, revision: selection.revision };
  }
);
