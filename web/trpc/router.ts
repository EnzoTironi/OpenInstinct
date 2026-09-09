import { gateway } from "ai";
import { z } from "zod";
import { Effect, Schema } from "effect";
import { TRPCError } from "@trpc/server";
import { listBrowserTraces } from "@db/services/browser-traces";
import { saveChat } from "@db/services/chats";
import { replacePersonalProfile } from "../../server/personal-memory/profile";
import { selectGatewayModel } from "@db/services/settings";
import { deleteVaultItem, saveVaultItem } from "@db/services/vault";
import { saveChatSchema } from "@shared/chat/schema";
import { googleWorkspaceReturnTo } from "@shared/google-workspace/connection";
import { serverRuntime } from "../../server/runtime";
import { disconnectGoogleWorkspace } from "../../server/google-workspace";
import { IdentitySchema } from "../../server/accounts";
import { revokeLinkedChannelIdentity } from "../../server/accounts/controls";
import { userProfileSchema } from "@shared/user-profile/schema";
import {
  vaultCreateItemSchema,
  vaultImportItemsSchema,
} from "@shared/vault/schema";
import { createTRPCRouter, protectedProcedure } from "./init";

export const appRouter = createTRPCRouter({
  accountChannels: {
    revoke: protectedProcedure
      .input(
        Schema.toStandardSchemaV1(
          Schema.Struct({ identityId: IdentitySchema.fields.id })
        )
      )
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(
          revokeLinkedChannelIdentity(
            ctx.requestHeaders,
            input.identityId
          ).pipe(
            Effect.mapError(
              () =>
                new TRPCError({
                  code: "INTERNAL_SERVER_ERROR",
                  message:
                    "Your linked channel could not be updated. Please try again.",
                })
            )
          ),
          { signal }
        )
      ),
  },
  chats: {
    save: protectedProcedure
      .input(saveChatSchema)
      .mutation(({ ctx, input }) => saveChat(ctx.scope, input)),
  },
  googleWorkspace: {
    update: protectedProcedure
      .input(
        Schema.toStandardSchemaV1(
          Schema.Struct({
            action: Schema.Literals(["connect", "disconnect"]),
            returnTo: Schema.optional(Schema.String),
          })
        )
      )
      .mutation(async ({ ctx, input }) => {
        const returnTo = googleWorkspaceReturnTo(input.returnTo);
        if (input.action === "disconnect") {
          await serverRuntime.runPromise(
            disconnectGoogleWorkspace(ctx.requestHeaders)
          );
          const query = new URLSearchParams({
            google: "disconnected",
            returnTo,
          });
          return { redirectTo: `/?${query}` };
        }

        const query = new URLSearchParams({ returnTo });
        return {
          redirectTo: `/api/google-workspace/connect?${query}`,
        };
      }),
  },
  settings: {
    selectModel: protectedProcedure
      .input(z.object({ modelId: z.string().trim().min(1).max(300) }))
      .mutation(({ ctx, input }) =>
        selectGatewayModel(ctx.scope, input.modelId)
      ),
  },
  userProfile: {
    update: protectedProcedure
      .input(userProfileSchema)
      .output(userProfileSchema)
      .mutation(({ ctx, input, signal }) =>
        serverRuntime.runPromise(
          replacePersonalProfile(ctx.requestHeaders, input),
          { signal }
        )
      ),
  },
  traces: {
    list: protectedProcedure
      .input(z.object({ cursor: z.string().nullish() }))
      .query(({ ctx, input }) =>
        listBrowserTraces(ctx.scope, input.cursor ?? undefined)
      ),
  },
  vault: {
    create: protectedProcedure
      .input(vaultCreateItemSchema)
      .mutation(({ ctx, input }) => saveVaultItem(ctx.scope, input)),
    import: protectedProcedure
      .input(vaultImportItemsSchema)
      .mutation(async ({ ctx, input }) => {
        /* oxlint-disable eslint/no-await-in-loop -- Import preserves source order and avoids concurrent writes to the same vault scope. */
        for (const item of input) await saveVaultItem(ctx.scope, item);
        /* oxlint-enable eslint/no-await-in-loop */
      }),
    remove: protectedProcedure
      .input(z.object({ id: z.string().min(1) }))
      .mutation(({ ctx, input }) => deleteVaultItem(ctx.scope, input.id)),
  },
  models: {
    list: protectedProcedure.query(readModelCatalog),
  },
});

export type AppRouter = typeof appRouter;

async function readModelCatalog() {
  const { models } = await gateway.getAvailableModels();

  return z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        ownedBy: z.string(),
        pricing: z
          .object({
            input: z.number().nonnegative().optional(),
            output: z.number().nonnegative().optional(),
          })
          .optional(),
      })
    )
    .parse(
      models
        .filter((model) => model.modelType === "language")
        .map((model) => ({
          id: model.id,
          name: model.name,
          ownedBy: model.specification.provider,
          pricing: model.pricing
            ? {
                input: perMillion(model.pricing.input),
                output: perMillion(model.pricing.output),
              }
            : undefined,
        }))
    );
}

function perMillion(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed * 1_000_000 : undefined;
}
