import { type BillingPlanId, quotaLimitsForPlan } from "@shared/billing/plans";
import { Effect, Schema, Match } from "effect";

/**
 * Release-1 self-host minimum quotas (P11 admission).
 * Callers supply observed usage; over-limit work fails closed with
 * QuotaAdmissionError reason "exceeded". Media attachment caps remain in
 * server/channels/media/policy.ts.
 */
export const release1QuotaLimits = {
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
} as const;

export interface Release1QuotaLimits {
  user: {
    concurrentTurns: number;
    dailyModelTokens: number;
    dailyToolCalls: number;
    dailyProactiveMessages: number;
    storageBytes: number;
    sandboxActiveSecondsPerDay: number;
  };
  installation: {
    concurrentTurns: number;
    dailyModelTokens: number;
    activeUsersPerDay: number;
  };
}

/** Resolve admission limits for a hosted entitlement plan (defaults Free). */
export function admissionLimitsForPlan(
  plan: BillingPlanId = "free",
  seatCount = 1
): Release1QuotaLimits {
  const limits = quotaLimitsForPlan(plan, seatCount);

  return {
    user: { ...limits.user },
    installation: { ...limits.installation },
  };
}

const quotaResourceSchema = Schema.Literals([
  "concurrent_turns",
  "model_tokens",
  "tool_calls",
  "proactive_messages",
  "storage_bytes",
  "sandbox_seconds",
  "active_users",
]);

type QuotaResource = typeof quotaResourceSchema.Type;

const quotaScopeSchema = Schema.Literals(["user", "installation"]);

type QuotaScope = typeof quotaScopeSchema.Type;

const nonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const quotaUsageStruct = Schema.Struct({
  user: Schema.Struct({
    concurrentTurns: nonNegativeInt,
    dailyModelTokens: nonNegativeInt,
    dailyToolCalls: nonNegativeInt,
    dailyProactiveMessages: nonNegativeInt,
    storageBytes: nonNegativeInt,
    sandboxActiveSecondsPerDay: nonNegativeInt,
  }),
  installation: Schema.Struct({
    concurrentTurns: nonNegativeInt,
    dailyModelTokens: nonNegativeInt,
    activeUsersPerDay: nonNegativeInt,
  }),
});

const decodeEffect_quotaUsageStruct =
  Schema.decodeUnknownEffect(quotaUsageStruct);

export interface QuotaUsage {
  user: {
    concurrentTurns: number;
    dailyModelTokens: number;
    dailyToolCalls: number;
    dailyProactiveMessages: number;
    storageBytes: number;
    sandboxActiveSecondsPerDay: number;
  };
  installation: {
    concurrentTurns: number;
    dailyModelTokens: number;
    activeUsersPerDay: number;
  };
}

const quotaDemandStruct = Schema.Struct({
  concurrentTurns: Schema.optionalKey(nonNegativeInt),
  modelTokens: Schema.optionalKey(nonNegativeInt),
  toolCalls: Schema.optionalKey(nonNegativeInt),
  proactiveMessages: Schema.optionalKey(nonNegativeInt),
  storageBytes: Schema.optionalKey(nonNegativeInt),
  sandboxSeconds: Schema.optionalKey(nonNegativeInt),
  /** 1 when admitting work for a user not yet counted in today's active set. */
  activeUser: Schema.optionalKey(Schema.Literals([0, 1])),
});

const decodeQuotaDemandStruct = Schema.decodeUnknownEffect(quotaDemandStruct);

export interface QuotaDemand {
  concurrentTurns?: number;
  modelTokens?: number;
  toolCalls?: number;
  proactiveMessages?: number;
  storageBytes?: number;
  sandboxSeconds?: number;
  activeUser?: 0 | 1;
}

export class QuotaAdmissionError extends Schema.TaggedError<QuotaAdmissionError>()(
  "QuotaAdmissionError",
  {
    reason: Schema.Literals(["exceeded", "invalid_input"]),
    scope: Schema.optionalKey(quotaScopeSchema),
    resource: Schema.optionalKey(quotaResourceSchema),
    limit: Schema.optionalKey(Schema.Number),
    used: Schema.optionalKey(Schema.Number),
    requested: Schema.optionalKey(Schema.Number),
  }
) {}

const quotaResourceUnits = {
  model_tokens: "model tokens",
  tool_calls: "tool calls",
  proactive_messages: "proactive messages",
  storage_bytes: "bytes of storage",
  sandbox_seconds: "sandbox active seconds",
  active_users: "active users",
  concurrent_turns: "concurrent turns",
} as const satisfies Record<QuotaResource, string>;

const quotaResourceHorizons = {
  model_tokens: "for today",
  tool_calls: "for today",
  proactive_messages: "for today",
  storage_bytes: "for this account",
  sandbox_seconds: "for today",
  active_users: "for today",
  concurrent_turns: "right now",
} as const satisfies Record<QuotaResource, string>;

export function quotaFailureMessage(error: QuotaAdmissionError) {
  if (error.reason === "invalid_input") {
    return "Quota admission rejected invalid usage or demand input.";
  }

  return formatQuotaLimitMessage(error);
}

function formatQuotaLimitMessage(error: QuotaAdmissionError) {
  const resource = error.resource ?? "concurrent_turns";
  const scope = error.scope ?? "user";
  const used = error.used ?? 0;
  const limit = error.limit ?? 0;
  const requested = error.requested ?? 0;
  const unit = quotaResourceUnits[resource];

  const horizon = quotaResourceHorizons[resource];

  return `This ${scope} has reached its ${unit} limit ${horizon} (${String(used)} used of ${String(limit)}; requested ${String(requested)}). Try again later, upgrade at /pricing, or ask the operator to raise quotas.`;
}

interface Check {
  scope: QuotaScope;
  resource: QuotaResource;
  used: number;
  requested: number;
  limit: number;
}

function checks(
  limits: Release1QuotaLimits,
  usage: QuotaUsage,
  demand: QuotaDemand
): Check[] {
  return [
    ...concurrentTurnChecks(limits, usage, demand),
    ...modelTokenChecks(limits, usage, demand),
    ...toolCallChecks(limits, usage, demand),
    ...proactiveMessageChecks(limits, usage, demand),
    ...storageByteChecks(limits, usage, demand),
    ...sandboxSecondChecks(limits, usage, demand),
    ...activeUserChecks(limits, usage, demand),
  ];
}

function concurrentTurnChecks(
  limits: Release1QuotaLimits,
  usage: QuotaUsage,
  demand: QuotaDemand
): Check[] {
  if (demand.concurrentTurns === undefined) return [];

  const requested = demand.concurrentTurns;

  return [
    {
      scope: "user",
      resource: "concurrent_turns",
      used: usage.user.concurrentTurns,
      requested,
      limit: limits.user.concurrentTurns,
    },
    {
      scope: "installation",
      resource: "concurrent_turns",
      used: usage.installation.concurrentTurns,
      requested,
      limit: limits.installation.concurrentTurns,
    },
  ];
}

function modelTokenChecks(
  limits: Release1QuotaLimits,
  usage: QuotaUsage,
  demand: QuotaDemand
): Check[] {
  if (demand.modelTokens === undefined) return [];

  const requested = demand.modelTokens;

  return [
    {
      scope: "user",
      resource: "model_tokens",
      used: usage.user.dailyModelTokens,
      requested,
      limit: limits.user.dailyModelTokens,
    },
    {
      scope: "installation",
      resource: "model_tokens",
      used: usage.installation.dailyModelTokens,
      requested,
      limit: limits.installation.dailyModelTokens,
    },
  ];
}

function toolCallChecks(
  limits: Release1QuotaLimits,
  usage: QuotaUsage,
  demand: QuotaDemand
): Check[] {
  if (demand.toolCalls === undefined) return [];

  return [
    {
      scope: "user",
      resource: "tool_calls",
      used: usage.user.dailyToolCalls,
      requested: demand.toolCalls,
      limit: limits.user.dailyToolCalls,
    },
  ];
}

function proactiveMessageChecks(
  limits: Release1QuotaLimits,
  usage: QuotaUsage,
  demand: QuotaDemand
): Check[] {
  if (demand.proactiveMessages === undefined) return [];

  return [
    {
      scope: "user",
      resource: "proactive_messages",
      used: usage.user.dailyProactiveMessages,
      requested: demand.proactiveMessages,
      limit: limits.user.dailyProactiveMessages,
    },
  ];
}

function storageByteChecks(
  limits: Release1QuotaLimits,
  usage: QuotaUsage,
  demand: QuotaDemand
): Check[] {
  if (demand.storageBytes === undefined) return [];

  return [
    {
      scope: "user",
      resource: "storage_bytes",
      used: usage.user.storageBytes,
      requested: demand.storageBytes,
      limit: limits.user.storageBytes,
    },
  ];
}

function sandboxSecondChecks(
  limits: Release1QuotaLimits,
  usage: QuotaUsage,
  demand: QuotaDemand
): Check[] {
  if (demand.sandboxSeconds === undefined) return [];

  return [
    {
      scope: "user",
      resource: "sandbox_seconds",
      used: usage.user.sandboxActiveSecondsPerDay,
      requested: demand.sandboxSeconds,
      limit: limits.user.sandboxActiveSecondsPerDay,
    },
  ];
}

function activeUserChecks(
  limits: Release1QuotaLimits,
  usage: QuotaUsage,
  demand: QuotaDemand
): Check[] {
  if (demand.activeUser !== 1) return [];

  return [
    {
      scope: "installation",
      resource: "active_users",
      used: usage.installation.activeUsersPerDay,
      requested: 1,
      limit: limits.installation.activeUsersPerDay,
    },
  ];
}

/** Empty usage snapshot for tests and fresh windows. */
export function emptyQuotaUsage(): QuotaUsage {
  return {
    user: {
      concurrentTurns: 0,
      dailyModelTokens: 0,
      dailyToolCalls: 0,
      dailyProactiveMessages: 0,
      storageBytes: 0,
      sandboxActiveSecondsPerDay: 0,
    },
    installation: {
      concurrentTurns: 0,
      dailyModelTokens: 0,
      activeUsersPerDay: 0,
    },
  };
}

function decodeUsage(usage: QuotaUsage) {
  return decodeEffect_quotaUsageStruct(usage).pipe(
    Effect.map((decoded): QuotaUsage => ({
      user: { ...decoded.user },
      installation: { ...decoded.installation },
    })),
    Effect.mapError(() => new QuotaAdmissionError({ reason: "invalid_input" }))
  );
}

function decodeDemand(demand: QuotaDemand) {
  return decodeQuotaDemandStruct(demand).pipe(
    Effect.map((decoded): QuotaDemand => ({ ...decoded })),
    Effect.mapError(() => new QuotaAdmissionError({ reason: "invalid_input" }))
  );
}

/** Fail closed when any demanded resource would exceed its Release-1 limit. */
export const admitQuota = Effect.fn("admitQuota")(function* (
  usage: QuotaUsage,
  demand: QuotaDemand,
  limits: Release1QuotaLimits = admissionLimitsForPlan()
) {
  const decodedUsage = yield* decodeUsage(usage);
  const decodedDemand = yield* decodeDemand(demand);

  yield* Effect.forEach(
    checks(limits, decodedUsage, decodedDemand),
    (check) =>
      check.used + check.requested > check.limit
        ? new QuotaAdmissionError({
            reason: "exceeded",
            scope: check.scope,
            resource: check.resource,
            limit: check.limit,
            used: check.used,
            requested: check.requested,
          })
        : Effect.void,
    { concurrency: 1, discard: true }
  );

  return decodedDemand;
});

/**
 * Apply a reserved demand to a usage snapshot after a successful admit.
 * Concurrent turns and model tokens increment both user and installation.
 */
export function reserveQuota(
  usage: QuotaUsage,
  demand: QuotaDemand
): QuotaUsage {
  const concurrentTurns = demand.concurrentTurns ?? 0;
  const modelTokens = demand.modelTokens ?? 0;
  const toolCalls = demand.toolCalls ?? 0;
  const proactiveMessages = demand.proactiveMessages ?? 0;
  const storageBytes = demand.storageBytes ?? 0;
  const sandboxSeconds = demand.sandboxSeconds ?? 0;
  const activeUser = demand.activeUser === 1 ? 1 : 0;

  return {
    user: {
      concurrentTurns: usage.user.concurrentTurns + concurrentTurns,
      dailyModelTokens: usage.user.dailyModelTokens + modelTokens,
      dailyToolCalls: usage.user.dailyToolCalls + toolCalls,
      dailyProactiveMessages:
        usage.user.dailyProactiveMessages + proactiveMessages,
      storageBytes: usage.user.storageBytes + storageBytes,
      sandboxActiveSecondsPerDay:
        usage.user.sandboxActiveSecondsPerDay + sandboxSeconds,
    },
    installation: {
      concurrentTurns: usage.installation.concurrentTurns + concurrentTurns,
      dailyModelTokens: usage.installation.dailyModelTokens + modelTokens,
      activeUsersPerDay: usage.installation.activeUsersPerDay + activeUser,
    },
  };
}

/** Release a prior concurrent-turn reservation (never below zero). */
export function settleConcurrentTurns(
  usage: QuotaUsage,
  turns: number
): QuotaUsage {
  const release = Math.max(0, turns);

  return {
    user: {
      ...usage.user,
      concurrentTurns: Math.max(0, usage.user.concurrentTurns - release),
    },
    installation: {
      ...usage.installation,
      concurrentTurns: Math.max(
        0,
        usage.installation.concurrentTurns - release
      ),
    },
  };
}
