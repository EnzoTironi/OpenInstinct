import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, Schema } from "effect";
import { expect, it } from "vitest";

import { objectTypeIdSchema } from "@zoen/operon";
import {
  HostScopedRecallCache,
  IngestRejected,
  InMemoryActionLifecycle,
  InMemoryAuthority,
  InMemoryObjectStore,
  InMemorySourceIngest,
  ObjectInstanceSchema,
  classifyLocator,
  evaluateEvidence,
  j1DefinitionArtifact,
  selectHostScopedContext,
} from "./operon-kernel";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

it("does compile the host kernel without mounting Operon on the runtime", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const store = new InMemoryObjectStore();
      const instance = Schema.decodeUnknownSync(ObjectInstanceSchema)({
        id: "ana",
        lastModifiedAt: 0,
        properties: { displayName: "Ana" },
        typeId: objectTypeIdSchema.make("Person"),
        version: 1,
      });
      const stored = yield* store.putObject(instance);
      expect(stored.id).toBe("ana");

      const runtime = readFileSync(
        join(repositoryRoot, "server/runtime.ts"),
        "utf8"
      );
      expect(j1DefinitionArtifact.definitionVersion).toBe("j1.0.0");
      expect(
        evaluateEvidence({ kind: "present", name: "artifactRevision" })
          .disposition
      ).toBe("available");
      expect(
        new InMemoryActionLifecycle().rememberRetrievedPlaybook("proposal text")
          .admission
      ).toBe("proposal");
      const recalled = yield* selectHostScopedContext(
        new InMemoryAuthority(),
        new HostScopedRecallCache(),
        { userId: "better-auth:ana", workspaceId: "personal:ana" },
        "anything at all about Ana",
        [{ id: "rd-ana", objectId: "missing-object" }],
        64,
        1,
        []
      );
      expect(recalled.profile).toBe("lean");
      expect(recalled.requiredEvidence[0]?.status).toBe("missing");
      expect(classifyLocator("http://127.0.0.1/secret")).toEqual({
        kind: "unsafe_locator",
      });
      const ingest = new InMemorySourceIngest();
      const blob = yield* ingest.putBlob(
        { userId: "better-auth:ana", workspaceId: "personal:ana" },
        new TextEncoder().encode("blob first"),
        "text/plain"
      );
      const source = yield* ingest.commitReference(
        { userId: "better-auth:ana", workspaceId: "personal:ana" },
        blob.id,
        "raw"
      );
      expect(source.instructionAuthority).toBe("none");
      const missing = yield* ingest
        .commitReference(
          { userId: "better-auth:ana", workspaceId: "personal:ana" },
          "blob_absent",
          "raw"
        )
        .pipe(Effect.flip);
      expect(missing).toBeInstanceOf(IngestRejected);
      expect(runtime).not.toContain("@zoen/operon");
      expect(runtime).not.toContain("operon-kernel");
      expect(runtime).toContain("Mem0.layer");
    })
  ));
