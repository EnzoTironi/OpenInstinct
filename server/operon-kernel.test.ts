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
  MailRejected,
  ObjectInstanceSchema,
  classifyLocator,
  computerScopeKey,
  deliveryFulfillment,
  embeddedRuntimeDecision,
  evaluateEvidence,
  guestEnvironment,
  j1DefinitionArtifact,
  mailOutcome,
  replyLengthPolicy,
  pollInbox,
  projectChildDelivery,
  selectConnectedAccount,
  selectHostScopedContext,
  whatsAppSendClaim,
} from "./operon-kernel";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

it("does compile the host kernel and mount Operon learned notes without Mem0", () =>
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
      const learned = readFileSync(
        join(repositoryRoot, "server/memory/learned.ts"),
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
      expect(mailOutcome({ draftId: "draft_1", kind: "local_draft" })).toBe(
        "draft"
      );
      const implicitAccount = yield* selectConnectedAccount(
        ["Personal", "Work"],
        ""
      ).pipe(Effect.flip);
      expect(implicitAccount).toBeInstanceOf(MailRejected);
      expect(whatsAppSendClaim("queued")).toBe("pending");
      expect(
        deliveryFulfillment({ draftId: "draft_1", kind: "local_draft" })
      ).toBe("incomplete");
      expect(replyLengthPolicy("analysis")).toBe("full");
      expect(pollInbox("", [], 0).modelJudgment).toBe(false);
      const child = yield* projectChildDelivery(
        { userId: "better-auth:ana", workspaceId: "personal:ana" },
        { userId: "better-auth:ana" }
      );
      expect(child.finalReply).toBe(false);
      expect(embeddedRuntimeDecision.selected).toBe("eve-just-bash");
      expect(embeddedRuntimeDecision.agentOs).toBe("no-go");
      expect(
        computerScopeKey({
          kind: "private",
          userId: "better-auth:ana",
          workspaceId: "personal:ana",
        })
      ).not.toBe(
        computerScopeKey({
          kind: "shared",
          audienceId: "group:ana",
          workspaceId: "personal:ana",
        })
      );
      expect(
        guestEnvironment({ DATABASE_URL: "postgresql://x", PATH: "/bin" })
      ).toEqual({ PATH: "/bin" });
      expect(runtime).toContain("@zoen/operon");
      expect(runtime).toContain("LearnedMemory.layer");
      expect(runtime).not.toContain("Mem0.layer");
      expect(learned).toContain("learnedNoteTypeId");
      expect(learned).not.toContain("Mem0");
    })
  ));
