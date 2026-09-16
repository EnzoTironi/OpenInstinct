import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { InMemoryAuthority } from "./authority";
import type { ActionHostBinding } from "./catalog";
import {
  ExperienceRejected,
  InMemoryHostExperience,
  replyLengthPolicy,
} from "./experience";

const alice: ActionHostBinding = {
  userId: "better-auth:alice",
  workspaceId: "company:acme",
};

const bob: ActionHostBinding = {
  userId: "better-auth:bob",
  workspaceId: "company:acme",
};

describe("host-scoped knowledge and decision experience", () => {
  it("does project accepted facts, candidates and shared preferences without task spill", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const authority = new InMemoryAuthority();
        const experience = new InMemoryHostExperience(authority);
        const mail = yield* authority.admitSource(
          alice,
          "gmail:style",
          "hist-style",
          { snippet: "prefer concise briefs" },
          1
        );
        const style = yield* authority.extractClaim(
          alice,
          mail.id,
          "pref:brief",
          "preference",
          "style",
          "concise briefs",
          "interpretation"
        );
        yield* authority.acceptClaim(alice, style.id);
        const rumor = yield* authority.admitSource(
          alice,
          "gmail:salary",
          "hist-salary",
          { snippet: "salary 180000" },
          1
        );
        yield* authority.extractClaim(
          alice,
          rumor.id,
          "cmt_courier",
          "commitment",
          "salary",
          "180000",
          "interpretation"
        );
        yield* experience.bindTaskObject(alice, "courier", "cmt_courier");
        yield* experience.associateRetrieval(
          alice,
          "retrieved_with",
          "cmt_courier",
          "pref:brief"
        );

        const knowledge = yield* experience.projectKnowledge(alice);
        expect(knowledge).toEqual(
          expect.arrayContaining([
            {
              kind: "accepted_fact",
              objectId: "pref:brief",
              predicate: "style",
              typeId: "preference",
              value: "concise briefs",
            },
            {
              kind: "candidate",
              objectId: "cmt_courier",
              predicate: "salary",
              typeId: "commitment",
            },
            {
              kind: "uncertainty",
              objectId: "cmt_courier",
              typeId: "commitment",
            },
            {
              kind: "retrieval_association",
              objectId: "cmt_courier",
              relatedObjectId: "pref:brief",
              typeId: "commitment",
            },
          ])
        );
        const why = yield* experience.explainWhy(alice, "cmt_courier");
        expect(why.uncertainty).toBe(true);
        expect(why.candidates).toContain("salary");
        expect(JSON.stringify(why)).toContain("salary");

        const courier = yield* experience.projectTask(alice, "courier");
        expect(courier.map((row) => row.kind)).toEqual(
          expect.arrayContaining([
            "accepted_fact",
            "candidate",
            "uncertainty",
            "retrieval_association",
          ])
        );
        const briefingTask = yield* experience.projectTask(alice, "briefing");
        expect(briefingTask).toEqual([
          {
            kind: "accepted_fact",
            objectId: "pref:brief",
            predicate: "style",
            typeId: "preference",
            value: "concise briefs",
          },
        ]);
        expect(JSON.stringify(briefingTask)).not.toContain("180000");
        expect(JSON.stringify(briefingTask)).not.toContain("salary");
        const work = yield* experience.projectWork(alice);
        expect(work.needsDecision).toEqual(["cmt_courier"]);
        expect(work.currentWork).toEqual([]);

        expect(yield* experience.projectKnowledge(bob)).toEqual([]);
        const hidden = yield* experience
          .explainWhy(bob, "cmt_courier")
          .pipe(Effect.flip);
        expect(hidden).toBeInstanceOf(ExperienceRejected);
      })
    ));

  it("does keep conversation groups as navigation and refuse stale document success", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const authority = new InMemoryAuthority();
        const experience = new InMemoryHostExperience(authority);
        yield* experience.openConversation(alice, "chat_ana", "inbox");
        const moved = yield* experience.moveConversation(
          alice,
          "chat_ana",
          "work"
        );
        expect(moved).toEqual({
          agreements: [],
          grants: [],
          groupId: "work",
          shares: [],
        });
        expect(
          yield* experience.inspectConversation(alice, "chat_ana")
        ).toEqual(moved);
        const bobMove = yield* experience
          .moveConversation(bob, "chat_ana", "stolen")
          .pipe(Effect.flip);
        expect(bobMove).toBeInstanceOf(ExperienceRejected);
        if (bobMove instanceof ExperienceRejected) {
          expect(bobMove.reason).toBe("conversation_missing");
        }

        yield* experience.putDocument(alice, "art_brief", "draft v1");
        const commentId = yield* experience.openComment(alice, "art_brief");
        const stale = yield* experience
          .applyReplace(alice, "art_brief", "9", "draft v2")
          .pipe(Effect.flip);
        expect(stale).toBeInstanceOf(ExperienceRejected);
        if (stale instanceof ExperienceRejected) {
          expect(stale.reason).toBe("stale_revision");
        }
        const preview = yield* experience.previewReplace(
          alice,
          "art_brief",
          "1",
          "draft v2"
        );
        expect(preview.body).toBe("draft v2");
        const written = yield* experience.applyReplace(
          alice,
          "art_brief",
          "1",
          "draft v2"
        );
        expect(written.revision).toBe("2");
        expect(written.jobDone).toBe(false);
        const resolved = yield* experience.resolveComment(
          alice,
          "art_brief",
          commentId
        );
        expect(resolved.open).toBe(false);
        expect(resolved.jobDone).toBe(false);

        const scheduled = yield* experience.composeBriefing(
          alice,
          "scheduled",
          {
            userId: alice.userId,
          }
        );
        const onDemand = yield* experience.composeBriefing(alice, "on_demand", {
          channel: "web",
          userId: alice.userId,
        });
        expect(scheduled.rows).toEqual(onDemand.rows);
        expect(scheduled.lengthPolicy).toBe("match_task");
        expect(replyLengthPolicy("short")).toBe("concise");
        expect(replyLengthPolicy("analysis")).toBe("full");
        expect(replyLengthPolicy("short")).not.toBe("full");
        const broadcast = yield* experience
          .composeBriefing(alice, "scheduled", {
            channels: ["web", "telegram"],
            userId: alice.userId,
          })
          .pipe(Effect.flip);
        expect(broadcast).toBeInstanceOf(ExperienceRejected);
        if (broadcast instanceof ExperienceRejected) {
          expect(broadcast.reason).toBe("audience_required");
        }
        const coworker = yield* experience
          .composeBriefing(alice, "on_demand", { userId: bob.userId })
          .pipe(Effect.flip);
        if (coworker instanceof ExperienceRejected) {
          expect(coworker.reason).toBe("audience_required");
        }
      })
    ));
});
