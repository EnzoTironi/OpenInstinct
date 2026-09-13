import { TRPCError } from "@trpc/server";
import { Effect } from "effect";
import { serverRuntime } from "../../server/runtime";
import { resolveWorkspaceActor } from "../../server/workspaces/session";
import { protectedProcedure } from "./init";

export const workspaceProcedure = protectedProcedure.use(
  async ({ ctx, next }) => {
    const actor = await serverRuntime.runPromise(
      resolveWorkspaceActor(ctx.requestHeaders).pipe(
        Effect.catchTag("WorkspaceAccessDenied", () =>
          Effect.fail(new TRPCError({ code: "FORBIDDEN" }))
        )
      )
    );
    return next({ ctx: { actor } });
  }
);
