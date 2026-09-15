import { Clock, Effect } from "effect";

import { ConcurrentModificationError } from "./errors";
import type { LinkInstance } from "./link-type";
import type { ObjectInstance } from "./object-type";
import type { LinkTypeId, ObjectTypeId } from "./types";

export type ObjectMutation =
  | {
      readonly type: "put";
      readonly instance: ObjectInstance;
    }
  | {
      readonly type: "delete";
      readonly typeId: ObjectTypeId;
      readonly id: string;
    };

export interface AtomicTransactionBatch {
  readonly mutations: readonly ObjectMutation[];
  readonly links?: readonly LinkInstance[];
}

export interface ObjectStore {
  readonly getObject: (
    typeId: ObjectTypeId,
    id: string
  ) => Effect.Effect<ObjectInstance | undefined>;
  readonly putObject: (
    instance: ObjectInstance
  ) => Effect.Effect<ObjectInstance, ConcurrentModificationError>;
  readonly deleteObject: (
    typeId: ObjectTypeId,
    id: string
  ) => Effect.Effect<void>;
  readonly findObjects: (
    typeId: ObjectTypeId,
    predicate?: (instance: ObjectInstance) => boolean
  ) => Effect.Effect<readonly ObjectInstance[]>;
  readonly linkObjects: (link: LinkInstance) => Effect.Effect<void>;
  readonly getLinks: (
    linkTypeId: LinkTypeId,
    sourceId: string
  ) => Effect.Effect<readonly LinkInstance[]>;
  readonly getReverseLinks: (
    linkTypeId: LinkTypeId,
    targetId: string
  ) => Effect.Effect<readonly LinkInstance[]>;
  readonly commitAtomicTransaction: (
    batch: AtomicTransactionBatch
  ) => Effect.Effect<void, ConcurrentModificationError>;
}

function objectKey(typeId: ObjectTypeId, id: string): string {
  return `${typeId}:${id}`;
}

function cloneInstance(instance: ObjectInstance): ObjectInstance {
  return structuredClone(instance);
}

function failStalePut(
  existing: ObjectInstance,
  instance: ObjectInstance
): Effect.Effect<never, ConcurrentModificationError> {
  return new ConcurrentModificationError({
    actualVersion: instance.version,
    expectedVersion: existing.version + 1,
    objectId: instance.id,
  });
}

const putObjectImpl = Effect.fn("InMemoryObjectStore.putObject")(function* (
  objects: Map<string, ObjectInstance>,
  instance: ObjectInstance
) {
  const key = objectKey(instance.typeId, instance.id);
  const existing = objects.get(key);
  if (existing && instance.version !== existing.version + 1) {
    return yield* failStalePut(existing, instance);
  }
  const now = yield* Clock.currentTimeMillis;
  const copy: ObjectInstance = {
    ...cloneInstance(instance),
    lastModifiedAt: now,
  };
  objects.set(key, copy);
  return cloneInstance(copy);
});

const commitAtomicTransactionImpl = Effect.fn(
  "InMemoryObjectStore.commitAtomicTransaction"
)(function* (
  objects: Map<string, ObjectInstance>,
  addLink: (link: LinkInstance) => Effect.Effect<void>,
  batch: AtomicTransactionBatch
) {
  for (const mutation of batch.mutations) {
    switch (mutation.type) {
      case "put": {
        const existing = objects.get(
          objectKey(mutation.instance.typeId, mutation.instance.id)
        );
        if (existing && mutation.instance.version !== existing.version + 1) {
          return yield* failStalePut(existing, mutation.instance);
        }
        break;
      }
      case "delete":
        break;
      default: {
        const unexpected: never = mutation;
        return unexpected;
      }
    }
  }
  const now = yield* Clock.currentTimeMillis;
  for (const mutation of batch.mutations) {
    switch (mutation.type) {
      case "put": {
        objects.set(objectKey(mutation.instance.typeId, mutation.instance.id), {
          ...cloneInstance(mutation.instance),
          lastModifiedAt: now,
        });
        break;
      }
      case "delete":
        objects.delete(objectKey(mutation.typeId, mutation.id));
        break;
      default: {
        const unexpected: never = mutation;
        return unexpected;
      }
    }
  }
  if (batch.links) {
    for (const link of batch.links) {
      yield* addLink(link);
    }
  }
});

/**
 * In-memory ObjectStore with optimistic concurrency. Version N may replace
 * only version N-1. There is no snapshot JSON export; Zoen Postgres is the
 * later authority.
 */
export class InMemoryObjectStore implements ObjectStore {
  readonly #objects = new Map<string, ObjectInstance>();
  readonly #links: LinkInstance[] = [];

  getObject(
    typeId: ObjectTypeId,
    id: string
  ): Effect.Effect<ObjectInstance | undefined> {
    return Effect.sync(() => {
      const instance = this.#objects.get(objectKey(typeId, id));
      return instance ? cloneInstance(instance) : undefined;
    });
  }

  putObject(
    instance: ObjectInstance
  ): Effect.Effect<ObjectInstance, ConcurrentModificationError> {
    return putObjectImpl(this.#objects, instance);
  }

  deleteObject(typeId: ObjectTypeId, id: string): Effect.Effect<void> {
    return Effect.sync(() => {
      this.#objects.delete(objectKey(typeId, id));
    });
  }

  findObjects(
    typeId: ObjectTypeId,
    predicate?: (instance: ObjectInstance) => boolean
  ): Effect.Effect<readonly ObjectInstance[]> {
    return Effect.sync(() => {
      const prefix = `${typeId}:`;
      const results: ObjectInstance[] = [];
      for (const [key, instance] of this.#objects) {
        if (!key.startsWith(prefix)) continue;
        if (predicate && !predicate(instance)) continue;
        results.push(cloneInstance(instance));
      }
      return results;
    });
  }

  linkObjects(link: LinkInstance): Effect.Effect<void> {
    return Effect.sync(() => {
      const exists = this.#links.some(
        (candidate) =>
          candidate.linkTypeId === link.linkTypeId &&
          candidate.sourceId === link.sourceId &&
          candidate.targetId === link.targetId
      );
      if (!exists) this.#links.push(structuredClone(link));
    });
  }

  getLinks(
    linkTypeId: LinkTypeId,
    sourceId: string
  ): Effect.Effect<readonly LinkInstance[]> {
    return Effect.sync(() =>
      this.#links
        .filter(
          (link) => link.linkTypeId === linkTypeId && link.sourceId === sourceId
        )
        .map((link) => structuredClone(link))
    );
  }

  getReverseLinks(
    linkTypeId: LinkTypeId,
    targetId: string
  ): Effect.Effect<readonly LinkInstance[]> {
    return Effect.sync(() =>
      this.#links
        .filter(
          (link) => link.linkTypeId === linkTypeId && link.targetId === targetId
        )
        .map((link) => structuredClone(link))
    );
  }

  commitAtomicTransaction(
    batch: AtomicTransactionBatch
  ): Effect.Effect<void, ConcurrentModificationError> {
    return commitAtomicTransactionImpl(
      this.#objects,
      (link) => this.linkObjects(link),
      batch
    );
  }
}
