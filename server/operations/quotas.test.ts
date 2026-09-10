import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  admitQuota,
  emptyQuotaUsage,
  quotaFailureMessage,
  admissionLimitsForPlan,
  release1QuotaLimits,
  reserveQuota,
  settleConcurrentTurns,
  type QuotaUsage,
  QuotaAdmissionError,
} from "./quotas";

describe("Release-1 minimum quota admission", () => {
  it("bridges hosted Free entitlements to Release-1 floors", () => {
    expect(admissionLimitsForPlan("free")).toEqual(release1QuotaLimits);
    expect(admissionLimitsForPlan("pro").user.dailyModelTokens).toBeGreaterThan(
      release1QuotaLimits.user.dailyModelTokens
    );
  });

  it("documents the chosen self-host limits", () => {
    expect(release1QuotaLimits).toEqual({
      user: {
        concurrentTurns: 2,
        dailyModelTokens: 500_000,
        dailyToolCalls: 200,
        dailyProactiveMessages: 24,
        storageBytes: 100 * 1024 * 1024,
        sandboxActiveSecondsPerDay: 900,
      },
      installation: {
        concurrentTurns: 20,
        dailyModelTokens: 5_000_000,
        activeUsersPerDay: 100,
      },
    });
  });

  it("admits work within limits and reserves usage", async () => {
    const usage = emptyQuotaUsage();
    const demand = {
      concurrentTurns: 1,
      modelTokens: 1_000,
      activeUser: 1 as const,
    };
    await expect(Effect.runPromise(admitQuota(usage, demand))).resolves.toEqual(
      demand
    );
    const reserved = reserveQuota(usage, demand);
    expect(reserved.user.concurrentTurns).toBe(1);
    expect(reserved.installation.concurrentTurns).toBe(1);
    expect(reserved.user.dailyModelTokens).toBe(1_000);
    expect(reserved.installation.activeUsersPerDay).toBe(1);
  });

  it("fails closed when a user exceeds concurrent turns", async () => {
    const usage = withUser({ concurrentTurns: 2 });
    const error = await Effect.runPromise(
      admitQuota(usage, { concurrentTurns: 1 }).pipe(Effect.flip)
    );
    expect(error).toEqual(
      new QuotaAdmissionError({
        reason: "exceeded",
        scope: "user",
        resource: "concurrent_turns",
        limit: 2,
        used: 2,
        requested: 1,
      })
    );
    expect(quotaFailureMessage(error)).toContain("concurrent turns");
  });

  it("fails closed when installation concurrent turns would starve fairness", async () => {
    const usage = emptyQuotaUsage();
    usage.installation.concurrentTurns =
      release1QuotaLimits.installation.concurrentTurns;
    const error = await Effect.runPromise(
      admitQuota(usage, { concurrentTurns: 1 }).pipe(Effect.flip)
    );
    expect(error).toMatchObject({
      reason: "exceeded",
      scope: "installation",
      resource: "concurrent_turns",
      limit: release1QuotaLimits.installation.concurrentTurns,
    });
  });

  it("fails closed on daily model-token exhaustion (user then installation)", async () => {
    const atUserCap = withUser({
      dailyModelTokens: release1QuotaLimits.user.dailyModelTokens,
    });
    await expect(
      Effect.runPromise(
        admitQuota(atUserCap, { modelTokens: 1 }).pipe(Effect.flip)
      )
    ).resolves.toMatchObject({
      reason: "exceeded",
      scope: "user",
      resource: "model_tokens",
    });

    const atInstallCap = emptyQuotaUsage();
    atInstallCap.installation.dailyModelTokens =
      release1QuotaLimits.installation.dailyModelTokens;
    await expect(
      Effect.runPromise(
        admitQuota(atInstallCap, { modelTokens: 1 }).pipe(Effect.flip)
      )
    ).resolves.toMatchObject({
      reason: "exceeded",
      scope: "installation",
      resource: "model_tokens",
    });
  });

  it("enforces tool, proactive, storage, sandbox and active-user caps", async () => {
    await expect(
      Effect.runPromise(
        admitQuota(withUser({ dailyToolCalls: 200 }), { toolCalls: 1 }).pipe(
          Effect.flip
        )
      )
    ).resolves.toMatchObject({ resource: "tool_calls", reason: "exceeded" });

    await expect(
      Effect.runPromise(
        admitQuota(withUser({ dailyProactiveMessages: 24 }), {
          proactiveMessages: 1,
        }).pipe(Effect.flip)
      )
    ).resolves.toMatchObject({
      resource: "proactive_messages",
      reason: "exceeded",
    });

    await expect(
      Effect.runPromise(
        admitQuota(withUser({ storageBytes: 100 * 1024 * 1024 }), {
          storageBytes: 1,
        }).pipe(Effect.flip)
      )
    ).resolves.toMatchObject({ resource: "storage_bytes", reason: "exceeded" });

    await expect(
      Effect.runPromise(
        admitQuota(withUser({ sandboxActiveSecondsPerDay: 900 }), {
          sandboxSeconds: 1,
        }).pipe(Effect.flip)
      )
    ).resolves.toMatchObject({
      resource: "sandbox_seconds",
      reason: "exceeded",
    });

    const usage = emptyQuotaUsage();
    usage.installation.activeUsersPerDay = 100;
    await expect(
      Effect.runPromise(admitQuota(usage, { activeUser: 1 }).pipe(Effect.flip))
    ).resolves.toMatchObject({ resource: "active_users", reason: "exceeded" });
  });

  it("settles concurrent-turn reservations without going negative", () => {
    const reserved = reserveQuota(emptyQuotaUsage(), { concurrentTurns: 2 });
    const settled = settleConcurrentTurns(reserved, 2);
    expect(settled.user.concurrentTurns).toBe(0);
    expect(settled.installation.concurrentTurns).toBe(0);
    expect(settleConcurrentTurns(settled, 5).user.concurrentTurns).toBe(0);
  });

  it("rejects invalid usage snapshots as typed Effect errors", async () => {
    await expect(
      Effect.runPromise(
        admitQuota(
          {
            ...emptyQuotaUsage(),
            user: { ...emptyQuotaUsage().user, concurrentTurns: -1 },
          },
          { concurrentTurns: 1 }
        ).pipe(Effect.flip)
      )
    ).resolves.toEqual(new QuotaAdmissionError({ reason: "invalid_input" }));
  });

  it("allows exact fill up to the limit but not beyond", async () => {
    const usage = withUser({ dailyToolCalls: 199 });
    await expect(
      Effect.runPromise(admitQuota(usage, { toolCalls: 1 }))
    ).resolves.toEqual({ toolCalls: 1 });
    await expect(
      Effect.runPromise(admitQuota(usage, { toolCalls: 2 }).pipe(Effect.flip))
    ).resolves.toMatchObject({ reason: "exceeded", used: 199, requested: 2 });
  });
});

function withUser(partial: Partial<QuotaUsage["user"]>): QuotaUsage {
  const usage = emptyQuotaUsage();
  usage.user = { ...usage.user, ...partial };
  return usage;
}
