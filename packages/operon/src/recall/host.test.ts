import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { InMemoryAuthority } from "../authority";
import { proposeCommitmentAction, type ActionHostBinding } from "../catalog";
import { ActionLifecycleRejected, InMemoryActionLifecycle } from "../lifecycle";
import {
  HostScopedRecallCache,
  corroboratingProviderIds,
  evidenceObservationsFromRecall,
  selectHostScopedContext,
} from "./host";

const alice: ActionHostBinding = {
  userId: "better-auth:alice",
  workspaceId: "company:acme",
};

const bob: ActionHostBinding = {
  userId: "better-auth:bob",
  workspaceId: "company:acme",
};

const proposePayload = {
  artifactRevision: "art_1",
  channelGrantId: "grant_mail",
  recipientHandle: "ana@example.com",
  title: "Send the red Q3 brief",
};

const rememberNote = Effect.fn("rememberNote")(function* (
  authority: InMemoryAuthority,
  host: ActionHostBinding,
  subjectId: string,
  text: string,
  observedAt: number
) {
  const source = yield* authority.admitSource(
    host,
    `gmail:${subjectId}`,
    "rev-1",
    { snippet: text },
    observedAt
  );
  const claim = yield* authority.extractClaim(
    host,
    source.id,
    subjectId,
    "commitment",
    "note",
    text,
    "interpretation"
  );
  yield* authority.acceptClaim(host, claim.id);
  return yield* authority.getObject(host, subjectId);
});

describe("host-scoped recall", () => {
  it("does keep required evidence that misses the ranking cutoff", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const authority = new InMemoryAuthority();
        const cache = new HostScopedRecallCache();
        const lifecycle = new InMemoryActionLifecycle();
        for (const index of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
          yield* rememberNote(
            authority,
            alice,
            `noise-${String(index)}`,
            `common brief language filler ${String(index)} about the Q3 brief wording`,
            index + 1
          );
        }
        yield* rememberNote(
          authority,
          alice,
          "recipientHandle",
          "ana@example.com",
          20
        );
        yield* rememberNote(authority, alice, "artifactRevision", "art_1", 21);
        yield* rememberNote(
          authority,
          alice,
          "channelGrantId",
          "grant_mail",
          22
        );
        const requiredEvidence = proposeCommitmentAction.requiredEvidence.map(
          (id) => ({ id, objectId: id })
        );
        const recalled = yield* selectHostScopedContext(
          authority,
          cache,
          alice,
          "Q3 brief wording",
          requiredEvidence,
          12,
          1,
          []
        );
        expect(recalled.embedCalls).toBe(0);
        expect(recalled.modelCalls).toBe(0);
        expect(recalled.requiredEvidence.map((row) => row.status)).toEqual([
          "available",
          "available",
          "available",
        ]);
        const observations = evidenceObservationsFromRecall(
          recalled.requiredEvidence
        );
        expect(observations.every((row) => row.kind === "present")).toBe(true);
        const requiredRow = recalled.relevant.find(
          (row) => row.section.objectId === "recipientHandle"
        );
        expect(requiredRow).toBeDefined();

        const proposal = yield* lifecycle.prepareAction(
          proposeCommitmentAction,
          alice,
          proposePayload,
          observations,
          1
        );
        expect(proposal.actionId).toBe("propose_commitment");

        const empty = yield* selectHostScopedContext(
          authority,
          cache,
          bob,
          "Q3 brief wording",
          requiredEvidence,
          12,
          1,
          []
        );
        expect(empty.requiredEvidence.map((row) => row.status)).toEqual([
          "missing",
          "missing",
          "missing",
        ]);
        const blocked = yield* lifecycle
          .prepareAction(
            proposeCommitmentAction,
            bob,
            proposePayload,
            evidenceObservationsFromRecall(empty.requiredEvidence),
            1
          )
          .pipe(Effect.flip);
        expect(blocked).toBeInstanceOf(ActionLifecycleRejected);
        if (!(blocked instanceof ActionLifecycleRejected)) {
          throw blocked;
        }
        expect(blocked.reason).toBe("evidence_insufficient");
      })
    ));

  it("does not reuse another principal's cached context after a generation change", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const authority = new InMemoryAuthority();
        const cache = new HostScopedRecallCache();
        yield* rememberNote(
          authority,
          alice,
          "salary",
          "Private salary number 180000",
          1
        );
        const aliceHit = yield* selectHostScopedContext(
          authority,
          cache,
          alice,
          "salary compensation 180000",
          [],
          64,
          1,
          []
        );
        expect(
          aliceHit.relevant.some((row) => row.section.objectId === "salary")
        ).toBe(true);
        expect(
          cache.read(alice, 1, "salary compensation 180000", [])
        ).toBeDefined();
        expect(
          cache.read(bob, 1, "salary compensation 180000", [])
        ).toBeUndefined();

        const bobHit = yield* selectHostScopedContext(
          authority,
          cache,
          bob,
          "salary compensation 180000",
          [],
          64,
          1,
          []
        );
        expect(
          bobHit.relevant.map((row) => row.section.objectId)
        ).not.toContain("salary");
        expect(JSON.stringify(bobHit)).not.toContain("180000");

        const nextGeneration = yield* authority.bumpGeneration(alice);
        expect(
          cache.read(alice, nextGeneration, "salary compensation 180000", [])
        ).toBeUndefined();
        const refreshed = yield* selectHostScopedContext(
          authority,
          cache,
          alice,
          "salary compensation 180000",
          [],
          64,
          nextGeneration,
          []
        );
        expect(
          refreshed.relevant.some((row) => row.section.objectId === "salary")
        ).toBe(true);
      })
    ));

  it("does not treat a quoted copy as a second corroborating source", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const authority = new InMemoryAuthority();
        const original = yield* authority.admitSource(
          alice,
          "gmail:msg-1",
          "hist-1",
          { from: "ana@example.com", snippet: "send the red brief" },
          1
        );
        const quoted = yield* authority.admitSource(
          alice,
          "gmail:msg-2",
          "hist-2",
          {
            forwardedFrom: "gmail:msg-1",
            quotedFrom: "gmail:msg-1",
            snippet: "fwd: send the red brief",
          },
          2
        );
        yield* authority.extractClaim(
          alice,
          original.id,
          "statement:ana",
          "commitment",
          "note",
          "send the red brief",
          "interpretation"
        );
        yield* authority.extractClaim(
          alice,
          quoted.id,
          "statement:ana",
          "commitment",
          "note",
          "send the red brief",
          "interpretation"
        );
        const evidence = yield* authority.queryEvidence(alice, "statement:ana");
        expect(evidence.sources).toHaveLength(2);
        expect(corroboratingProviderIds(evidence.sources)).toEqual([
          "gmail:msg-1",
        ]);
      })
    ));

  it("does resolve a reference-only reply over host records", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const authority = new InMemoryAuthority();
        const cache = new HostScopedRecallCache();
        const first = yield* rememberNote(
          authority,
          alice,
          "opt-1",
          "first option is the green draft",
          1
        );
        const second = yield* rememberNote(
          authority,
          alice,
          "opt-2",
          "second option is the red draft",
          2
        );
        yield* rememberNote(
          authority,
          alice,
          "opt-old",
          "old hallway discussion about neither draft",
          3
        );
        if (!first || !second) {
          throw new Error("missing projected referents");
        }
        const result = yield* selectHostScopedContext(
          authority,
          cache,
          alice,
          "Use the second one",
          [],
          64,
          1,
          [
            `${first.id}:${first.revision}`,
            `${second.id}:${second.revision}`,
            "opt-old:2",
          ]
        );
        expect(result.relevant.map((row) => row.section.objectId)).toEqual([
          "opt-2",
        ]);
        expect(result.createdLinks).toEqual([]);
      })
    ));

  it("does keep a late multi-topic fact from host records", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const authority = new InMemoryAuthority();
        const cache = new HostScopedRecallCache();
        yield* rememberNote(
          authority,
          alice,
          "garden-long",
          `${"tomatoes basil watering ".repeat(40)} end of garden chatter.`,
          1
        );
        yield* rememberNote(
          authority,
          alice,
          "deadline-late",
          "Deadline is Friday at 17:00 for the signed brief.",
          2
        );
        const result = yield* selectHostScopedContext(
          authority,
          cache,
          alice,
          "Please water the tomatoes and basil this week. Also the deadline is Friday.",
          [],
          64,
          1,
          []
        );
        expect(result.profile).toBe("lean");
        expect(
          result.relevant.some(
            (row) => row.section.objectId === "deadline-late"
          )
        ).toBe(true);
      })
    ));

  it("does stay lean on an empty host corpus and still report missing R(d)", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const authority = new InMemoryAuthority();
        const cache = new HostScopedRecallCache();
        const result = yield* selectHostScopedContext(
          authority,
          cache,
          alice,
          "anything at all about Ana",
          [{ id: "rd-ana", objectId: "missing-object" }],
          64,
          1,
          []
        );
        expect(result.profile).toBe("lean");
        expect(result.embedCalls).toBe(0);
        expect(result.modelCalls).toBe(0);
        expect(result.requiredEvidence[0]?.status).toBe("missing");
        expect(result.createdLinks).toEqual([]);
      })
    ));

  it("does reselect pruned records and hide forgotten or withdrawn ones", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const authority = new InMemoryAuthority();
        const cache = new HostScopedRecallCache();
        yield* rememberNote(
          authority,
          alice,
          "courier",
          "Pruned but still authorized note that the courier is FlashLog.",
          1
        );
        const salarySource = yield* authority.admitSource(
          alice,
          "gmail:salary",
          "hist-salary",
          { snippet: "Private salary number 180000" },
          2
        );
        const salaryClaim = yield* authority.extractClaim(
          alice,
          salarySource.id,
          "salary",
          "commitment",
          "note",
          "Private salary number 180000",
          "interpretation"
        );
        yield* authority.acceptClaim(alice, salaryClaim.id);
        yield* rememberNote(
          authority,
          alice,
          "rumor",
          "Withdrawn rumor that Ana left the company.",
          3
        );
        const before = yield* selectHostScopedContext(
          authority,
          cache,
          alice,
          "FlashLog courier salary 180000 rumor",
          [],
          64,
          yield* authority.scopeGeneration(alice),
          []
        );
        expect(before.relevant.map((row) => row.section.objectId)).toEqual(
          expect.arrayContaining(["courier", "salary"])
        );

        yield* authority.pruneObject(alice, "courier");
        const forgotten = yield* authority.forgetSource(alice, salarySource.id);
        yield* authority.withdrawObject(alice, "rumor");
        const after = yield* selectHostScopedContext(
          authority,
          cache,
          alice,
          "FlashLog courier salary 180000 rumor",
          [],
          64,
          forgotten.generation,
          []
        );
        expect(after.relevant.map((row) => row.section.objectId)).toEqual([
          "courier",
        ]);
        expect(JSON.stringify(after)).not.toContain("180000");
        expect(JSON.stringify(after)).not.toContain("left the company");
        const earlier = yield* authority.getObjectAtRevision(
          alice,
          "salary",
          "2"
        );
        expect(earlier).toBeUndefined();
      })
    ));
});
