import { Effect } from "effect";
import type { DynamicResolveContext } from "eve/tools";
import type { ExecutorCatalog, ExecutorToolGroup } from "./definition";
import { resolveModeValue } from "@agent/lib/mode";
import { workspaceActorFromPrincipal } from "../workspaces/access";
import { readWorkspaceCapabilities } from "../workspaces/capabilities";
import artifacts from "./tools/artifacts";
import calendar from "./tools/calendar";
import contacts from "./tools/contacts";
import network from "./tools/network";
import device from "./tools/device-auth";
import gmail from "./tools/gmail";
import ontology from "./tools/ontology";
import personalMemory from "./tools/personal-memory";
import schedules from "./tools/schedules";
import vault from "./tools/vault";
import whatsapp from "./tools/whatsapp";
import webFetch from "./tools/web_fetch";
import workspace from "./tools/workspace";
import { resolveBrowserTools } from "./browser/catalog";
import { ExecutorCatalogError } from "./errors";
import { resolveWorkspaceTools } from "./workspace";
import { resolveCustomerTools } from "./customer-tools";

export type ExecutorSurface = "coordinator" | "browser";

const modules: readonly {
  events: {
    "turn.started"?: (
      event: Parameters<
        NonNullable<(typeof artifacts.events)["turn.started"]>
      >[0],
      context: DynamicResolveContext
    ) => ExecutorToolGroup | null | Promise<ExecutorToolGroup | null>;
  };
}[] = [
  artifacts,
  calendar,
  contacts,
  network,
  device,
  gmail,
  ontology,
  personalMemory,
  schedules,
  vault,
  whatsapp,
  workspace,
];

// Code may compose reads; each write gets its own durable Eve call and operation ID.
// This is an explicit allowlist, never a guess from an API verb or tool name.
export const codeReadableTools = new Set([
  "network-bots",
  "network-result",
  "workspace.tools.connections",
  "gmail-search",
  "gmail-read-thread",
  "calendar-list-events",
  "calendar-check-availability",
  "contacts-search",
  "schedules-list",
  "artifacts-list",
  "artifacts-read",
  "device-auth-status",
  "personal-memory-inspect",
  "web_fetch",
  "workspace.files.list",
  "workspace.files.read",
  "workspace.files.search",
  "workspace.memory.search",
  "workspace.ontology.read",
  "workspace.google.mail.search",
  "workspace.google.calendar.list",
  "workspace.google.contacts.search",
  "whatsapp-list-chats",
  "whatsapp-read-messages",
]);

export const resolveExecutorTools = Effect.fn("Executor.resolveTools")(
  function* (
    context: DynamicResolveContext,
    surface: ExecutorSurface = "coordinator"
  ) {
    if (surface === "browser") return yield* resolveBrowserTools(context);
    const principal =
      context.session.auth.current ?? context.session.auth.initiator;
    if (!principal)
      return yield* new ExecutorCatalogError({ reason: "unavailable" });
    // Scheduled result turns have a lease-bound reporting identity, not a user workspace.
    const reporting =
      resolveModeValue(context, { "scheduled-report": true }) === true;
    const capabilities = reporting
      ? null
      : yield* readWorkspaceCapabilities(
          yield* workspaceActorFromPrincipal(principal)
        );
    const groups = yield* Effect.forEach(modules, (module) =>
      Effect.tryPromise({
        try: async () =>
          module.events["turn.started"]?.(undefined, context) ?? {},
        catch: () => new ExecutorCatalogError({ reason: "unavailable" }),
      })
    );
    const fetchTool = yield* Effect.tryPromise({
      try: async () => webFetch.events["turn.started"]?.(undefined, context),
      catch: () => new ExecutorCatalogError({ reason: "unavailable" }),
    });
    const tools: ExecutorCatalog = Object.fromEntries<ExecutorCatalog[string]>([
      ...Object.entries<ExecutorCatalog[string]>(
        reporting ? {} : yield* resolveCustomerTools(context)
      ),
      ...Object.entries(reporting ? {} : yield* resolveWorkspaceTools(context)),
      ...groups.flatMap((group) =>
        Object.entries(group ?? {}).flatMap(([name, tool]) =>
          tool ? [[name, tool] as const] : []
        )
      ),
      ...(fetchTool ? [["web_fetch", fetchTool] as const] : []),
    ]);
    return Object.fromEntries(
      Object.entries(tools).filter(([name]) => {
        if (/^(gmail-|calendar-|contacts-)/u.test(name))
          return capabilities?.enabled.includes("google") === true;
        if (name === "ontology-action")
          return capabilities?.enabled.includes("ontology") === true;
        return true;
      })
    );
  }
);
