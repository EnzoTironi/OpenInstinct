import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { InMemoryAuthority } from "./authority";
import {
  acceptCommitmentAction,
  prepareDeliveryAction,
  proposeCommitmentAction,
  type ActionHostBinding,
} from "./catalog";
import {
  deliveryFulfillment,
  InMemoryJ1Workflow,
  J1WorkflowRejected,
} from "./j1";
import {
  ActionLifecycleRejected,
  InMemoryActionLifecycle,
  type EvidenceObservation,
  type EvidenceObservationKind,
} from "./lifecycle";
import { InMemoryMail, mailOutcome } from "./mail";
import { whatsAppSendClaim } from "./whatsapp";

const alice: ActionHostBinding = {
  userId: "better-auth:alice",
  workspaceId: "company:acme",
};

const bob: ActionHostBinding = {
  userId: "better-auth:bob",
  workspaceId: "company:acme",
};

const destination = {
  artifactRevision: "art_1",
  attachments: ["att_brief"],
  recipientHandles: ["ana@work.example"],
  replyAll: true,
  threadId: "thread_ana",
};

function observations(
  kind: EvidenceObservationKind,
  names: readonly string[]
): EvidenceObservation[] {
  return names.map((name) => ({ kind, name }));
}

const acceptAndPrepare = Effect.fn("acceptAndPrepare")(function* (
  lifecycle: InMemoryActionLifecycle,
  authority: InMemoryAuthority
) {
  const accepted = yield* lifecycle.prepareAction(
    acceptCommitmentAction,
    alice,
    { artifactRevision: "art_1", commitmentId: "cmt_ana" },
    observations("present", acceptCommitmentAction.requiredEvidence),
    1
  );
  const acceptedApproval = yield* lifecycle.issueHostApproval(
    accepted,
    "user",
    1
  );
  yield* lifecycle.commitPreparedAction(
    authority,
    accepted,
    acceptedApproval,
    1,
    "1"
  );
  const prepared = yield* lifecycle.prepareAction(
    prepareDeliveryAction,
    alice,
    { artifactRevision: "art_1", commitmentId: "cmt_ana" },
    observations("present", prepareDeliveryAction.requiredEvidence),
    1
  );
  const preparedApproval = yield* lifecycle.issueHostApproval(
    prepared,
    "user",
    1
  );
  yield* lifecycle.commitPreparedAction(
    authority,
    prepared,
    preparedApproval,
    1,
    "2"
  );
});

describe("host-scoped J1 delivery workflow", () => {
  it("does ask on missing evidence and bind the current revision at the destination", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = new InMemoryActionLifecycle();
        const authority = new InMemoryAuthority();
        const mail = new InMemoryMail();
        const workflow = new InMemoryJ1Workflow(authority, mail);

        const missing = yield* lifecycle
          .prepareAction(
            proposeCommitmentAction,
            alice,
            {
              artifactRevision: "art_1",
              channelGrantId: "grant_mail",
              recipientHandle: "ana@work.example",
              title: "Send the red Q3 brief",
            },
            observations("absent", proposeCommitmentAction.requiredEvidence),
            1
          )
          .pipe(Effect.flip);
        expect(missing).toBeInstanceOf(ActionLifecycleRejected);
        if (missing instanceof ActionLifecycleRejected) {
          expect(missing.reason).toBe("evidence_insufficient");
          expect(missing.diagnostics).toEqual(
            proposeCommitmentAction.requiredEvidence.map((name) => ({
              disposition: "missing",
              name,
              next: "ask_user",
            }))
          );
        }

        yield* acceptAndPrepare(lifecycle, authority);
        const unresolved = yield* workflow
          .prepareDraft(alice, "cmt_ana", destination)
          .pipe(Effect.flip);
        expect(unresolved).toBeInstanceOf(J1WorkflowRejected);
        if (unresolved instanceof J1WorkflowRejected) {
          expect(unresolved.reason).toBe("recipient_unresolved");
        }

        yield* mail.rememberContact(
          alice,
          "ana@work.example",
          "Ana Silva",
          "person:ana-work"
        );
        const forged = yield* workflow
          .prepareDraft(alice, "cmt_ana", {
            ...destination,
            userId: bob.userId,
            workspaceId: bob.workspaceId,
          })
          .pipe(Effect.flip);
        expect(forged).toBeInstanceOf(J1WorkflowRejected);
        if (forged instanceof J1WorkflowRejected) {
          expect(forged.reason).toBe("invalid_parameter");
        }

        const draft = yield* workflow.prepareDraft(
          alice,
          "cmt_ana",
          destination
        );
        expect(mailOutcome(draft.effect)).toBe("draft");
        expect(deliveryFulfillment(draft.effect)).toBe("incomplete");
        const observed = yield* workflow.observeDestination(alice, draft.id);
        expect(observed).toEqual(destination);
        expect(observed.artifactRevision).toBe("art_1");
        expect(observed.recipientHandles).toEqual(["ana@work.example"]);
        expect(observed.threadId).toBe("thread_ana");
        expect(observed.attachments).toEqual(["att_brief"]);
        expect(observed.replyAll).toBe(true);
        expect(
          yield* workflow.observeDestination(bob, draft.id).pipe(Effect.flip)
        ).toBeInstanceOf(J1WorkflowRejected);
      })
    ));

  it("does invalidate an interrupted draft and refuse a second completed effect", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = new InMemoryActionLifecycle();
        const authority = new InMemoryAuthority();
        const mail = new InMemoryMail();
        const workflow = new InMemoryJ1Workflow(authority, mail);
        yield* acceptAndPrepare(lifecycle, authority);
        yield* mail.rememberContact(
          alice,
          "ana@work.example",
          "Ana Silva",
          "person:ana-work"
        );
        yield* workflow.changeDeadline(
          alice,
          "cmt_ana",
          "2026-09-19T17:00:00.000Z"
        );
        const original = yield* workflow.prepareDraft(
          alice,
          "cmt_ana",
          destination
        );
        expect(original.deadline).toBe("2026-09-19T17:00:00.000Z");
        expect(mailOutcome(original.effect)).toBe("draft");

        const interrupted = yield* workflow.interrupt(alice, original.id);
        expect(interrupted.status).toBe("invalidated");
        yield* workflow.changeDeadline(
          alice,
          "cmt_ana",
          "2026-09-22T17:00:00.000Z"
        );
        const staleObserved = yield* workflow.observeDestination(
          alice,
          original.id
        );
        expect(staleObserved.artifactRevision).toBe("art_1");
        const staleSend = yield* workflow
          .recordEffect(alice, original.id, {
            accountId: "Work",
            kind: "provider_sent",
            messageId: "msg_old",
            threadId: "thread_ana",
          })
          .pipe(Effect.flip);
        expect(staleSend).toBeInstanceOf(J1WorkflowRejected);
        if (staleSend instanceof J1WorkflowRejected) {
          expect(staleSend.reason).toBe("draft_invalidated");
        }

        const resumed = yield* workflow.prepareDraft(
          alice,
          "cmt_ana",
          destination
        );
        expect(resumed.id).not.toBe(original.id);
        expect(resumed.deadline).toBe("2026-09-22T17:00:00.000Z");
        expect(resumed.status).toBe("prepared");
        expect(deliveryFulfillment(resumed.effect)).toBe("incomplete");

        const queued = yield* workflow
          .recordEffect(alice, resumed.id, {
            delivery: "queued",
            kind: "whatsapp_send",
            messageId: "wa_1",
          })
          .pipe(Effect.flip);
        expect(queued).toBeInstanceOf(J1WorkflowRejected);
        if (queued instanceof J1WorkflowRejected) {
          expect(queued.reason).toBe("fulfillment_not_sent");
        }
        expect(whatsAppSendClaim("queued")).toBe("pending");
        expect(deliveryFulfillment(resumed.effect)).not.toBe("completed");

        const wrongThread = yield* workflow
          .recordEffect(alice, resumed.id, {
            accountId: "Work",
            kind: "provider_sent",
            messageId: "msg_1",
            threadId: "thread_other",
          })
          .pipe(Effect.flip);
        if (wrongThread instanceof J1WorkflowRejected) {
          expect(wrongThread.reason).toBe("invalid_parameter");
        }

        const completed = yield* workflow.recordEffect(alice, resumed.id, {
          accountId: "Work",
          kind: "provider_sent",
          messageId: "msg_1",
          threadId: "thread_ana",
        });
        expect(completed.status).toBe("completed");
        expect(
          deliveryFulfillment({
            accountId: "Work",
            kind: "provider_sent",
            messageId: "msg_1",
            threadId: "thread_ana",
          })
        ).toBe("completed");

        const duplicate = yield* workflow
          .recordEffect(alice, resumed.id, {
            accountId: "Work",
            kind: "provider_sent",
            messageId: "msg_2",
            threadId: "thread_ana",
          })
          .pipe(Effect.flip);
        expect(duplicate).toBeInstanceOf(J1WorkflowRejected);
        if (duplicate instanceof J1WorkflowRejected) {
          expect(duplicate.reason).toBe("already_completed");
        }
        const secondDraft = yield* workflow
          .prepareDraft(alice, "cmt_ana", destination)
          .pipe(Effect.flip);
        if (secondDraft instanceof J1WorkflowRejected) {
          expect(secondDraft.reason).toBe("already_completed");
        }
      })
    ));
});
