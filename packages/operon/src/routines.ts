import { Clock, Effect, Schema } from "effect";

import { actionHostBindingSchema, type ActionHostBinding } from "./catalog";
import { generatePrefixedId } from "./types";

const requiredId = Schema.String.check(Schema.isMinLength(1));
const decodeScope = Schema.decodeUnknownEffect(actionHostBindingSchema);
const parseOptions = { onExcessProperty: "error" } as const;

export const missedRunPolicySchema = Schema.Literals([
  "catch_up",
  "run_latest",
  "skip",
]);
export type MissedRunPolicy = typeof missedRunPolicySchema.Type;

export const routineStatusSchema = Schema.Literals(["active", "paused"]);
export type RoutineStatus = typeof routineStatusSchema.Type;

export const obligationEvidenceSchema = Schema.Literals([
  "declared_outcome",
  "reminder_receipt",
  "source_absent",
]);
export type ObligationEvidence = typeof obligationEvidenceSchema.Type;

export const briefingSectionStatusSchema = Schema.Literals([
  "available",
  "empty",
  "unavailable",
]);
export type BriefingSectionStatus = typeof briefingSectionStatusSchema.Type;

const routineAdmissionSchema = Schema.Struct({
  hour: Schema.Int.check(Schema.isBetween({ maximum: 23, minimum: 0 })),
  knowledgeRevision: requiredId,
  minute: Schema.Int.check(Schema.isBetween({ maximum: 59, minimum: 0 })),
  missedRunPolicy: missedRunPolicySchema,
  operationRevision: requiredId,
  timezone: requiredId,
});
export type RoutineAdmission = typeof routineAdmissionSchema.Type;

const briefingSectionSchema = Schema.Struct({
  id: requiredId,
  required: Schema.Boolean,
  status: briefingSectionStatusSchema,
});
export type BriefingSection = typeof briefingSectionSchema.Type;

export class RoutinesRejected extends Schema.TaggedError<RoutinesRejected>()(
  "RoutinesRejected",
  {
    reason: Schema.Literals([
      "invalid_parameter",
      "invalid_scope",
      "routine_missing",
    ]),
  }
) {}

interface StoredRoutine {
  readonly hour: number;
  readonly id: string;
  readonly knowledgeRevision: string;
  readonly minute: number;
  readonly missedRunPolicy: MissedRunPolicy;
  readonly nextRunAt: number;
  readonly operationRevision: string;
  readonly revision: number;
  readonly status: RoutineStatus;
  readonly timezone: string;
  readonly userId: string;
  readonly workspaceId: string;
}

interface RoutinesState {
  readonly dispatched: Map<string, true>;
  readonly leases: Map<string, string>;
  readonly obligations: Map<string, "discharged" | "open">;
  readonly routines: Map<string, StoredRoutine>;
}

function reject(reason: RoutinesRejected["reason"]) {
  return new RoutinesRejected({ reason });
}

function scopeKey(scope: ActionHostBinding): string {
  return `${scope.workspaceId}\0${scope.userId}`;
}

function recordKey(scope: ActionHostBinding, id: string): string {
  return `${scopeKey(scope)}\0${id}`;
}

function occurrenceKey(routine: StoredRoutine, at: number): string {
  return `${routine.userId}\0${routine.workspaceId}\0${routine.id}\0${String(at)}\0${String(routine.revision)}`;
}

interface ZonedParts {
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly month: number;
  readonly year: number;
}

export function readZoned(atMs: number, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(atMs));
  const value = (type: Intl.DateTimeFormatPartTypes) => {
    const part = parts.find((row) => row.type === type);
    return Number(part?.value ?? Number.NaN);
  };
  return {
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    month: value("month"),
    year: value("year"),
  };
}

function addCalendarDays(
  year: number,
  month: number,
  day: number,
  offset: number
) {
  const shifted = new Date(Date.UTC(year, month - 1, day + offset));
  return {
    day: shifted.getUTCDate(),
    month: shifted.getUTCMonth() + 1,
    year: shifted.getUTCFullYear(),
  };
}

function zonedUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): number {
  let guess = Date.UTC(year, month - 1, day, hour, minute);
  for (let attempt = 0; attempt < 4; attempt++) {
    const got = readZoned(guess, timeZone);
    const delta =
      Date.UTC(year, month - 1, day, hour, minute) -
      Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute);
    if (delta === 0) {
      return guess;
    }
    guess += delta;
  }
  return guess;
}

export function nextDailyOccurrence(
  fromMs: number,
  timeZone: string,
  hour: number,
  minute: number
): number {
  const local = readZoned(fromMs, timeZone);
  if (Number.isNaN(local.year)) {
    return fromMs + 24 * 60 * 60 * 1000;
  }
  for (let offset = 0; offset <= 14; offset++) {
    const day = addCalendarDays(local.year, local.month, local.day, offset);
    const utc = zonedUtc(timeZone, day.year, day.month, day.day, hour, minute);
    const confirm = readZoned(utc, timeZone);
    if (confirm.hour !== hour || confirm.minute !== minute) {
      continue;
    }
    if (utc > fromMs) {
      return utc;
    }
  }
  return fromMs + 24 * 60 * 60 * 1000;
}

export function obligationAfterEvidence(kind: ObligationEvidence) {
  switch (kind) {
    case "declared_outcome":
      return { discharged: true, source: "present" as const };
    case "reminder_receipt":
      return { discharged: false, source: "present" as const };
    case "source_absent":
      return { discharged: false, source: "unknown" as const };
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function pollInbox(
  cursor: string,
  eventIds: readonly string[],
  dueFollowUps: number
) {
  if (dueFollowUps > 0) {
    return { cursor, modelJudgment: true };
  }
  const index = cursor === "" ? -1 : eventIds.indexOf(cursor);
  const unseen = index >= 0 ? eventIds.slice(index + 1) : eventIds;
  if (unseen.length === 0) {
    return { cursor, modelJudgment: false };
  }
  return { cursor, modelJudgment: true };
}

export function projectRoutineBriefing(sections: readonly BriefingSection[]) {
  const included: string[] = [];
  const requiredFailures: string[] = [];
  for (const section of sections) {
    if (!section.required && section.status === "empty") {
      continue;
    }
    included.push(section.id);
    if (section.required && section.status === "unavailable") {
      requiredFailures.push(section.id);
    }
  }
  return {
    allClear: requiredFailures.length === 0,
    included,
    requiredFailures,
  };
}

const requireHost = Effect.fn("InMemoryRoutines.requireHost")(function* (
  scope: ActionHostBinding
) {
  return yield* decodeScope(scope).pipe(
    Effect.mapError(() => reject("invalid_scope"))
  );
});

function requireRoutine(
  state: RoutinesState,
  host: ActionHostBinding,
  routineId: string
) {
  const routine = state.routines.get(recordKey(host, routineId));
  if (
    !routine ||
    routine.userId !== host.userId ||
    routine.workspaceId !== host.workspaceId
  ) {
    return reject("routine_missing");
  }
  return routine;
}

const createRoutineImpl = Effect.fn("InMemoryRoutines.createRoutine")(
  function* (
    state: RoutinesState,
    scope: ActionHostBinding,
    encoded: Schema.Json,
    nowMs: number
  ) {
    const host = yield* requireHost(scope);
    const admission = yield* Schema.decodeUnknownEffect(
      routineAdmissionSchema,
      parseOptions
    )(encoded).pipe(Effect.mapError(() => reject("invalid_parameter")));
    try {
      Intl.DateTimeFormat("en-US", { timeZone: admission.timezone }).format(
        new Date(nowMs)
      );
    } catch {
      return yield* reject("invalid_parameter");
    }
    const recordedAt = yield* Clock.currentTimeMillis;
    const id = generatePrefixedId("rtn", recordedAt);
    const routine: StoredRoutine = {
      hour: admission.hour,
      id,
      knowledgeRevision: admission.knowledgeRevision,
      minute: admission.minute,
      missedRunPolicy: admission.missedRunPolicy,
      nextRunAt: nextDailyOccurrence(
        nowMs,
        admission.timezone,
        admission.hour,
        admission.minute
      ),
      operationRevision: admission.operationRevision,
      revision: 1,
      status: "active",
      timezone: admission.timezone,
      userId: host.userId,
      workspaceId: host.workspaceId,
    };
    state.routines.set(recordKey(host, id), routine);
    return routine;
  }
);

const editRoutineImpl = Effect.fn("InMemoryRoutines.editRoutine")(function* (
  state: RoutinesState,
  scope: ActionHostBinding,
  routineId: string,
  encoded: Schema.Json,
  nowMs: number
) {
  const host = yield* requireHost(scope);
  const current = requireRoutine(state, host, routineId);
  if (current instanceof RoutinesRejected) {
    return yield* current;
  }
  const admission = yield* Schema.decodeUnknownEffect(
    routineAdmissionSchema,
    parseOptions
  )(encoded).pipe(Effect.mapError(() => reject("invalid_parameter")));
  const next: StoredRoutine = {
    ...current,
    hour: admission.hour,
    knowledgeRevision: admission.knowledgeRevision,
    minute: admission.minute,
    missedRunPolicy: admission.missedRunPolicy,
    nextRunAt: nextDailyOccurrence(
      nowMs,
      admission.timezone,
      admission.hour,
      admission.minute
    ),
    operationRevision: admission.operationRevision,
    revision: current.revision + 1,
    timezone: admission.timezone,
  };
  state.routines.set(recordKey(host, routineId), next);
  return next;
});

const pauseRoutineImpl = Effect.fn("InMemoryRoutines.pauseRoutine")(function* (
  state: RoutinesState,
  scope: ActionHostBinding,
  routineId: string
) {
  const host = yield* requireHost(scope);
  const current = requireRoutine(state, host, routineId);
  if (current instanceof RoutinesRejected) {
    return yield* current;
  }
  const paused: StoredRoutine = { ...current, status: "paused" };
  state.routines.set(recordKey(host, routineId), paused);
  return paused;
});

const resumeRoutineImpl = Effect.fn("InMemoryRoutines.resumeRoutine")(
  function* (
    state: RoutinesState,
    scope: ActionHostBinding,
    routineId: string,
    nowMs: number
  ) {
    const host = yield* requireHost(scope);
    const current = requireRoutine(state, host, routineId);
    if (current instanceof RoutinesRejected) {
      return yield* current;
    }
    const resumed: StoredRoutine = {
      ...current,
      nextRunAt: nextDailyOccurrence(
        nowMs,
        current.timezone,
        current.hour,
        current.minute
      ),
      status: "active",
    };
    state.routines.set(recordKey(host, routineId), resumed);
    return resumed;
  }
);

const dispatchDueImpl = Effect.fn("InMemoryRoutines.dispatchDue")(function* (
  state: RoutinesState,
  scope: ActionHostBinding,
  routineId: string,
  nowMs: number,
  workerId: string
) {
  const host = yield* requireHost(scope);
  const worker = workerId.trim();
  if (worker.length === 0) {
    return yield* reject("invalid_parameter");
  }
  const current = requireRoutine(state, host, routineId);
  if (current instanceof RoutinesRejected) {
    return yield* current;
  }
  if (current.status === "paused") {
    return { kind: "paused" as const, nextRunAt: current.nextRunAt };
  }
  const lockKey = recordKey(host, current.id);
  const holder = state.leases.get(lockKey);
  if (holder !== undefined && holder !== worker) {
    return { kind: "leased" as const, owner: holder };
  }
  state.leases.set(lockKey, worker);
  const key = occurrenceKey(current, current.nextRunAt);
  if (state.dispatched.has(key)) {
    state.leases.delete(lockKey);
    return { kind: "duplicate" as const };
  }
  if (nowMs < current.nextRunAt) {
    state.leases.delete(lockKey);
    return { kind: "not_due" as const, nextRunAt: current.nextRunAt };
  }
  if (
    current.missedRunPolicy === "skip" &&
    nowMs - current.nextRunAt > 60 * 60 * 1000
  ) {
    const skipped: StoredRoutine = {
      ...current,
      nextRunAt: nextDailyOccurrence(
        nowMs,
        current.timezone,
        current.hour,
        current.minute
      ),
    };
    state.routines.set(recordKey(host, current.id), skipped);
    state.leases.delete(lockKey);
    return { kind: "skipped_missed" as const, nextRunAt: skipped.nextRunAt };
  }
  state.dispatched.set(key, true);
  const advanced: StoredRoutine = {
    ...current,
    nextRunAt: nextDailyOccurrence(
      nowMs,
      current.timezone,
      current.hour,
      current.minute
    ),
  };
  state.routines.set(recordKey(host, current.id), advanced);
  state.leases.delete(lockKey);
  return {
    kind: "dispatched" as const,
    knowledgeRevision: current.knowledgeRevision,
    occurrenceAt: current.nextRunAt,
    operationRevision: current.operationRevision,
    revision: current.revision,
  };
});

const openObligationImpl = Effect.fn("InMemoryRoutines.openObligation")(
  function* (
    state: RoutinesState,
    scope: ActionHostBinding,
    commitmentId: string
  ) {
    const host = yield* requireHost(scope);
    const id = commitmentId.trim();
    if (id.length === 0) {
      return yield* reject("invalid_parameter");
    }
    state.obligations.set(recordKey(host, id), "open");
    return id;
  }
);

const applyObligationEvidenceImpl = Effect.fn(
  "InMemoryRoutines.applyObligationEvidence"
)(function* (
  state: RoutinesState,
  scope: ActionHostBinding,
  commitmentId: string,
  kind: ObligationEvidence
) {
  const host = yield* requireHost(scope);
  const key = recordKey(host, commitmentId);
  const current = state.obligations.get(key);
  if (current === undefined) {
    return yield* reject("invalid_parameter");
  }
  const decoded = yield* Schema.decodeUnknownEffect(obligationEvidenceSchema)(
    kind
  ).pipe(Effect.mapError(() => reject("invalid_parameter")));
  const next = obligationAfterEvidence(decoded);
  if (next.discharged) {
    state.obligations.set(key, "discharged");
  }
  return {
    discharged: state.obligations.get(key) === "discharged",
    source: next.source,
  };
});

/**
 * Host-scoped routines over the existing scheduler contract: timezone-stable
 * daily instances, pause/edit, lease/dedupe, reminder ≠ discharge, cheap empty
 * polls, and required briefing coverage. This is not a second daemon and does
 * not write Mem0 or send mail.
 */
export class InMemoryRoutines {
  readonly #state: RoutinesState = {
    dispatched: new Map(),
    leases: new Map(),
    obligations: new Map(),
    routines: new Map(),
  };

  createRoutine(scope: ActionHostBinding, encoded: Schema.Json, nowMs: number) {
    return createRoutineImpl(this.#state, scope, encoded, nowMs);
  }

  editRoutine(
    scope: ActionHostBinding,
    routineId: string,
    encoded: Schema.Json,
    nowMs: number
  ) {
    return editRoutineImpl(this.#state, scope, routineId, encoded, nowMs);
  }

  pauseRoutine(scope: ActionHostBinding, routineId: string) {
    return pauseRoutineImpl(this.#state, scope, routineId);
  }

  resumeRoutine(scope: ActionHostBinding, routineId: string, nowMs: number) {
    return resumeRoutineImpl(this.#state, scope, routineId, nowMs);
  }

  dispatchDue(
    scope: ActionHostBinding,
    routineId: string,
    nowMs: number,
    workerId: string
  ) {
    return dispatchDueImpl(this.#state, scope, routineId, nowMs, workerId);
  }

  openObligation(scope: ActionHostBinding, commitmentId: string) {
    return openObligationImpl(this.#state, scope, commitmentId);
  }

  applyObligationEvidence(
    scope: ActionHostBinding,
    commitmentId: string,
    kind: ObligationEvidence
  ) {
    return applyObligationEvidenceImpl(this.#state, scope, commitmentId, kind);
  }

  obligationStatus(scope: ActionHostBinding, commitmentId: string) {
    return this.#state.obligations.get(recordKey(scope, commitmentId));
  }
}
