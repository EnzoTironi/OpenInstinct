import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { ActionHostBinding } from "./catalog";
import {
  InMemoryWhatsApp,
  WhatsAppRejected,
  claimExhaustiveWhatsAppHistory,
  whatsAppSendClaim,
} from "./whatsapp";

const alice: ActionHostBinding = {
  userId: "better-auth:alice",
  workspaceId: "company:acme",
};

const bob: ActionHostBinding = {
  userId: "better-auth:bob",
  workspaceId: "company:acme",
};

describe("host-scoped WhatsApp grants", () => {
  it("does refuse reads and catch-up until a chat is authorized", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bridge = new InMemoryWhatsApp();
        const unpaired = yield* bridge
          .storeChat(alice, "chat-ana")
          .pipe(Effect.flip);
        expect(unpaired).toBeInstanceOf(WhatsAppRejected);
        if (unpaired instanceof WhatsAppRejected) {
          expect(unpaired.reason).toBe("unpaired");
        }

        const pairing = yield* bridge.connect(alice);
        const ana = yield* bridge.storeChat(alice, "chat-ana");
        const bruno = yield* bridge.storeChat(alice, "chat-bruno");
        yield* bridge.storeMessage(alice, ana, "salary 9");
        yield* bridge.storeMessage(alice, bruno, "courier Friday");

        const denied = yield* bridge.readMessages(alice, ana).pipe(Effect.flip);
        expect(denied).toBeInstanceOf(WhatsAppRejected);
        if (denied instanceof WhatsAppRejected) {
          expect(denied.reason).toBe("unauthorized_chat");
        }

        yield* bridge.authorizeChat(alice, ana);
        expect(yield* bridge.readMessages(alice, ana)).toEqual(["salary 9"]);
        const stillDenied = yield* bridge
          .readMessages(alice, bruno)
          .pipe(Effect.flip);
        if (stillDenied instanceof WhatsAppRejected) {
          expect(stillDenied.reason).toBe("unauthorized_chat");
        }

        const catchUp = yield* bridge.catchUp(alice);
        expect(catchUp.chatIds).toEqual([ana]);
        expect(catchUp.history).toBe("partial");
        const overclaim = yield* claimExhaustiveWhatsAppHistory(
          catchUp.history
        ).pipe(Effect.flip);
        expect(overclaim).toBeInstanceOf(WhatsAppRejected);
        if (overclaim instanceof WhatsAppRejected) {
          expect(overclaim.reason).toBe("coverage_overclaim");
        }

        const agentView = yield* bridge.listAgentChats(alice);
        expect(agentView.map((chat) => chat.id)).toEqual([ana]);
        expect(JSON.stringify(agentView)).not.toContain(pairing.pairingNonce);

        expect(
          yield* bridge.readMessages(bob, ana).pipe(Effect.flip)
        ).toBeInstanceOf(WhatsAppRejected);
      })
    ));

  it("does require a new grant after revocation and keeps queued send pending", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bridge = new InMemoryWhatsApp();
        yield* bridge.connect(alice);
        const ana = yield* bridge.storeChat(alice, "chat-ana");
        yield* bridge.storeMessage(alice, ana, "hi");
        yield* bridge.authorizeChat(alice, ana);
        yield* bridge.markHistory(alice, ana, "complete");
        expect((yield* bridge.catchUp(alice)).history).toBe("complete");
        yield* claimExhaustiveWhatsAppHistory("complete");

        yield* bridge.revokeChat(alice, ana);
        const revoked = yield* bridge
          .readMessages(alice, ana)
          .pipe(Effect.flip);
        if (revoked instanceof WhatsAppRejected) {
          expect(revoked.reason).toBe("unauthorized_chat");
        }
        expect((yield* bridge.catchUp(alice)).chatIds).toEqual([]);

        expect(whatsAppSendClaim("queued")).toBe("pending");
        expect(whatsAppSendClaim("accepted")).toBe("pending");
        expect(whatsAppSendClaim("delivered")).toBe("delivered");
      })
    ));
});
