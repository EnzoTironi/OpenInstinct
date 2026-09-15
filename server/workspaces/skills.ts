import { Effect, Schema } from "effect";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "./access";
import { GitRevisionSchema } from "./git";
import {
  parseSkillDocument,
  PublishedSkillPath,
  SkillProposalPath,
  skillPathFromProposal,
} from "./skill-document";
import {
  WorkspaceRepository,
  WorkspaceRepositoryError,
  WorkspaceWriteSchema,
} from "./repository";

export const PublishSkillProposalSchema = Schema.Struct({
  operationId: WorkspaceWriteSchema.fields.operationId,
  expectedRevision: WorkspaceWriteSchema.fields.expectedRevision,
  proposal: SkillProposalPath,
});
export const RollbackSkillSchema = Schema.Struct({
  operationId: WorkspaceWriteSchema.fields.operationId,
  expectedRevision: WorkspaceWriteSchema.fields.expectedRevision,
  path: PublishedSkillPath,
  revision: GitRevisionSchema,
});

const invalid = () => new WorkspaceRepositoryError({ reason: "invalid_input" });

export const listSkillProposals = Effect.fn("WorkspaceSkills.list")(function* (
  actor: typeof WorkspaceActorSchema.Type
) {
  if (actor.agentGrantId) return yield* new WorkspaceAccessDenied();
  yield* requireWorkspaceAccess(actor);
  const repository = yield* WorkspaceRepository;
  const listing = yield* repository.read(actor);
  const stored = yield* repository.selection(
    actor,
    listing.files.filter(Schema.is(SkillProposalPath))
  );
  return stored.documents.map((document) => ({
    path: document.path,
    title: parseSkillDocument(document.content)?.title ?? document.path,
    revision: stored.revision,
  }));
});

export const publishSkillProposal = Effect.fn("WorkspaceSkills.publish")(
  function* (
    actor: typeof WorkspaceActorSchema.Type,
    raw: typeof PublishSkillProposalSchema.Type
  ) {
    yield* requireWorkspaceAccess(actor, true);
    const input = yield* Schema.decodeUnknownEffect(PublishSkillProposalSchema)(
      raw
    ).pipe(Effect.mapError(invalid));
    const path = skillPathFromProposal(input.proposal);
    if (!Schema.is(PublishedSkillPath)(path)) return yield* invalid();
    const repository = yield* WorkspaceRepository;
    const proposal = yield* repository.read(
      actor,
      input.proposal,
      input.expectedRevision ?? undefined
    );
    if (proposal.content === null || !parseSkillDocument(proposal.content))
      return yield* invalid();
    return yield* repository.write(
      actor,
      {
        path,
        content: proposal.content,
        expectedRevision: input.expectedRevision,
        operationId: input.operationId,
      },
      { kind: "publication", proposal: input.proposal }
    );
  }
);

export const rollbackSkill = Effect.fn("WorkspaceSkills.rollback")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  raw: typeof RollbackSkillSchema.Type
) {
  yield* requireWorkspaceAccess(actor, true);
  const input = yield* Schema.decodeUnknownEffect(RollbackSkillSchema)(
    raw
  ).pipe(Effect.mapError(invalid));
  const repository = yield* WorkspaceRepository;
  const previous = yield* repository.read(actor, input.path, input.revision);
  if (previous.content === null || !parseSkillDocument(previous.content))
    return yield* invalid();
  return yield* repository.write(
    actor,
    {
      path: input.path,
      content: previous.content,
      expectedRevision: input.expectedRevision,
      operationId: input.operationId,
    },
    { kind: "rollback", revision: input.revision }
  );
});
