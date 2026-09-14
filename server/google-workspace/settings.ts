import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import {
  GoogleWorkspaceError,
  googleWorkspaceUserId,
  readGoogleWorkspaceConnection,
} from "./index";
import {
  requireWorkspaceAccess,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { readWorkspaceCapabilities } from "../workspaces/capabilities";
import { WorkspaceRepository } from "../workspaces/repository";
import { capabilitiesPath } from "@shared/workspaces/capabilities";

export const readPersonalGoogleSettings = Effect.fn(
  "readPersonalGoogleSettings"
)(function* (actor: typeof WorkspaceActorSchema.Type) {
  const connection = yield* readGoogleWorkspaceConnection(actor);
  const capabilities = yield* readWorkspaceCapabilities(actor);
  return {
    state:
      connection.state === "connected" &&
      !capabilities.enabled.includes("google")
        ? ("paused" as const)
        : connection.state,
  };
});

/** The connection button is an explicit personal-space activation, never a read side effect. */
export const activatePersonalGoogle = Effect.fn("activatePersonalGoogle")(
  function* (actor: typeof WorkspaceActorSchema.Type) {
    yield* googleWorkspaceUserId(actor);
    if (!actor.authSessionId)
      return yield* new GoogleWorkspaceError({ reason: "unauthenticated" });
    yield* requireWorkspaceAccess(actor, true);
    const connection = yield* readGoogleWorkspaceConnection(actor);
    if (connection.state === "unavailable")
      return yield* new GoogleWorkspaceError({ reason: "unconfigured" });
    const capabilities = yield* readWorkspaceCapabilities(actor);
    if (!capabilities.enabled.includes("google")) {
      yield* (yield* WorkspaceRepository).write(actor, {
        operationId: randomUUID(),
        expectedRevision: capabilities.revision,
        path: capabilitiesPath,
        content: JSON.stringify(
          { version: 1, enabled: [...capabilities.enabled, "google"] },
          null,
          2
        ),
      });
    }
    return { authorize: connection.state !== "connected" };
  }
);
