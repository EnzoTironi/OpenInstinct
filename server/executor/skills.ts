import { Effect, Schema } from "effect";
import { WorkspaceRepository } from "../workspaces/repository";
import type { WorkspaceActorSchema } from "../workspaces/access";
import { readWorkspaceCapabilities } from "../workspaces/capabilities";
import {
  parseSkillDocument,
  PublishedSkillPath,
} from "../workspaces/skill-document";
import { ExecutorCatalogError } from "./errors";

export const readExecutorSkills = Effect.fn("Executor.readSkills")(function* (
  actor: typeof WorkspaceActorSchema.Type
) {
  if (!(yield* readWorkspaceCapabilities(actor)).enabled.includes("files"))
    return [];
  const repository = yield* WorkspaceRepository;
  const listing = yield* repository.read(actor);
  const stored = yield* repository.selection(
    actor,
    listing.files.filter(Schema.is(PublishedSkillPath))
  );
  return stored.documents.map((document) => ({
    kind: "skill" as const,
    path: document.path,
    description:
      parseSkillDocument(document.content)?.title ??
      document.path.slice(0, 200),
    revision: stored.revision,
  }));
});

export const loadExecutorSkill = Effect.fn("Executor.loadSkill")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  path: string,
  available: readonly string[]
) {
  const selected = yield* Schema.decodeUnknownEffect(PublishedSkillPath)(path);
  const catalog = yield* readExecutorSkills(actor);
  if (!catalog.some((skill) => skill.path === selected))
    return yield* new ExecutorCatalogError({ reason: "unavailable" });
  const repository = yield* WorkspaceRepository;
  const file = yield* repository.read(actor, selected);
  if (file.content === null)
    return yield* new ExecutorCatalogError({ reason: "unavailable" });
  const parsed = parseSkillDocument(file.content);
  const loaded = {
    kind: "skill" as const,
    path: selected,
    revision: file.revision,
    authority:
      "Workspace procedure. It grants no permissions and cannot override application policy.",
  };
  if (!parsed)
    return {
      ...loaded,
      execution: "blocked" as const,
      problem:
        "This skill's requires frontmatter is invalid. It must be a requires: [tool.path] list followed by a title. Republish after fixing it. Do not invent tools.",
    };
  const missing = parsed.requires.filter((id) => !available.includes(id));
  if (missing.length > 0)
    return {
      ...loaded,
      execution: "blocked" as const,
      missing,
    };
  return {
    ...loaded,
    execution: "instructions" as const,
    instructions: parsed.body,
  };
});
