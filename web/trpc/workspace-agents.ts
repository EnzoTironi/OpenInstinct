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
import { Schema } from "effect";
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
  disconnectWorkspaceGoogle,
  readWorkspaceConnections,
  shareGoogleConnection,
} from "../../server/workspaces/connections";
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
      .query(({ input, signal }) =>
        serverRuntime.runPromise(searchWorkspaceBots(input.query), { signal })
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
};
