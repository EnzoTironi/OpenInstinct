import { accessScopeForUser } from "@shared/identity/access-scope";
import type { DynamicResolveContext } from "eve";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import type { isScheduledAgentRunLeaseActive } from "@db/services/scheduled-agent-run-leases";
import type { workspaceActorFromPrincipal } from "../../server/workspaces/access";
import type { getGatewayModel } from "@db/services/settings";

const services = vi.hoisted(() => ({
  getModel: vi.fn<typeof getGatewayModel>(),
  isActive: vi.fn<typeof isScheduledAgentRunLeaseActive>(),
  resolveActor:
    vi.fn<
      (
        principal: Parameters<typeof workspaceActorFromPrincipal>[0]
      ) => Effect.Effect<
        Effect.Success<ReturnType<typeof workspaceActorFromPrincipal>>,
        Error
      >
    >(),
}));

vi.mock("@db/services/scheduled-agent-run-leases", () => ({
  isScheduledAgentRunLeaseActive: services.isActive,
}));
vi.mock("@db/services/settings", () => ({
  getGatewayModel: services.getModel,
}));
vi.mock("../../server/workspaces/access", () => ({
  workspaceActorFromPrincipal: services.resolveActor,
}));
vi.mock("../../server/runtime", async () => {
  const { Effect: runtimeEffect } = await import("effect");
  return { serverRuntime: { runPromise: runtimeEffect.runPromise } };
});

import agent from "@agent/agent";

const runId = "00000000-0000-4000-8000-000000000001";
const oldLeaseToken = "00000000-0000-4000-8000-000000000002";
const retryLeaseToken = "00000000-0000-4000-8000-000000000003";

beforeEach(() => {
  vi.clearAllMocks();
  services.getModel.mockResolvedValue("openai/gpt-5.6-sol-fast");
  services.resolveActor.mockReturnValue(
    Effect.succeed({
      ...accessScopeForUser("user-1"),
      role: "owner",
      organizationId: null,
    })
  );
});

describe("root agent model resolution", () => {
  it("accepts a valid retry lease forwarded into an older Eve session", async () => {
    services.isActive.mockImplementation(async (_runId, leaseToken) => {
      return leaseToken === retryLeaseToken;
    });

    const model = await agent.model.events["step.started"]?.(
      {},
      scheduledWorkerContext()
    );

    expect(services.isActive).toHaveBeenCalledExactlyOnceWith(
      runId,
      retryLeaseToken
    );
    expect(services.getModel).toHaveBeenCalledExactlyOnceWith({
      userId: "user-1",
      workspaceId: accessScopeForUser("user-1").workspaceId,
    });
    expect(model).toBe("openai/gpt-5.6-sol-fast");
    expect(services.resolveActor).toHaveBeenCalledExactlyOnceWith(
      scheduledWorkerContext().session.auth.current
    );
  });

  it("rejects a scheduled worker after its lease is replaced", async () => {
    services.isActive.mockResolvedValue(false);

    await expect(
      agent.model.events["step.started"]?.({}, scheduledWorkerContext())
    ).rejects.toThrow("The scheduled run lease is no longer active.");
    expect(services.getModel).not.toHaveBeenCalled();
    expect(services.resolveActor).not.toHaveBeenCalled();
  });

  it("rejects a valid lease when workspace access was revoked", async () => {
    services.isActive.mockResolvedValue(true);
    services.resolveActor.mockReturnValue(
      Effect.fail(new Error("Workspace access was revoked"))
    );
    await expect(
      agent.model.events["step.started"]?.({}, scheduledWorkerContext())
    ).rejects.toThrow("Workspace access was revoked");
    expect(services.getModel).not.toHaveBeenCalled();
  });
});

function scheduledWorkerContext(): DynamicResolveContext {
  return {
    channel: { kind: "http" },
    messages: [],
    session: {
      auth: {
        current: {
          attributes: {
            scheduledRunId: runId,
            scheduledRunLeaseToken: retryLeaseToken,
            workspaceId: accessScopeForUser("user-1").workspaceId,
          },
          authenticator: "scheduled-worker",
          principalId: "user-1",
          principalType: "user",
        },
        initiator: {
          attributes: {
            scheduledRunId: runId,
            scheduledRunLeaseToken: oldLeaseToken,
            workspaceId: accessScopeForUser("user-1").workspaceId,
          },
          authenticator: "scheduled-worker",
          principalId: "user-1",
          principalType: "user",
        },
      },
      id: "worker-session",
    },
  };
}
