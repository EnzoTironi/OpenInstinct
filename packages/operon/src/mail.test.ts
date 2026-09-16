import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { ActionHostBinding } from "./catalog";
import {
  InMemoryMail,
  MailRejected,
  applyInboxEvent,
  archiveInboxBatch,
  initialInboxPolicy,
  mailOutcome,
  selectConnectedAccount,
  type InboxItem,
  type MailEffect,
} from "./mail";

const alice: ActionHostBinding = {
  userId: "better-auth:alice",
  workspaceId: "company:acme",
};

const bob: ActionHostBinding = {
  userId: "better-auth:bob",
  workspaceId: "company:acme",
};

describe("host-scoped mail contracts", () => {
  it("does keep address-book contacts distinct from sender observations", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const mail = new InMemoryMail();
        yield* mail.rememberContact(
          alice,
          "ana@work.example",
          "Ana Silva",
          "person:ana-work"
        );
        yield* mail.observeParticipant(alice, "ana@gmail.com", "Ana Silva");

        const byHandle = yield* mail.resolveRecipient(
          alice,
          "ana@work.example"
        );
        expect(byHandle).toEqual({
          handle: "ana@work.example",
          kind: "contact",
          personId: "person:ana-work",
        });
        const sender = yield* mail.resolveRecipient(alice, "ana@gmail.com");
        expect(sender).toEqual({
          displayName: "Ana Silva",
          handle: "ana@gmail.com",
          kind: "participant",
        });
        const named = yield* mail.resolveRecipient(alice, "Ana Silva");
        expect(named).toEqual({ kind: "ambiguous" });
        expect(yield* mail.resolveRecipient(bob, "ana@work.example")).toEqual({
          kind: "unknown",
        });
      })
    ));

  it("does report mailbox and local drafts as drafts, never sent", () => {
    const mailboxDraft: MailEffect = {
      accountId: "Work",
      draftId: "draft_1",
      kind: "mailbox_draft",
    };
    const localDraft: MailEffect = {
      draftId: "local_1",
      kind: "local_draft",
    };
    const sent: MailEffect = {
      accountId: "Work",
      kind: "provider_sent",
      messageId: "msg_1",
      threadId: "thread_1",
    };
    const chat: MailEffect = {
      channel: "web",
      kind: "chat_send",
      messageId: "chat_1",
    };
    expect(mailOutcome(mailboxDraft)).toBe("draft");
    expect(mailOutcome(localDraft)).toBe("draft");
    expect(mailOutcome(sent)).toBe("sent");
    expect(mailOutcome(chat)).toBe("chat_sent");
    expect(mailOutcome(mailboxDraft)).not.toBe("sent");
  });

  it("does require an explicit account when more than one is connected", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const newestLast = ["Personal", "Work"];
        const missing = yield* selectConnectedAccount(newestLast, "").pipe(
          Effect.flip
        );
        expect(missing).toBeInstanceOf(MailRejected);
        if (missing instanceof MailRejected) {
          expect(missing.reason).toBe("account_required");
        }
        expect(yield* selectConnectedAccount(newestLast, "Personal")).toBe(
          "Personal"
        );
        expect(yield* selectConnectedAccount(["Work"], "")).toBe("Work");
        const unknown = yield* selectConnectedAccount(
          ["Work"],
          "Personal"
        ).pipe(Effect.flip);
        if (unknown instanceof MailRejected) {
          expect(unknown.reason).toBe("account_unknown");
        }
        const none = yield* selectConnectedAccount([], "").pipe(Effect.flip);
        if (none instanceof MailRejected) {
          expect(none.reason).toBe("account_missing");
        }
      })
    ));

  it("does not widen inbox autonomy from silence or unapproved text", () => {
    const initial = initialInboxPolicy();
    expect(applyInboxEvent(initial, "silence")).toEqual(initial);
    expect(applyInboxEvent(initial, "unapproved_text")).toEqual(initial);
    expect(applyInboxEvent(initial, "host_authorize_batch")).toEqual({
      archiveScope: "authorized_batch",
      sendAutonomy: "none",
    });
    expect(
      applyInboxEvent(
        { archiveScope: "authorized_batch", sendAutonomy: "none" },
        "silence"
      ).sendAutonomy
    ).toBe("none");
  });

  it("does keep protected and urgent items out of a bounded archive batch", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const items: InboxItem[] = [
          {
            id: "msg-clean",
            protection: "none",
            userId: alice.userId,
            workspaceId: alice.workspaceId,
          },
          {
            id: "msg-urgent",
            protection: "urgent",
            userId: alice.userId,
            workspaceId: alice.workspaceId,
          },
          {
            id: "msg-safe",
            protection: "safelist",
            userId: alice.userId,
            workspaceId: alice.workspaceId,
          },
          {
            id: "msg-preview",
            protection: "preview",
            userId: alice.userId,
            workspaceId: alice.workspaceId,
          },
          {
            id: "msg-bob",
            protection: "none",
            userId: bob.userId,
            workspaceId: bob.workspaceId,
          },
        ];
        const archived = yield* archiveInboxBatch(alice, items, [
          "msg-clean",
          "msg-urgent",
          "msg-safe",
          "msg-preview",
          "msg-bob",
        ]);
        expect(archived).toEqual(["msg-clean"]);
        const oversized = yield* archiveInboxBatch(
          alice,
          items,
          Array.from({ length: 21 }, (_, index) => `msg-${String(index)}`)
        ).pipe(Effect.flip);
        expect(oversized).toBeInstanceOf(MailRejected);
        if (oversized instanceof MailRejected) {
          expect(oversized.reason).toBe("invalid_parameter");
        }
      })
    ));
});
