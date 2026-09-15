import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  AuthorityInputRejected,
  InMemoryAuthority,
  isOperationalPredicate,
} from "./authority";
import type { ActionHostBinding } from "./catalog";
import { projectScopedSection } from "./catalog";

const alice: ActionHostBinding = {
  userId: "better-auth:alice",
  workspaceId: "company:acme",
};

const bob: ActionHostBinding = {
  userId: "better-auth:bob",
  workspaceId: "company:acme",
};

describe("scoped authority", () => {
  it("does keep provider occurrence distinct from operational acceptance", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const authority = new InMemoryAuthority();
        const source = yield* authority.admitSource(
          alice,
          "gmail:msg-1",
          "hist-1",
          {
            from: "ana@example.com",
            receivedAt: "2026-09-15T12:00:00Z",
          },
          1
        );
        const duplicate = yield* authority.admitSource(
          alice,
          "gmail:msg-1",
          "hist-1",
          { from: "ignored@example.com" },
          1
        );
        expect(duplicate.id).toBe(source.id);
        expect(duplicate.metadata.from).toBe("ana@example.com");

        const interpretation = yield* authority.extractClaim(
          alice,
          source.id,
          "commitment:ana",
          "commitment",
          "status",
          "accepted",
          "interpretation"
        );
        yield* authority.acceptClaim(alice, interpretation.id);
        const deadline = yield* authority.extractClaim(
          alice,
          source.id,
          "commitment:ana",
          "commitment",
          "deadline",
          "2026-09-18",
          "interpretation"
        );
        yield* authority.acceptClaim(alice, deadline.id);

        const current = yield* authority.getObject(alice, "commitment:ana");
        expect(current?.operationalStatus).toBe("proposed");
        expect(current?.body.status).toBeUndefined();
        expect(current?.body.deadline).toBe("2026-09-18");
        expect(isOperationalPredicate("status")).toBe(true);

        const evidence = yield* authority.queryEvidence(
          alice,
          "commitment:ana"
        );
        expect(evidence.sources.map((row) => row.providerId)).toEqual([
          "gmail:msg-1",
        ]);
        expect(evidence.claims.map((row) => row.kind)).toEqual([
          "interpretation",
          "interpretation",
        ]);
        expect(
          projectScopedSection(
            {
              id: "deadline-current",
              objectId: current?.id ?? "",
              revision: current?.revision ?? "",
            },
            alice
          )
        ).toMatchObject({
          objectId: "commitment:ana",
          userId: alice.userId,
          workspaceId: alice.workspaceId,
        });
      })
    ));

  it("does reconstruct an earlier object revision after a correction", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const authority = new InMemoryAuthority();
        const source = yield* authority.admitSource(
          alice,
          "gmail:msg-2",
          "hist-2",
          { quoted: "Friday then Thursday" },
          2
        );
        const friday = yield* authority.extractClaim(
          alice,
          source.id,
          "commitment:brief",
          "commitment",
          "deadline",
          "Friday",
          "interpretation"
        );
        yield* authority.acceptClaim(alice, friday.id);
        const first = yield* authority.getObject(alice, "commitment:brief");
        const thursday = yield* authority.extractClaim(
          alice,
          source.id,
          "commitment:brief",
          "commitment",
          "deadline",
          "Thursday",
          "interpretation"
        );
        yield* authority.acceptClaim(alice, thursday.id);
        const current = yield* authority.getObject(alice, "commitment:brief");
        expect(current?.body.deadline).toBe("Thursday");
        const earlier = yield* authority.getObjectAtRevision(
          alice,
          "commitment:brief",
          first?.revision ?? "1"
        );
        expect(earlier?.body.deadline).toBe("Friday");
      })
    ));

  it("does merge only a supported identity match and can separate it", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const authority = new InMemoryAuthority();
        const anaWork = yield* authority.rememberIdentity(
          alice,
          "ana@work.example",
          "person:ana-work"
        );
        const anaHome = yield* authority.rememberIdentity(
          alice,
          "ana@home.example",
          "person:ana-home"
        );
        const otherAna = yield* authority.rememberIdentity(
          alice,
          "ana@other.example",
          "person:ana-other"
        );
        const unsupported = yield* authority.admitSource(
          alice,
          "gmail:msg-3",
          "hist-3",
          { from: "ana@work.example" },
          3
        );
        const unsupportedMerge = yield* authority.proposeMerge(
          alice,
          anaWork.id,
          otherAna.id,
          unsupported.id
        );
        const rejected = yield* authority
          .acceptMerge(alice, unsupportedMerge.id)
          .pipe(Effect.flip);
        expect(rejected).toBeInstanceOf(AuthorityInputRejected);
        expect(rejected.reason).toBe("unsupported_match");

        const missing = yield* authority
          .proposeMerge(alice, anaWork.id, anaHome.id, "src_missing")
          .pipe(Effect.flip);
        expect(missing.reason).toBe("missing_evidence");

        const verified = yield* authority.admitSource(
          alice,
          "gmail:msg-4",
          "hist-4",
          {
            from: "ana@work.example",
            replyTo: "ana@home.example",
          },
          4
        );
        const merge = yield* authority.proposeMerge(
          alice,
          anaWork.id,
          anaHome.id,
          verified.id
        );
        yield* authority.acceptMerge(alice, merge.id);
        const merged = yield* authority.listIdentities(
          alice,
          "person:ana-work"
        );
        expect(merged.map((row) => row.handle).toSorted()).toEqual([
          "ana@home.example",
          "ana@work.example",
        ]);
        expect(
          (yield* authority.listIdentities(alice, "person:ana-home")).map(
            (row) => row.handle
          )
        ).toEqual([]);

        yield* authority.separateMerge(alice, merge.id);
        expect(
          (yield* authority.listIdentities(alice, "person:ana-home")).map(
            (row) => row.handle
          )
        ).toEqual(["ana@home.example"]);
        expect(
          (yield* authority.listIdentities(alice, "person:ana-other")).map(
            (row) => row.handle
          )
        ).toEqual(["ana@other.example"]);
      })
    ));

  it("does not reveal another principal's sources in the same workspace", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const authority = new InMemoryAuthority();
        const source = yield* authority.admitSource(
          alice,
          "gmail:private",
          "hist-private",
          { snippet: "salary 180000" },
          5
        );
        yield* authority.extractClaim(
          alice,
          source.id,
          "commitment:salary",
          "commitment",
          "amount",
          180000,
          "interpretation"
        );

        expect(yield* authority.countSources(alice)).toBe(1);
        expect(yield* authority.countSources(bob)).toBe(0);
        expect(
          yield* authority.getObject(bob, "commitment:salary")
        ).toBeUndefined();
        expect(yield* authority.getObject(bob, source.id)).toBeUndefined();
        const bobEvidence = yield* authority.queryEvidence(
          bob,
          "commitment:salary"
        );
        expect(bobEvidence).toEqual({ claims: [], sources: [] });
        const stolen = yield* authority
          .extractClaim(
            bob,
            source.id,
            "commitment:salary",
            "commitment",
            "amount",
            180000,
            "interpretation"
          )
          .pipe(Effect.flip);
        expect(stolen).toBeInstanceOf(AuthorityInputRejected);
        expect(stolen.reason).toBe("invalid_parameter");
      })
    ));
});
