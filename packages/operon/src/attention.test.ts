import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  AttentionRejected,
  InMemoryAttention,
  projectChildDelivery,
} from "./attention";
import type { ActionHostBinding } from "./catalog";

const alice: ActionHostBinding = {
  userId: "better-auth:alice",
  workspaceId: "company:acme",
};

const bob: ActionHostBinding = {
  userId: "better-auth:bob",
  workspaceId: "company:acme",
};

const optionalNotice = {
  channel: "web" as const,
  eventKey: "commitment:ana",
  kind: "optional" as const,
  quietHours: false,
  sourceVisible: false,
};

describe("host-scoped attention", () => {
  it("does reserve concurrently, settle actual use, and stop at the cap", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const attention = new InMemoryAttention();
        const opened = yield* attention.setBudget(alice, { limit: 2 });
        expect(opened.remaining).toBe(2);
        const [left, right] = yield* Effect.all(
          [
            attention.reserve(alice, { units: 2 }).pipe(Effect.result),
            attention.reserve(alice, { units: 2 }).pipe(Effect.result),
          ],
          { concurrency: "unbounded" }
        );
        const kinds = [left, right].map((row) => {
          if (Result.isFailure(row)) {
            return row.failure.reason;
          }
          return "reserved" as const;
        });
        expect(kinds.toSorted()).toEqual(["budget_exhausted", "reserved"]);
        const reserved = Result.isSuccess(left)
          ? left.success
          : Result.isSuccess(right)
            ? right.success
            : undefined;
        expect(reserved).toBeDefined();
        if (reserved === undefined) {
          return;
        }
        expect(reserved.remaining).toBe(0);
        const settled = yield* attention.settle(alice, reserved.id, {
          actual: 1,
        });
        expect(settled.remaining).toBe(1);
        const again = yield* attention.reserve(alice, { units: 1 });
        expect(again.remaining).toBe(0);
        const cap = yield* attention
          .reserve(alice, { units: 1 })
          .pipe(Effect.flip);
        expect(cap).toBeInstanceOf(AttentionRejected);
        if (cap instanceof AttentionRejected) {
          expect(cap.reason).toBe("budget_exhausted");
          expect(cap.remaining).toBe(0);
        }
        expect(attention.remaining(bob)).toBeUndefined();
        const coworker = yield* attention
          .reserve(bob, { units: 1 })
          .pipe(Effect.flip);
        expect(coworker).toBeInstanceOf(AttentionRejected);
        if (coworker instanceof AttentionRejected) {
          expect(coworker.reason).toBe("budget_exhausted");
          expect(coworker.remaining).toBe(0);
        }
        const forged = yield* attention
          .setBudget(alice, { limit: 9, userId: bob.userId })
          .pipe(Effect.flip);
        expect(forged).toBeInstanceOf(AttentionRejected);
      })
    ));

  it("does coalesce quiet hours, keep urgent and explicit, and bind one audience", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const attention = new InMemoryAttention();
        yield* attention.authorizeChannel(alice, "web");
        const paused = yield* attention.pause(alice);
        expect(paused.paused).toBe(true);
        const blocked = yield* attention.assess(alice, optionalNotice);
        expect(blocked.kind).toBe("paused");
        yield* attention.resume(alice);

        const quiet = yield* attention.assess(alice, {
          ...optionalNotice,
          quietHours: true,
        });
        expect(quiet.kind).toBe("pending");
        if (quiet.kind !== "pending") {
          return;
        }
        const coalesced = yield* attention.assess(alice, {
          ...optionalNotice,
          quietHours: true,
        });
        expect(coalesced.kind).toBe("coalesced");
        if (coalesced.kind === "coalesced") {
          expect(coalesced.noticeId).toBe(quiet.noticeId);
        }
        const urgent = yield* attention.assess(alice, {
          channel: "web",
          eventKey: "commitment:urgent",
          kind: "urgent",
          quietHours: true,
          sourceVisible: true,
        });
        expect(urgent.kind).toBe("delivered");
        const cancelled = yield* attention.cancel(alice, quiet.noticeId);
        expect(cancelled.status).toBe("cancelled");
        expect(attention.noticeStatus(alice, quiet.noticeId)).toBe("cancelled");
        expect(attention.noticeStatus(bob, quiet.noticeId)).toBeUndefined();

        const visible = yield* attention.assess(alice, {
          ...optionalNotice,
          eventKey: "commitment:visible",
          sourceVisible: true,
        });
        expect(visible.kind).toBe("suppressed");
        const explicit = yield* attention.assess(alice, {
          channel: "web",
          eventKey: "commitment:explicit",
          kind: "explicit_delivery",
          quietHours: true,
          sourceVisible: true,
        });
        expect(explicit.kind).toBe("delivered");

        yield* attention.revokeChannel(alice, "web");
        const revoked = yield* attention
          .assess(alice, optionalNotice)
          .pipe(Effect.flip);
        expect(revoked).toBeInstanceOf(AttentionRejected);
        if (revoked instanceof AttentionRejected) {
          expect(revoked.reason).toBe("grant_revoked");
        }
        yield* attention.authorizeChannel(alice, "web");

        const connected = ["telegram", "web", "whatsapp"] as const;
        const selected = yield* attention.selectDestinations(alice, {
          channel: "web",
          userId: alice.userId,
        });
        expect(selected.destinations).toEqual(["web"]);
        expect(selected.destinations).not.toEqual([...connected]);
        const broadcast = yield* attention
          .selectDestinations(alice, {
            channels: [...connected],
            userId: alice.userId,
          })
          .pipe(Effect.flip);
        expect(broadcast).toBeInstanceOf(AttentionRejected);
        const coworkerAudience = yield* attention
          .selectDestinations(alice, {
            channel: "web",
            userId: bob.userId,
          })
          .pipe(Effect.flip);
        expect(coworkerAudience).toBeInstanceOf(AttentionRejected);

        const child = yield* projectChildDelivery(alice, {
          userId: alice.userId,
        });
        expect(child.finalReply).toBe(false);
        expect(child.audience.userId).toBe(alice.userId);
        const unreviewed = yield* projectChildDelivery(alice, {
          finalReply: true,
          userId: alice.userId,
        }).pipe(Effect.flip);
        expect(unreviewed).toBeInstanceOf(AttentionRejected);
        const childCoworker = yield* projectChildDelivery(alice, {
          userId: bob.userId,
        }).pipe(Effect.flip);
        expect(childCoworker).toBeInstanceOf(AttentionRejected);
      })
    ));
});
