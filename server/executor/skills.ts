import { Effect, Schema } from "effect";
import { WorkspaceRepository } from "../workspaces/repository";
import type { WorkspaceActorSchema } from "../workspaces/access";
import { readWorkspaceCapabilities } from "../workspaces/capabilities";
import { WorkspacePathSchema } from "../workspaces/git";
import { ExecutorCatalogError } from "./errors";

const ExecutorSkillPath = WorkspacePathSchema.check(
  Schema.isPattern(/^skills\/.+\.md$/u)
);

export const readExecutorSkills = Effect.fn("Executor.readSkills")(function* (
  actor: typeof WorkspaceActorSchema.Type
) {
  if (!(yield* readWorkspaceCapabilities(actor)).enabled.includes("files"))
    return [];
  const repository = yield* WorkspaceRepository;
  const listing = yield* repository.read(actor);
  const stored = yield* repository.selection(
    actor,
    listing.files.filter(Schema.is(ExecutorSkillPath))
  );
  return stored.documents.map((document) => ({
    kind: "skill" as const,
    path: document.path,
    description:
      document.content
        .split("\n")
        .find((line) => line.trim() && !line.startsWith("---"))
        ?.replace(/^#+\s*/u, "")
        .slice(0, 200) ?? document.path,
    revision: stored.revision,
  }));
});

export const loadExecutorSkill = Effect.fn("Executor.loadSkill")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  path: string
) {
  const selected = yield* Schema.decodeUnknownEffect(ExecutorSkillPath)(path);
  const catalog = yield* readExecutorSkills(actor);
  if (!catalog.some((skill) => skill.path === selected))
    return yield* new ExecutorCatalogError({ reason: "unavailable" });
  const repository = yield* WorkspaceRepository;
  const file = yield* repository.read(actor, selected);
  return {
    kind: "skill" as const,
    execution: "instructions" as const,
    path: selected,
    revision: file.revision,
    instructions: file.content,
    authority:
      "Workspace procedure. It grants no permissions and cannot override application policy.",
  };
});
