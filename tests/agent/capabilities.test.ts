import personalInfoMemory from "@agent/memory/personal_info";
import workstreamMemory from "@agent/memory/workstreams";
import browserAgent from "@agent/subagents/browser-agent/agent";
import calendar from "@agent/tools/calendar";
import contacts from "@agent/tools/contacts";
import gmail from "@agent/tools/gmail";
import messaging from "@agent/tools/messaging";
import schedules from "@agent/tools/schedules";
import vault from "@agent/tools/vault";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { Predicate } from "effect";
import type { DynamicResolveContext } from "eve/tools";
import { expect, it } from "vitest";

const groupedTools = [calendar, contacts, gmail, messaging, schedules, vault];

it("gives interactive turns the authored coordinator capabilities", async () => {
  expect(await authoredCapabilities("linq-message")).toEqual([
    "browser-agent",
    "calendar-check-availability",
    "calendar-create-event",
    "calendar-list-events",
    "contacts-search",
    "gmail-read-thread",
    "gmail-search",
    "gmail-send",
    "gmail-update",
    "personal_info__update",
    "react_to_message",
    "request_vault_import",
    "request_vault_setup",
    "schedules-answer",
    "schedules-create",
    "schedules-list",
    "schedules-update",
    "send_message",
    "workstreams__find",
    "workstreams__forget",
    "workstreams__read",
    "workstreams__save",
  ]);
});

it("gives scheduled workers only authored read and execution capabilities", async () => {
  expect(await authoredCapabilities("scheduled-worker")).toEqual([
    "browser-agent",
    "calendar-check-availability",
    "calendar-list-events",
    "contacts-search",
    "gmail-read-thread",
    "gmail-search",
  ]);
});

it("limits authored scheduled reporting tools to delivery or resuming its own run", async () => {
  expect(await authoredCapabilities("scheduled-result")).toEqual([
    "request_vault_setup",
    "schedules-answer",
    "send_message",
  ]);
});

const resolveGroupedDefinition = async (
  definition: (typeof groupedTools)[number],
  context: DynamicResolveContext
) => {
  const resolve = definition.events["turn.started"];
  const resolved = resolve ? await resolve({}, context) : null;

  if (Predicate.isObject(resolved) && !("execute" in resolved))
    return Object.keys(resolved);

  return [];
};

const personalInfoCapabilityNames = async (context: DynamicResolveContext) => {
  const personalInfoTools = await personalInfoMemory.provider.tools({
    ...context,
    memory: {
      scope: {
        key: "personal-info-key",
        namespace: "openinstinct-personal-info-v1",
        value: accessScopeForUser("user-1").workspaceId,
      },
      slot: "personal_info",
    },
    turn: { id: "turn-1", input: [], sequence: 1 },
  });

  if (!personalInfoTools) return [];

  return Object.keys(personalInfoTools).map((name) => `personal_info__${name}`);
};

const workstreamCapabilityNames = async (context: DynamicResolveContext) => {
  const workstreamTools = await workstreamMemory.provider.tools({
    ...context,
    memory: {
      scope: {
        key: "workstreams-key",
        namespace: "workstreams",
        value: "personal:workspace",
      },
      slot: "workstreams",
    },
    turn: { id: "turn-1", input: [], sequence: 1 },
  });

  if (!workstreamTools) return [];

  return Object.keys(workstreamTools).map((name) => `workstreams__${name}`);
};

const browserAgentCapability = async (context: DynamicResolveContext) => {
  const resolveBrowserAgent = browserAgent.events["turn.started"];

  if (!resolveBrowserAgent) return [];

  if (!(await resolveBrowserAgent({}, context))) return [];

  return ["browser-agent"];
};

async function authoredCapabilities(authenticator: string) {
  const context = dynamicContext(authenticator);

  const resolvedGroups = await Promise.all(
    groupedTools.map((definition) =>
      resolveGroupedDefinition(definition, context)
    )
  );

  return [
    ...resolvedGroups.flat(),
    ...(await personalInfoCapabilityNames(context)),
    ...(await workstreamCapabilityNames(context)),
    ...(await browserAgentCapability(context)),
  ].toSorted();
}

function dynamicContext(authenticator: string) {
  return {
    channel: { kind: "channel:linq", metadata: {} },
    messages: [],
    session: {
      auth: {
        current: {
          attributes: { workspaceId: accessScopeForUser("user-1").workspaceId },
          authenticator,
          principalId: "user-1",
          principalType: "user",
        },
        initiator: null,
      },
      id: "session-1",
    },
  } satisfies DynamicResolveContext;
}
