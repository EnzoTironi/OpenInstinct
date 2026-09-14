import { Effect } from "effect";
import type { DynamicResolveContext } from "eve/tools";
import type { ExecutorCatalog } from "../definition";
import { ExecutorCatalogError } from "../errors";
import { requireWorkerScope } from "@agent/subagents/browser-agent/lib/access";
import manageBrowsers from "./manage_browsers";
import computerAction from "./computer_action";
import captureImage from "./capture_browser_image";
import fillVault from "./fill_from_vault";
import listVault from "./list_vault";
import semantic from "./semantic_browser";

export const resolveBrowserTools = Effect.fn("Executor.resolveBrowserTools")(
  function* (context: DynamicResolveContext) {
    yield* Effect.tryPromise({
      try: () => requireWorkerScope(context),
      catch: () => new ExecutorCatalogError({ reason: "unavailable" }),
    });
    const browser = yield* Effect.tryPromise({
      try: async () => semantic.events["session.started"]?.(undefined, context),
      catch: () => new ExecutorCatalogError({ reason: "unavailable" }),
    });
    const tools: ExecutorCatalog = {
      manage_browsers: manageBrowsers,
      computer_action: computerAction,
      capture_browser_image: captureImage,
      fill_from_vault: fillVault,
      list_vault: listVault,
      ...browser,
    };
    return tools;
  }
);
