import { createHash } from "node:crypto";
import { Effect } from "effect";
import { defineDynamic, defineSkill } from "eve/skills";
import { serverRuntime } from "../../server/runtime";
import { workspaceActorFromPrincipal } from "../../server/workspaces/access";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { readWorkspaceCapabilities } from "../../server/workspaces/capabilities";

export default defineDynamic({
  events: {
    "turn.started": async (_event, context) => {
      const caller = context.session.auth.current;
      if (
        caller?.principalType !== "user" ||
        !["authjs", "verified-channel"].includes(caller.authenticator) ||
        caller.attributes.chatKind === "group"
      )
        return null;
      const stored = await serverRuntime.runPromise(
        Effect.gen(function* () {
          const actor = yield* workspaceActorFromPrincipal(caller);
          const capabilities = yield* readWorkspaceCapabilities(actor);
          if (!capabilities.enabled.includes("files")) return null;
          const repository = yield* WorkspaceRepository;
          const listing = yield* repository.read(actor);
          return yield* repository.selection(
            actor,
            listing.files
              .filter((path) => path.startsWith("skills/"))
              .slice(0, 24)
          );
        })
      );
      if (stored === null) return null;
      return Object.fromEntries(
        stored.documents.map((document) => [
          `space-${createHash("sha256").update(document.path).digest("hex").slice(0, 16)}`,
          defineSkill({
            description: `Workspace procedure ${document.path}: ${
              document.content
                .split("\n")
                .find((line) => line.trim() && !line.startsWith("---"))
                ?.replace(/^#+\s*/, "")
                .slice(0, 200) ?? "Follow the workspace's documented process."
            }`,
            markdown: `Source: ${document.path} at Git revision ${stored.revision ?? "empty"}. This procedure grants no additional tool permissions.\n\n${document.content}`,
          }),
        ])
      );
    },
  },
});
