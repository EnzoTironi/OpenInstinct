import { TRPCError } from "@trpc/server";
import {
  OntologySchema,
  OntologyActionSchema,
} from "@shared/workspaces/ontology";
import { GitRevisionSchema } from "../../server/workspaces/git";
import {
  applyOntologyAction,
  publishOntology,
  readOntology,
} from "../../server/workspaces/ontology";
import { Effect, Schema } from "effect";
import { serverRuntime } from "../../server/runtime";
import {
  AgentGrantInputSchema,
  BotProfileSchema,
  issueAgentGrant,
  readWorkspaceBot,
  revokeAgentGrant,
  saveWorkspaceBot,
  searchWorkspaceBots,
} from "../../server/workspaces/bots";
import {
  DelegateVaultItemSchema,
  delegateVaultItem,
  listDelegatedVaultItems,
  revokeVaultDelegation,
} from "../../server/workspaces/vault";
import {
  ShareWhatsAppChatSchema,
  listWhatsAppAccounts,
  listWhatsAppChats,
  pauseWhatsAppBridge,
  resumeWhatsAppBridge,
  revokeWhatsAppBridge,
  shareWhatsAppChat,
  startWhatsAppPairing,
} from "../../server/workspaces/whatsapp";
import {
  disconnectWorkspaceGoogle,
  readWorkspaceConnections,
  shareGoogleConnection,
} from "../../server/workspaces/connections";
import {
  AnswerPersonalTrustSchema,
  ContactNetworkBotSchema,
  PersonalTrustUsernameSchema,
  answerPersonalTrust,
  blockPersonalTrust,
  contactNetworkBot,
  endPersonalTrust,
  invitePersonalTrust,
  listPersonalNetwork,
} from "../../server/workspaces/network";
import { workspaceProcedure } from "./workspace-procedure";

const revisionFields = {
  expectedRevision: Schema.NullOr(GitRevisionSchema),
  operationId: Schema.String.check(Schema.isUUID()),
};
export const workspaceAgentsRouter = {
  ontology: {
    read: workspaceProcedure.query(({ ctx, signal }) =>
      serverRuntime.runPromise(readOntology(ctx.actor), { signal })
    ),
    publish: workspaceProcedure
      .input(
        Schema.toStandardSchemaV1(
          Schema.Struct({ ...revisionFields, graph: OntologySchema })
        )
      )
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(publishOntology(ctx.actor, input), { signal })
      ),
    act: workspaceProcedure
      .input(
        Schema.toStandardSchemaV1(
          Schema.Struct({ ...revisionFields, ...OntologyActionSchema.fields })
        )
      )
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(applyOntologyAction(ctx.actor, input), {
          signal,
        })
      ),
  },
  bot: {
    read: workspaceProcedure.query(({ ctx, signal }) =>
      serverRuntime.runPromise(readWorkspaceBot(ctx.actor), { signal })
    ),
    save: workspaceProcedure
      .input(Schema.toStandardSchemaV1(BotProfileSchema))
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(saveWorkspaceBot(ctx.actor, input), { signal })
      ),
    search: workspaceProcedure
      .input(
        Schema.toStandardSchemaV1(
          Schema.Struct({
            query: Schema.String.check(
              Schema.isMinLength(2),
              Schema.isMaxLength(30)
            ),
          })
        )
      )
      .query(({ ctx, input, signal }) =>
        serverRuntime.runPromise(searchWorkspaceBots(ctx.actor, input.query), {
          signal,
        })
      ),
    grant: workspaceProcedure
      .input(Schema.toStandardSchemaV1(AgentGrantInputSchema))
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(issueAgentGrant(ctx.actor, input), { signal })
      ),
    revoke: workspaceProcedure
      .input(
        Schema.toStandardSchemaV1(
          Schema.Struct({ id: Schema.String.check(Schema.isUUID()) })
        )
      )
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(revokeAgentGrant(ctx.actor, input.id), {
          signal,
        })
      ),
  },
  network: {
    list: workspaceProcedure.query(({ ctx, signal }) =>
      serverRuntime.runPromise(
        listPersonalNetwork(ctx.actor).pipe(
          Effect.catchTag("WorkspaceAccessDenied", () =>
            Effect.fail(new TRPCError({ code: "FORBIDDEN" }))
          )
        ),
        { signal }
      )
    ),
    invite: workspaceProcedure
      .input(Schema.toStandardSchemaV1(PersonalTrustUsernameSchema))
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(
          invitePersonalTrust(ctx.actor, input).pipe(
            Effect.catchTag("WorkspaceAccessDenied", () =>
              Effect.fail(new TRPCError({ code: "FORBIDDEN" }))
            )
          ),
          { signal }
        )
      ),
    answer: workspaceProcedure
      .input(Schema.toStandardSchemaV1(AnswerPersonalTrustSchema))
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(
          answerPersonalTrust(ctx.actor, input).pipe(
            Effect.catchTag("WorkspaceAccessDenied", () =>
              Effect.fail(new TRPCError({ code: "FORBIDDEN" }))
            )
          ),
          { signal }
        )
      ),
    end: workspaceProcedure
      .input(Schema.toStandardSchemaV1(PersonalTrustUsernameSchema))
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(
          endPersonalTrust(ctx.actor, input).pipe(
            Effect.catchTag("WorkspaceAccessDenied", () =>
              Effect.fail(new TRPCError({ code: "FORBIDDEN" }))
            )
          ),
          { signal }
        )
      ),
    block: workspaceProcedure
      .input(Schema.toStandardSchemaV1(PersonalTrustUsernameSchema))
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(
          blockPersonalTrust(ctx.actor, input).pipe(
            Effect.catchTag("WorkspaceAccessDenied", () =>
              Effect.fail(new TRPCError({ code: "FORBIDDEN" }))
            )
          ),
          { signal }
        )
      ),
    contact: workspaceProcedure
      .input(Schema.toStandardSchemaV1(ContactNetworkBotSchema))
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(
          contactNetworkBot(ctx.actor, input).pipe(
            Effect.map((result) => ({
              task: result.task,
              dest: result.dest,
              network: result.network,
            })),
            Effect.catchTag("WorkspaceAccessDenied", () =>
              Effect.fail(new TRPCError({ code: "FORBIDDEN" }))
            ),
            Effect.catchTag("A2AError", (error) =>
              Effect.fail(
                new TRPCError({ code: "BAD_REQUEST", message: error.message })
              )
            )
          ),
          { signal }
        )
      ),
  },
  connections: {
    list: workspaceProcedure.query(({ ctx, signal }) =>
      serverRuntime.runPromise(readWorkspaceConnections(ctx.actor), { signal })
    ),
    shareGoogle: workspaceProcedure.mutation(({ ctx, signal }) =>
      serverRuntime.runPromise(shareGoogleConnection(ctx.actor), { signal })
    ),
    disconnectGoogle: workspaceProcedure.mutation(({ ctx, signal }) =>
      serverRuntime.runPromise(disconnectWorkspaceGoogle(ctx.actor), { signal })
    ),
  },
  vault: {
    list: workspaceProcedure.query(({ ctx, signal }) =>
      serverRuntime.runPromise(
        listDelegatedVaultItems({
          userId: ctx.actor.userId,
          workspaceId: ctx.actor.workspaceId,
        }).pipe(
          Effect.catchTag("WorkspaceAccessDenied", () =>
            Effect.fail(new TRPCError({ code: "FORBIDDEN" }))
          )
        ),
        { signal }
      )
    ),
    delegate: workspaceProcedure
      .input(Schema.toStandardSchemaV1(DelegateVaultItemSchema))
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(
          delegateVaultItem(ctx.actor, input).pipe(
            Effect.catchTag("WorkspaceAccessDenied", () =>
              Effect.fail(new TRPCError({ code: "FORBIDDEN" }))
            )
          ),
          { signal }
        )
      ),
    revoke: workspaceProcedure
      .input(
        Schema.toStandardSchemaV1(
          Schema.Struct({ id: Schema.String.check(Schema.isUUID()) })
        )
      )
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(
          revokeVaultDelegation(ctx.actor, input.id).pipe(
            Effect.catchTag("WorkspaceAccessDenied", () =>
              Effect.fail(new TRPCError({ code: "FORBIDDEN" }))
            )
          ),
          { signal }
        )
      ),
  },
  whatsapp: {
    list: workspaceProcedure.query(({ ctx, signal }) =>
      serverRuntime.runPromise(
        Effect.gen(function* () {
          return {
            accounts: yield* listWhatsAppAccounts(ctx.actor),
            chats: yield* listWhatsAppChats(ctx.actor),
          };
        }).pipe(
          Effect.catchTag("WorkspaceAccessDenied", () =>
            Effect.fail(new TRPCError({ code: "FORBIDDEN" }))
          )
        ),
        { signal }
      )
    ),
    start: workspaceProcedure.mutation(({ ctx, signal }) =>
      serverRuntime.runPromise(
        startWhatsAppPairing(ctx.actor).pipe(
          Effect.catchTag("WorkspaceAccessDenied", () =>
            Effect.fail(new TRPCError({ code: "FORBIDDEN" }))
          )
        ),
        { signal }
      )
    ),
    pause: workspaceProcedure.mutation(({ ctx, signal }) =>
      serverRuntime.runPromise(
        pauseWhatsAppBridge(ctx.actor).pipe(
          Effect.catchTag("WorkspaceAccessDenied", () =>
            Effect.fail(new TRPCError({ code: "FORBIDDEN" }))
          )
        ),
        { signal }
      )
    ),
    resume: workspaceProcedure.mutation(({ ctx, signal }) =>
      serverRuntime.runPromise(
        resumeWhatsAppBridge(ctx.actor).pipe(
          Effect.catchTag("WorkspaceAccessDenied", () =>
            Effect.fail(new TRPCError({ code: "FORBIDDEN" }))
          )
        ),
        { signal }
      )
    ),
    revoke: workspaceProcedure.mutation(({ ctx, signal }) =>
      serverRuntime.runPromise(
        revokeWhatsAppBridge(ctx.actor).pipe(
          Effect.catchTag("WorkspaceAccessDenied", () =>
            Effect.fail(new TRPCError({ code: "FORBIDDEN" }))
          )
        ),
        { signal }
      )
    ),
    share: workspaceProcedure
      .input(Schema.toStandardSchemaV1(ShareWhatsAppChatSchema))
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(
          shareWhatsAppChat(ctx.actor, input).pipe(
            Effect.catchTag("WorkspaceAccessDenied", () =>
              Effect.fail(new TRPCError({ code: "FORBIDDEN" }))
            )
          ),
          { signal }
        )
      ),
  },
};
