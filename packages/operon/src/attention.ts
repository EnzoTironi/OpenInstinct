import { Clock, Effect, Schema } from "effect";

import { actionHostBindingSchema, type ActionHostBinding } from "./catalog";
import { generatePrefixedId } from "./types";

const requiredId = Schema.String.check(Schema.isMinLength(1));
const decodeScope = Schema.decodeUnknownEffect(actionHostBindingSchema);
const parseOptions = { onExcessProperty: "error" } as const;
const nonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const positiveInt = Schema.Int.check(Schema.isGreaterThan(0));

export const attentionChannelSchema = Schema.Literals([
  "telegram",
  "web",
  "whatsapp",
]);
export type AttentionChannel = typeof attentionChannelSchema.Type;

export const noticeKindSchema = Schema.Literals([
  "explicit_delivery",
  "optional",
  "urgent",
]);
export type NoticeKind = typeof noticeKindSchema.Type;

export const noticeStatusSchema = Schema.Literals([
  "cancelled",
  "delivered",
  "pending",
  "suppressed",
]);
export type NoticeStatus = typeof noticeStatusSchema.Type;

const budgetAdmissionSchema = Schema.Struct({
  limit: nonNegativeInt,
});

const reserveAdmissionSchema = Schema.Struct({
  units: positiveInt,
});

const settleAdmissionSchema = Schema.Struct({
  actual: nonNegativeInt,
});

const noticeAdmissionSchema = Schema.Struct({
  channel: attentionChannelSchema,
  eventKey: requiredId,
  kind: noticeKindSchema,
  quietHours: Schema.Boolean,
  sourceVisible: Schema.Boolean,
});
export type NoticeAdmission = typeof noticeAdmissionSchema.Type;

const destinationAudienceSchema = Schema.Struct({
  channel: attentionChannelSchema,
  userId: requiredId,
});
export type DestinationAudience = typeof destinationAudienceSchema.Type;

const childAudienceSchema = Schema.Struct({
  userId: requiredId,
});

export class AttentionRejected extends Schema.TaggedError<AttentionRejected>()(
  "AttentionRejected",
  {
    reason: Schema.Literals([
      "budget_exhausted",
      "grant_revoked",
      "invalid_parameter",
      "invalid_scope",
      "notice_missing",
    ]),
    remaining: nonNegativeInt,
  }
) {}

interface StoredReservation {
  readonly id: string;
  readonly settled: boolean;
  readonly units: number;
}

interface HostBudget {
  readonly remaining: number;
  readonly reservations: Map<string, StoredReservation>;
}

interface StoredNotice {
  readonly channel: AttentionChannel;
  readonly eventKey: string;
  readonly id: string;
  readonly kind: NoticeKind;
  readonly status: NoticeStatus;
  readonly userId: string;
  readonly workspaceId: string;
}

interface AttentionState {
  readonly budgets: Map<string, HostBudget>;
  readonly grants: Map<string, true>;
  readonly notices: Map<string, StoredNotice>;
  readonly paused: Map<string, true>;
  readonly pendingByEvent: Map<string, string>;
}

function reject(reason: AttentionRejected["reason"], remaining: number) {
  return new AttentionRejected({ reason, remaining });
}

function scopeKey(scope: ActionHostBinding): string {
  return `${scope.workspaceId}\0${scope.userId}`;
}

function recordKey(scope: ActionHostBinding, id: string): string {
  return `${scopeKey(scope)}\0${id}`;
}

function grantKey(scope: ActionHostBinding, channel: AttentionChannel): string {
  return `${scopeKey(scope)}\0${channel}`;
}

const requireHost = Effect.fn("InMemoryAttention.requireHost")(function* (
  scope: ActionHostBinding
) {
  return yield* decodeScope(scope).pipe(
    Effect.mapError(() => reject("invalid_scope", 0))
  );
});

function hostRemaining(state: AttentionState, host: ActionHostBinding) {
  return state.budgets.get(scopeKey(host))?.remaining ?? 0;
}

function requireNotice(
  state: AttentionState,
  host: ActionHostBinding,
  noticeId: string
) {
  const notice = state.notices.get(recordKey(host, noticeId));
  if (
    !notice ||
    notice.userId !== host.userId ||
    notice.workspaceId !== host.workspaceId
  ) {
    return reject("notice_missing", hostRemaining(state, host));
  }
  return notice;
}

function requireGrant(
  state: AttentionState,
  host: ActionHostBinding,
  channel: AttentionChannel
) {
  if (!state.grants.has(grantKey(host, channel))) {
    return reject("grant_revoked", hostRemaining(state, host));
  }
  return channel;
}

const setBudgetImpl = Effect.fn("InMemoryAttention.setBudget")(function* (
  state: AttentionState,
  scope: ActionHostBinding,
  encoded: Schema.Json
) {
  const host = yield* requireHost(scope);
  const admission = yield* Schema.decodeUnknownEffect(
    budgetAdmissionSchema,
    parseOptions
  )(encoded).pipe(
    Effect.mapError(() =>
      reject("invalid_parameter", hostRemaining(state, host))
    )
  );
  state.budgets.set(scopeKey(host), {
    remaining: admission.limit,
    reservations: new Map(),
  });
  return { remaining: admission.limit };
});

const reserveImpl = Effect.fn("InMemoryAttention.reserve")(function* (
  state: AttentionState,
  scope: ActionHostBinding,
  encoded: Schema.Json
) {
  const host = yield* requireHost(scope);
  const remaining = hostRemaining(state, host);
  const admission = yield* Schema.decodeUnknownEffect(
    reserveAdmissionSchema,
    parseOptions
  )(encoded).pipe(
    Effect.mapError(() => reject("invalid_parameter", remaining))
  );
  const budget = state.budgets.get(scopeKey(host));
  if (!budget || budget.remaining < admission.units) {
    return yield* reject("budget_exhausted", remaining);
  }
  const recordedAt = yield* Clock.currentTimeMillis;
  const id = generatePrefixedId("rsv", recordedAt);
  const nextRemaining = budget.remaining - admission.units;
  budget.reservations.set(id, { id, settled: false, units: admission.units });
  state.budgets.set(scopeKey(host), {
    remaining: nextRemaining,
    reservations: budget.reservations,
  });
  return { id, remaining: nextRemaining };
});

const settleImpl = Effect.fn("InMemoryAttention.settle")(function* (
  state: AttentionState,
  scope: ActionHostBinding,
  reservationId: string,
  encoded: Schema.Json
) {
  const host = yield* requireHost(scope);
  const remaining = hostRemaining(state, host);
  const admission = yield* Schema.decodeUnknownEffect(
    settleAdmissionSchema,
    parseOptions
  )(encoded).pipe(
    Effect.mapError(() => reject("invalid_parameter", remaining))
  );
  const budget = state.budgets.get(scopeKey(host));
  const reservation = budget?.reservations.get(reservationId);
  if (!budget || !reservation) {
    return yield* reject("invalid_parameter", remaining);
  }
  if (admission.actual > reservation.units) {
    return yield* reject("invalid_parameter", remaining);
  }
  if (reservation.settled) {
    return { remaining: budget.remaining };
  }
  const refund = reservation.units - admission.actual;
  const nextRemaining = budget.remaining + refund;
  budget.reservations.set(reservationId, { ...reservation, settled: true });
  state.budgets.set(scopeKey(host), {
    remaining: nextRemaining,
    reservations: budget.reservations,
  });
  return { remaining: nextRemaining };
});

const authorizeChannelImpl = Effect.fn("InMemoryAttention.authorizeChannel")(
  function* (
    state: AttentionState,
    scope: ActionHostBinding,
    channel: AttentionChannel
  ) {
    const host = yield* requireHost(scope);
    const decoded = yield* Schema.decodeUnknownEffect(attentionChannelSchema)(
      channel
    ).pipe(
      Effect.mapError(() =>
        reject("invalid_parameter", hostRemaining(state, host))
      )
    );
    state.grants.set(grantKey(host, decoded), true);
    return decoded;
  }
);

const revokeChannelImpl = Effect.fn("InMemoryAttention.revokeChannel")(
  function* (
    state: AttentionState,
    scope: ActionHostBinding,
    channel: AttentionChannel
  ) {
    const host = yield* requireHost(scope);
    const decoded = yield* Schema.decodeUnknownEffect(attentionChannelSchema)(
      channel
    ).pipe(
      Effect.mapError(() =>
        reject("invalid_parameter", hostRemaining(state, host))
      )
    );
    state.grants.delete(grantKey(host, decoded));
    return decoded;
  }
);

const pauseImpl = Effect.fn("InMemoryAttention.pause")(function* (
  state: AttentionState,
  scope: ActionHostBinding
) {
  const host = yield* requireHost(scope);
  state.paused.set(scopeKey(host), true);
  return { paused: true as const };
});

const resumeImpl = Effect.fn("InMemoryAttention.resume")(function* (
  state: AttentionState,
  scope: ActionHostBinding
) {
  const host = yield* requireHost(scope);
  state.paused.delete(scopeKey(host));
  return { paused: false as const };
});

function recordNotice(
  state: AttentionState,
  host: ActionHostBinding,
  admission: NoticeAdmission,
  status: NoticeStatus,
  id: string
) {
  const notice: StoredNotice = {
    channel: admission.channel,
    eventKey: admission.eventKey,
    id,
    kind: admission.kind,
    status,
    userId: host.userId,
    workspaceId: host.workspaceId,
  };
  state.notices.set(recordKey(host, id), notice);
  if (status === "pending") {
    state.pendingByEvent.set(recordKey(host, admission.eventKey), id);
  }
  return notice;
}

const assessImpl = Effect.fn("InMemoryAttention.assess")(function* (
  state: AttentionState,
  scope: ActionHostBinding,
  encoded: Schema.Json
) {
  const host = yield* requireHost(scope);
  const remaining = hostRemaining(state, host);
  const admission = yield* Schema.decodeUnknownEffect(
    noticeAdmissionSchema,
    parseOptions
  )(encoded).pipe(
    Effect.mapError(() => reject("invalid_parameter", remaining))
  );
  if (state.paused.has(scopeKey(host))) {
    return { kind: "paused" as const };
  }
  const granted = requireGrant(state, host, admission.channel);
  if (granted instanceof AttentionRejected) {
    return yield* granted;
  }
  const recordedAt = yield* Clock.currentTimeMillis;
  switch (admission.kind) {
    case "optional": {
      if (admission.sourceVisible) {
        const notice = recordNotice(
          state,
          host,
          admission,
          "suppressed",
          generatePrefixedId("ntc", recordedAt)
        );
        return { kind: "suppressed" as const, noticeId: notice.id };
      }
      if (admission.quietHours) {
        const pendingId = state.pendingByEvent.get(
          recordKey(host, admission.eventKey)
        );
        if (pendingId !== undefined) {
          const pending = state.notices.get(recordKey(host, pendingId));
          if (pending?.status === "pending") {
            return { kind: "coalesced" as const, noticeId: pending.id };
          }
        }
        const notice = recordNotice(
          state,
          host,
          admission,
          "pending",
          generatePrefixedId("ntc", recordedAt)
        );
        return { kind: "pending" as const, noticeId: notice.id };
      }
      const notice = recordNotice(
        state,
        host,
        admission,
        "delivered",
        generatePrefixedId("ntc", recordedAt)
      );
      return { kind: "delivered" as const, noticeId: notice.id };
    }
    case "explicit_delivery":
    case "urgent": {
      const notice = recordNotice(
        state,
        host,
        admission,
        "delivered",
        generatePrefixedId("ntc", recordedAt)
      );
      return { kind: "delivered" as const, noticeId: notice.id };
    }
    default: {
      const exhaustive: never = admission.kind;
      return exhaustive;
    }
  }
});

const cancelImpl = Effect.fn("InMemoryAttention.cancel")(function* (
  state: AttentionState,
  scope: ActionHostBinding,
  noticeId: string
) {
  const host = yield* requireHost(scope);
  const current = requireNotice(state, host, noticeId);
  if (current instanceof AttentionRejected) {
    return yield* current;
  }
  switch (current.status) {
    case "cancelled":
      return current;
    case "pending": {
      const cancelled: StoredNotice = { ...current, status: "cancelled" };
      state.notices.set(recordKey(host, noticeId), cancelled);
      const eventKey = recordKey(host, current.eventKey);
      if (state.pendingByEvent.get(eventKey) === noticeId) {
        state.pendingByEvent.delete(eventKey);
      }
      return cancelled;
    }
    case "delivered":
    case "suppressed":
      return yield* reject("invalid_parameter", hostRemaining(state, host));
    default: {
      const exhaustive: never = current.status;
      return exhaustive;
    }
  }
});

const selectDestinationsImpl = Effect.fn(
  "InMemoryAttention.selectDestinations"
)(function* (
  state: AttentionState,
  scope: ActionHostBinding,
  encoded: Schema.Json
) {
  const host = yield* requireHost(scope);
  const remaining = hostRemaining(state, host);
  const audience = yield* Schema.decodeUnknownEffect(
    destinationAudienceSchema,
    parseOptions
  )(encoded).pipe(
    Effect.mapError(() => reject("invalid_parameter", remaining))
  );
  if (audience.userId !== host.userId) {
    return yield* reject("invalid_parameter", remaining);
  }
  const granted = requireGrant(state, host, audience.channel);
  if (granted instanceof AttentionRejected) {
    return yield* granted;
  }
  return { destinations: [audience.channel] as const };
});

export const projectChildDelivery = Effect.fn("projectChildDelivery")(
  function* (scope: ActionHostBinding, encoded: Schema.Json) {
    const host = yield* requireHost(scope);
    const audience = yield* Schema.decodeUnknownEffect(
      childAudienceSchema,
      parseOptions
    )(encoded).pipe(Effect.mapError(() => reject("invalid_parameter", 0)));
    if (audience.userId !== host.userId) {
      return yield* reject("invalid_parameter", 0);
    }
    return {
      audience: { userId: host.userId },
      finalReply: false as const,
    };
  }
);

/**
 * Host-scoped attention: atomic reserve/settle, quiet-hours coalesce, pause
 * and grant recheck at output, optional-source suppression, and explicit
 * briefing audience. This is not a second scheduler and does not send.
 */
export class InMemoryAttention {
  readonly #state: AttentionState = {
    budgets: new Map(),
    grants: new Map(),
    notices: new Map(),
    paused: new Map(),
    pendingByEvent: new Map(),
  };

  setBudget(scope: ActionHostBinding, encoded: Schema.Json) {
    return setBudgetImpl(this.#state, scope, encoded);
  }

  reserve(scope: ActionHostBinding, encoded: Schema.Json) {
    return reserveImpl(this.#state, scope, encoded);
  }

  settle(
    scope: ActionHostBinding,
    reservationId: string,
    encoded: Schema.Json
  ) {
    return settleImpl(this.#state, scope, reservationId, encoded);
  }

  authorizeChannel(scope: ActionHostBinding, channel: AttentionChannel) {
    return authorizeChannelImpl(this.#state, scope, channel);
  }

  revokeChannel(scope: ActionHostBinding, channel: AttentionChannel) {
    return revokeChannelImpl(this.#state, scope, channel);
  }

  pause(scope: ActionHostBinding) {
    return pauseImpl(this.#state, scope);
  }

  resume(scope: ActionHostBinding) {
    return resumeImpl(this.#state, scope);
  }

  assess(scope: ActionHostBinding, encoded: Schema.Json) {
    return assessImpl(this.#state, scope, encoded);
  }

  cancel(scope: ActionHostBinding, noticeId: string) {
    return cancelImpl(this.#state, scope, noticeId);
  }

  selectDestinations(scope: ActionHostBinding, encoded: Schema.Json) {
    return selectDestinationsImpl(this.#state, scope, encoded);
  }

  remaining(scope: ActionHostBinding) {
    return this.#state.budgets.get(scopeKey(scope))?.remaining;
  }

  noticeStatus(scope: ActionHostBinding, noticeId: string) {
    const notice = this.#state.notices.get(recordKey(scope, noticeId));
    if (
      !notice ||
      notice.userId !== scope.userId ||
      notice.workspaceId !== scope.workspaceId
    ) {
      return undefined;
    }
    return notice.status;
  }
}
