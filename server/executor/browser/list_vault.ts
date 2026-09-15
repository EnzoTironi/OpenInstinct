import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireWorkerScope } from "@agent/subagents/browser-agent/lib/access";
import { serverRuntime } from "../../runtime";
import { listDelegatedVaultItems } from "../../workspaces/vault";

export default defineTool({
  description:
    "List safe metadata and opaque handles for saved logins, payment methods, contact or traveler details, and addresses that the current workspace agent is allowed to fill. Check this before declaring that routine form information is missing. Never returns secret values.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const items = await serverRuntime.runPromise(
      listDelegatedVaultItems(await requireWorkerScope(ctx)),
      { signal: ctx.abortSignal }
    );
    return items;
  },
});
