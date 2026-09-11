import { requireWorkerScope } from "@agent/subagents/browser-agent/lib/access";
import * as LiveAuthority from "@agent/subagents/browser-agent/lib/live-authority";
import * as SessionService from "@db/services/sessions";
import { accessScopeForUser } from "@shared/identity/access-scope";
import type { SessionAuthContext } from "eve/context";
import { beforeEach, describe, expect, it, vi } from "vitest";

const isSessionOwnedMock = vi.spyOn(SessionService, "isSessionOwned");

const assertLiveWorkerAuthorityMock = vi.spyOn(
  LiveAuthority,
  "assertLiveWorkerAuthority"
);

beforeEach(() => {
  vi.clearAllMocks();
  isSessionOwnedMock.mockResolvedValue(true);
  assertLiveWorkerAuthorityMock.mockResolvedValue(undefined);
});

describe("worker access", () => {
  it("allows an internal child turn only when its worker and root sessions are owned", async () => {
    const principal = principalFor("better-auth:alice");
    await expect(
      requireWorkerScope({
        session: workerSession({ current: null, initiator: principal }),
      })
    ).resolves.toEqual(accessScopeForUser(principal.principalId));

    expect(isSessionOwnedMock).toHaveBeenCalledTimes(2);
    expect(isSessionOwnedMock).toHaveBeenNthCalledWith(
      1,
      accessScopeForUser(principal.principalId),
      "worker-session"
    );
    expect(isSessionOwnedMock).toHaveBeenNthCalledWith(
      2,
      accessScopeForUser(principal.principalId),
      "root-session"
    );
    expect(assertLiveWorkerAuthorityMock).toHaveBeenCalledExactlyOnceWith(
      principal
    );
  });

  it("rejects direct use and unowned worker lineage", async () => {
    const principal = principalFor("better-auth:alice");
    const session = workerSession({ current: principal, initiator: principal });

    await expect(
      requireWorkerScope({ session: { ...session, parent: undefined } })
    ).rejects.toThrow("require a delegated worker");

    isSessionOwnedMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(requireWorkerScope({ session })).rejects.toThrow(
      "does not own this worker session"
    );
    expect(assertLiveWorkerAuthorityMock).not.toHaveBeenCalled();
  });

  it("denies sensitive vault access after channel revoke even when ownership remains", async () => {
    const principal = principalFor("better-auth:alice", {
      authenticator: "verified-channel",
      attributes: {
        channelIdentityId: "11111111-1111-4111-8111-111111111111",
        conversationChannel: "telegram",
        conversationId: "11111111-1111-4111-8111-111111111111",
        workspaceId: accessScopeForUser("better-auth:alice").workspaceId,
      },
    });

    assertLiveWorkerAuthorityMock.mockRejectedValueOnce(
      new Error("The caller's channel authority has been revoked.")
    );

    await expect(
      requireWorkerScope({
        session: workerSession({ current: principal, initiator: principal }),
      })
    ).rejects.toThrow("channel authority has been revoked");
    expect(isSessionOwnedMock).toHaveBeenCalled();
    expect(assertLiveWorkerAuthorityMock).toHaveBeenCalledExactlyOnceWith(
      principal
    );
  });

  it("denies sensitive vault access after schedule pause even when ownership remains", async () => {
    const principal = principalFor("better-auth:alice", {
      authenticator: "scheduled-worker",
      attributes: {
        channelIdentityId: "11111111-1111-4111-8111-111111111111",
        conversationChannel: "telegram",
        conversationId: "11111111-1111-4111-8111-111111111111",
        scheduleId: "22222222-2222-4222-8222-222222222222",
        scheduledRunId: "33333333-3333-4333-8333-333333333333",
        scheduledRunLeaseToken: "44444444-4444-4444-8444-444444444444",
        workspaceId: accessScopeForUser("better-auth:alice").workspaceId,
      },
    });

    assertLiveWorkerAuthorityMock.mockRejectedValueOnce(
      new Error("The scheduled job is no longer active.")
    );

    await expect(
      requireWorkerScope({
        session: workerSession({ current: null, initiator: principal }),
      })
    ).rejects.toThrow("scheduled job is no longer active");
    expect(assertLiveWorkerAuthorityMock).toHaveBeenCalledExactlyOnceWith(
      principal
    );
  });
});

function principalFor(
  userId: string,
  overrides: {
    authenticator?: string;
    attributes?: SessionAuthContext["attributes"];
  } = {}
) {
  return {
    attributes: {
      workspaceId: accessScopeForUser(userId).workspaceId,
      ...overrides.attributes,
    },
    authenticator: overrides.authenticator ?? "test",
    principalId: userId,
    principalType: "user",
  } as const;
}

function workerSession(auth: {
  current: ReturnType<typeof principalFor> | null;
  initiator: ReturnType<typeof principalFor> | null;
}) {
  return {
    auth,
    id: "worker-session",
    parent: {
      callId: "worker-call",
      rootSessionId: "root-session",
      sessionId: "root-session",
      turn: { id: "root-turn", sequence: 0 },
    },
    turn: { id: "worker-turn", sequence: 0 },
  };
}
