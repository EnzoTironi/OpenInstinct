import { TRPCError } from "@trpc/server";
import { Effect, Schema } from "effect";
import { serverRuntime } from "../../server/runtime";
import {
  createUserWorkspace,
  listUserWorkspaces,
} from "../../server/workspaces/directory";
import {
  WorkspaceRepository,
  WorkspaceWriteSchema,
} from "../../server/workspaces/repository";
import {
  listSkillProposals,
  publishSkillProposal,
  PublishSkillProposalSchema,
  rollbackSkill,
  RollbackSkillSchema,
} from "../../server/workspaces/skills";
import {
  GitRevisionSchema,
  WorkspacePathSchema,
} from "../../server/workspaces/git";
import { workspaceProcedure } from "./workspace-procedure";
import { workspaceRoomsRouter } from "./workspace-rooms";
import { workspaceToolsRouter } from "./workspace-tools";
import { workspaceAgentsRouter } from "./workspace-agents";
import { readWorkspaceCapabilities } from "../../server/workspaces/capabilities";
import {
  ReminderStatusSchema,
  setReminderStatus,
} from "../../server/schedules/manage";
import {
  DirectoryProfileSchema,
  UsernameSchema,
  readDirectoryProfile,
  saveDirectoryProfile,
  searchDirectory,
} from "../../server/accounts/directory";
import {
  answerWorkspaceInvitation,
  inviteWorkspaceMember,
  readWorkspaceInvitations,
  readWorkspaceTeam,
  removeWorkspaceMember,
  revokeWorkspaceInvitation,
} from "../../server/workspaces/team";
import {
  LearnedMemory,
  LearnedMemoryWriteSchema,
} from "../../server/memory/learned";

export const workspacesRouter = {
  tools: workspaceToolsRouter,
  rooms: workspaceRoomsRouter,
  ...workspaceAgentsRouter,
  schedules: {
    setStatus: workspaceProcedure
      .input(Schema.toStandardSchemaV1(ReminderStatusSchema))
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(
          setReminderStatus(ctx.actor, input).pipe(
            Effect.catchTag("ScheduleChanged", () =>
              Effect.fail(new TRPCError({ code: "CONFLICT" }))
            )
          ),
          { signal }
        )
      ),
  },
  profile: {
    read: workspaceProcedure.query(({ ctx, signal }) =>
      serverRuntime.runPromise(readDirectoryProfile(ctx.actor), { signal })
    ),
    save: workspaceProcedure
      .input(Schema.toStandardSchemaV1(DirectoryProfileSchema))
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(saveDirectoryProfile(ctx.actor, input), {
          signal,
        })
      ),
    search: workspaceProcedure
      .input(
        Schema.toStandardSchemaV1(
          Schema.Struct({ query: Schema.String.check(Schema.isMaxLength(30)) })
        )
      )
      .query(({ ctx, input, signal }) =>
        serverRuntime.runPromise(searchDirectory(ctx.actor, input.query), {
          signal,
        })
      ),
  },
  team: {
    revoke: workspaceProcedure
      .input(
        Schema.toStandardSchemaV1(
          Schema.Struct({ id: Schema.String.check(Schema.isUUID()) })
        )
      )
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(
          revokeWorkspaceInvitation(ctx.actor, input.id),
          { signal }
        )
      ),
    list: workspaceProcedure.query(({ ctx, signal }) =>
      serverRuntime.runPromise(readWorkspaceTeam(ctx.actor), { signal })
    ),
    invitations: workspaceProcedure.query(({ ctx, signal }) =>
      serverRuntime.runPromise(readWorkspaceInvitations(ctx.actor), { signal })
    ),
    invite: workspaceProcedure
      .input(
        Schema.toStandardSchemaV1(Schema.Struct({ username: UsernameSchema }))
      )
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(
          inviteWorkspaceMember(ctx.actor, input.username),
          { signal }
        )
      ),
    answer: workspaceProcedure
      .input(
        Schema.toStandardSchemaV1(
          Schema.Struct({
            id: Schema.String.check(Schema.isUUID()),
            accept: Schema.Boolean,
          })
        )
      )
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(
          answerWorkspaceInvitation(ctx.actor, input.id, input.accept),
          { signal }
        )
      ),
    remove: workspaceProcedure
      .input(
        Schema.toStandardSchemaV1(
          Schema.Struct({
            userId: Schema.NonEmptyString.check(Schema.isMaxLength(200)),
          })
        )
      )
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(
          removeWorkspaceMember(ctx.actor, input.userId),
          { signal }
        )
      ),
  },
  capabilities: workspaceProcedure.query(({ ctx, signal }) =>
    serverRuntime.runPromise(readWorkspaceCapabilities(ctx.actor), { signal })
  ),
  memory: {
    recover: workspaceProcedure.mutation(({ ctx, signal }) =>
      serverRuntime.runPromise(
        Effect.gen(function* () {
          return yield* (yield* LearnedMemory).recover(ctx.actor);
        }),
        { signal }
      )
    ),
    list: workspaceProcedure.query(({ ctx, signal }) =>
      serverRuntime.runPromise(
        Effect.gen(function* () {
          return yield* (yield* LearnedMemory).read(ctx.actor, undefined, true);
        }),
        { signal }
      )
    ),
    write: workspaceProcedure
      .input(Schema.toStandardSchemaV1(LearnedMemoryWriteSchema))
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(
          Effect.gen(function* () {
            return yield* (yield* LearnedMemory).write(ctx.actor, input, false);
          }),
          { signal }
        )
      ),
    setEnabled: workspaceProcedure
      .input(
        Schema.toStandardSchemaV1(Schema.Struct({ enabled: Schema.Boolean }))
      )
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(
          Effect.gen(function* () {
            return yield* (yield* LearnedMemory).setEnabled(
              ctx.actor,
              input.enabled
            );
          }),
          { signal }
        )
      ),
  },
  list: workspaceProcedure.query(({ ctx, signal }) =>
    serverRuntime.runPromise(listUserWorkspaces(ctx.actor), { signal })
  ),
  create: workspaceProcedure
    .input(
      Schema.toStandardSchemaV1(
        Schema.Struct({
          name: Schema.String.check(
            Schema.isTrimmed(),
            Schema.isMinLength(1),
            Schema.isMaxLength(80)
          ),
        })
      )
    )
    .mutation(({ ctx, input, signal }) =>
      serverRuntime.runPromise(createUserWorkspace(ctx.actor, input.name), {
        signal,
      })
    ),
  files: workspaceProcedure
    .input(
      Schema.toStandardSchemaV1(
        Schema.Struct({
          path: Schema.optionalKey(WorkspacePathSchema),
          revision: Schema.optionalKey(GitRevisionSchema),
        })
      )
    )
    .query(({ ctx, input, signal }) =>
      serverRuntime.runPromise(
        Effect.gen(function* () {
          return yield* (yield* WorkspaceRepository).read(
            ctx.actor,
            input.path,
            input.revision
          );
        }),
        { signal }
      )
    ),
  history: workspaceProcedure
    .input(
      Schema.toStandardSchemaV1(Schema.Struct({ path: WorkspacePathSchema }))
    )
    .query(({ ctx, input, signal }) =>
      serverRuntime.runPromise(
        Effect.gen(function* () {
          return yield* (yield* WorkspaceRepository).history(
            ctx.actor,
            input.path
          );
        }),
        { signal }
      )
    ),
  write: workspaceProcedure
    .input(Schema.toStandardSchemaV1(WorkspaceWriteSchema))
    .mutation(({ ctx, input, signal }) =>
      serverRuntime.runPromise(
        Effect.gen(function* () {
          return yield* (yield* WorkspaceRepository).write(ctx.actor, input);
        }).pipe(
          Effect.catchTag("WorkspaceRepositoryError", (error) =>
            Effect.fail(
              new TRPCError({
                code: error.reason === "conflict" ? "CONFLICT" : "BAD_REQUEST",
                message:
                  error.reason === "conflict"
                    ? "This file changed. Reload it before saving."
                    : "Unable to save this file.",
              })
            )
          )
        ),
        { signal }
      )
    ),
  skills: {
    proposals: workspaceProcedure.query(({ ctx, signal }) =>
      serverRuntime.runPromise(listSkillProposals(ctx.actor), { signal })
    ),
    publish: workspaceProcedure
      .input(Schema.toStandardSchemaV1(PublishSkillProposalSchema))
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(
          publishSkillProposal(ctx.actor, input).pipe(
            Effect.catchTag("WorkspaceAccessDenied", () =>
              Effect.fail(new TRPCError({ code: "FORBIDDEN" }))
            ),
            Effect.catchTag("WorkspaceRepositoryError", (error) =>
              Effect.fail(
                new TRPCError({
                  code:
                    error.reason === "conflict" ? "CONFLICT" : "BAD_REQUEST",
                  message:
                    error.reason === "conflict"
                      ? "This file changed. Reload it before saving."
                      : "Unable to publish this skill.",
                })
              )
            )
          ),
          { signal }
        )
      ),
    rollback: workspaceProcedure
      .input(Schema.toStandardSchemaV1(RollbackSkillSchema))
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(
          rollbackSkill(ctx.actor, input).pipe(
            Effect.catchTag("WorkspaceAccessDenied", () =>
              Effect.fail(new TRPCError({ code: "FORBIDDEN" }))
            ),
            Effect.catchTag("WorkspaceRepositoryError", (error) =>
              Effect.fail(
                new TRPCError({
                  code:
                    error.reason === "conflict" ? "CONFLICT" : "BAD_REQUEST",
                  message:
                    error.reason === "conflict"
                      ? "This file changed. Reload it before saving."
                      : "Unable to restore this skill.",
                })
              )
            )
          ),
          { signal }
        )
      ),
  },
};
