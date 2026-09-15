import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import type { ActionHostBinding } from "./catalog";
import {
  InMemoryRoutines,
  RoutinesRejected,
  nextDailyOccurrence,
  obligationAfterEvidence,
  pollInbox,
  projectRoutineBriefing,
  readZoned,
} from "./routines";

const alice: ActionHostBinding = {
  userId: "better-auth:alice",
  workspaceId: "company:acme",
};

const bob: ActionHostBinding = {
  userId: "better-auth:bob",
  workspaceId: "company:acme",
};

const admission = {
  hour: 9,
  knowledgeRevision: "know_1",
  minute: 0,
  missedRunPolicy: "run_latest" as const,
  operationRevision: "op_1",
  timezone: "America/New_York",
};

describe("host-scoped routines", () => {
  it("does keep pause, edited time, DST wall clock and a single lease", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const routines = new InMemoryRoutines();
        const beforeDst = Date.parse("2026-03-07T05:00:00.000Z");
        const created = yield* routines.createRoutine(
          alice,
          admission,
          beforeDst
        );
        expect(readZoned(created.nextRunAt, "America/New_York").hour).toBe(9);
        const afterDst = nextDailyOccurrence(
          Date.parse("2026-03-09T05:00:00.000Z"),
          "America/New_York",
          9,
          0
        );
        expect(readZoned(afterDst, "America/New_York").hour).toBe(9);
        expect(readZoned(afterDst, "America/New_York").minute).toBe(0);

        const paused = yield* routines.pauseRoutine(alice, created.id);
        expect(paused.status).toBe("paused");
        const blocked = yield* routines.dispatchDue(
          alice,
          created.id,
          created.nextRunAt,
          "worker-a"
        );
        expect(blocked.kind).toBe("paused");
        if (blocked.kind === "paused") {
          expect(blocked.nextRunAt).toBe(created.nextRunAt);
        }

        const resumed = yield* routines.resumeRoutine(
          alice,
          created.id,
          beforeDst
        );
        expect(resumed.status).toBe("active");
        const edited = yield* routines.editRoutine(
          alice,
          created.id,
          { ...admission, hour: 10, knowledgeRevision: "know_2" },
          beforeDst
        );
        expect(edited.revision).toBe(created.revision + 1);
        expect(edited.hour).toBe(10);
        expect(readZoned(edited.nextRunAt, "America/New_York").hour).toBe(10);
        expect(edited.knowledgeRevision).toBe("know_2");

        const first = yield* routines.dispatchDue(
          alice,
          created.id,
          edited.nextRunAt,
          "worker-a"
        );
        expect(first.kind).toBe("dispatched");
        if (first.kind === "dispatched") {
          expect(first.knowledgeRevision).toBe("know_2");
          expect(first.operationRevision).toBe("op_1");
        }
        const again = yield* routines.dispatchDue(
          alice,
          created.id,
          edited.nextRunAt,
          "worker-b"
        );
        expect(again.kind).toBe("not_due");

        const later = yield* routines.editRoutine(
          alice,
          created.id,
          { ...admission, hour: 11 },
          edited.nextRunAt
        );
        const [left, right] = yield* Effect.all(
          [
            routines
              .dispatchDue(alice, created.id, later.nextRunAt, "worker-a")
              .pipe(Effect.result),
            routines
              .dispatchDue(alice, created.id, later.nextRunAt, "worker-b")
              .pipe(Effect.result),
          ],
          { concurrency: "unbounded" }
        );
        const kinds = [left, right].map((row) => {
          if (Result.isFailure(row)) {
            return row.failure.reason;
          }
          return row.success.kind;
        });
        expect(kinds.toSorted()).toEqual(["dispatched", "not_due"]);

        const foreign = yield* routines
          .dispatchDue(bob, created.id, later.nextRunAt, "worker-b")
          .pipe(Effect.flip);
        expect(foreign).toBeInstanceOf(RoutinesRejected);
        const forged = yield* routines
          .createRoutine(alice, { ...admission, userId: bob.userId }, beforeDst)
          .pipe(Effect.flip);
        expect(forged).toBeInstanceOf(RoutinesRejected);
      })
    ));

  it("does not discharge from a reminder, skip empty polls, or hide required coverage", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const routines = new InMemoryRoutines();
        yield* routines.openObligation(alice, "cmt_ana");
        const reminder = yield* routines.applyObligationEvidence(
          alice,
          "cmt_ana",
          "reminder_receipt"
        );
        expect(reminder.discharged).toBe(false);
        expect(obligationAfterEvidence("reminder_receipt").discharged).toBe(
          false
        );
        expect(routines.obligationStatus(alice, "cmt_ana")).toBe("open");
        const absent = yield* routines.applyObligationEvidence(
          alice,
          "cmt_ana",
          "source_absent"
        );
        expect(absent.source).toBe("unknown");
        expect(absent.discharged).toBe(false);
        const done = yield* routines.applyObligationEvidence(
          alice,
          "cmt_ana",
          "declared_outcome"
        );
        expect(done.discharged).toBe(true);
        expect(routines.obligationStatus(alice, "cmt_ana")).toBe("discharged");
        expect(routines.obligationStatus(bob, "cmt_ana")).toBeUndefined();

        const empty = pollInbox("", [], 0);
        expect(empty.modelJudgment).toBe(false);
        expect(empty.cursor).toBe("");
        const later = pollInbox(empty.cursor, ["mail_2"], 0);
        expect(later.modelJudgment).toBe(true);
        expect(later.cursor).toBe("");

        const briefing = projectRoutineBriefing([
          { id: "gmail", required: true, status: "unavailable" },
          { id: "optional_empty", required: false, status: "empty" },
          { id: "calendar", required: false, status: "available" },
        ]);
        expect(briefing.included).toEqual(["gmail", "calendar"]);
        expect(briefing.included).not.toContain("optional_empty");
        expect(briefing.requiredFailures).toEqual(["gmail"]);
        expect(briefing.allClear).toBe(false);
      })
    ));
});
