import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, Schema } from "effect";
import { expect, it } from "vitest";

import { ObjectTypeId } from "@zoen/operon";
import { InMemoryObjectStore, ObjectInstanceSchema } from "./operon-kernel";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

it("does compile the host kernel without mounting Operon on the runtime", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const store = new InMemoryObjectStore();
      const instance = Schema.decodeUnknownSync(ObjectInstanceSchema)({
        id: "ana",
        lastModifiedAt: 0,
        properties: { displayName: "Ana" },
        typeId: ObjectTypeId.make("Person"),
        version: 1,
      });
      const stored = yield* store.putObject(instance);
      expect(stored.id).toBe("ana");

      const runtime = readFileSync(
        join(repositoryRoot, "server/runtime.ts"),
        "utf8"
      );
      expect(runtime).not.toContain("@zoen/operon");
      expect(runtime).not.toContain("operon-kernel");
      expect(runtime).toContain("Mem0.layer");
    })
  ));
