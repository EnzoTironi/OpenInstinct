import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ConcurrentModificationError } from "./errors";
import type { ObjectInstance } from "./object-type";
import { InMemoryObjectStore } from "./object-store";
import { LinkTypeId, ObjectTypeId } from "./types";

const personType = ObjectTypeId.make("Person");
const knows = LinkTypeId.make("knows");

function person(
  id: string,
  version: number,
  displayName: string
): ObjectInstance {
  return {
    id,
    lastModifiedAt: 0,
    properties: { displayName },
    typeId: personType,
    version,
  };
}

describe("InMemoryObjectStore", () => {
  it("does accept the first revision and rejects a stale overwrite", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const store = new InMemoryObjectStore();
        const created = yield* store.putObject(person("ana", 1, "Ana"));
        expect(created.version).toBe(1);
        expect(created.lastModifiedAt).toBeGreaterThan(0);

        const stale = yield* store
          .putObject(person("ana", 1, "Ana Maria"))
          .pipe(Effect.flip);
        expect(stale).toBeInstanceOf(ConcurrentModificationError);
        expect(stale.expectedVersion).toBe(2);
        expect(stale.actualVersion).toBe(1);

        const updated = yield* store.putObject(person("ana", 2, "Ana Maria"));
        expect(updated.properties.displayName).toBe("Ana Maria");
        const current = yield* store.getObject(personType, "ana");
        expect(current?.properties.displayName).toBe("Ana Maria");
      })
    ));

  it("does isolate clones so callers cannot mutate stored state", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const store = new InMemoryObjectStore();
        const created = yield* store.putObject(person("ana", 1, "Ana"));
        const stored = yield* store.getObject(personType, "ana");
        expect(stored).toEqual(created);
        expect(stored).not.toBe(created);
        if (stored) {
          Object.assign(stored.properties, { displayName: "rewritten" });
        }
        const current = yield* store.getObject(personType, "ana");
        expect(current?.properties.displayName).toBe("Ana");
      })
    ));

  it("does commit a valid batch and reject a racing stale batch", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const store = new InMemoryObjectStore();
        yield* store.putObject(person("ana", 1, "Ana"));
        yield* store.commitAtomicTransaction({
          links: [
            {
              createdAt: 1,
              linkTypeId: knows,
              sourceId: "ana",
              targetId: "bia",
            },
          ],
          mutations: [
            { instance: person("ana", 2, "Ana"), type: "put" },
            { instance: person("bia", 1, "Bia"), type: "put" },
          ],
        });
        const links = yield* store.getLinks(knows, "ana");
        expect(links).toHaveLength(1);

        const conflict = yield* store
          .commitAtomicTransaction({
            mutations: [{ instance: person("ana", 2, "stale"), type: "put" }],
          })
          .pipe(Effect.flip);
        expect(conflict).toBeInstanceOf(ConcurrentModificationError);
        const ana = yield* store.getObject(personType, "ana");
        expect(ana?.properties.displayName).toBe("Ana");
      })
    ));

  it("does decode a claim without promoting it to an object", () => {
    const claim = Schema.decodeUnknownSync(
      Schema.Struct({
        claimId: Schema.String,
        propertyName: Schema.String,
        state: Schema.Literals(["proposed"]),
        subjectId: Schema.String,
      })
    )({
      claimId: "c1",
      propertyName: "displayName",
      state: "proposed",
      subjectId: "ana",
    });
    expect(claim.state).toBe("proposed");
  });
});
