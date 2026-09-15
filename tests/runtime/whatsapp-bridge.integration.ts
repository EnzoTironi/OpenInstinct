import { randomUUID } from "node:crypto";
import { Effect, Layer, Redacted, Result, Schema } from "effect";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type * as Environment from "@shared/environment";
import { contactNetworkBot } from "../../server/workspaces/network";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { removeWorkspaceMember } from "../../server/workspaces/team";
import { acceptMatrixTransaction } from "../../server/matrix/inbound";
import {
  authorizeWhatsAppChat,
  authorizeWhatsAppDraft,
  confirmWhatsAppPairing,
  ConfirmWhatsAppPairingSchema,
  draftWhatsAppMessage,
  importWhatsAppContacts,
  ingestWhatsAppEvent,
  listWhatsAppAccounts,
  listWhatsAppChats,
  pauseWhatsAppBridge,
  readWhatsAppMessages,
  requireWhatsAppBridge,
  resumeWhatsAppBridge,
  revokeWhatsAppBridge,
  sendWhatsAppDraft,
  shareWhatsAppChat,
  startWhatsAppPairing,
  summarizeWhatsAppChat,
  WhatsAppBridgeUnavailable,
} from "../../server/workspaces/whatsapp";
import {
  MATRIX_HS_TOKEN,
  WHATSAPP_AS_TOKEN,
  WHATSAPP_BRIDGE_PORT,
  WHATSAPP_PROVISIONING_SECRET,
  whatsappBridgeFixture,
} from "./whatsapp-bridge-fixture";
import { runtimeDatabase } from "./database";
import { workspaceFixture } from "./workspace-fixture";

vi.mock("@shared/environment", async (original) => {
  const actual = await original<typeof Environment>();
  return {
    ...actual,
    env: {
      ...actual.env,
      ZOEN_MATRIX_URL: `http://127.0.0.1:${WHATSAPP_BRIDGE_PORT}`,
      ZOEN_MATRIX_SERVER_NAME: "zoen.test",
      ZOEN_MATRIX_AS_TOKEN: Redacted.make(
        "synthetic-zoen-matrix-appservice-token-32b"
      ),
      ZOEN_MATRIX_HS_TOKEN: Redacted.make(MATRIX_HS_TOKEN),
      ZOEN_WHATSAPP_BRIDGE_URL: `http://127.0.0.1:${WHATSAPP_BRIDGE_PORT}`,
      ZOEN_WHATSAPP_PROVISIONING_SECRET: Redacted.make(
        WHATSAPP_PROVISIONING_SECRET
      ),
      ZOEN_WHATSAPP_AS_TOKEN: Redacted.make(WHATSAPP_AS_TOKEN),
    },
  };
});

const services = WorkspaceRepository.layer.pipe(
  Layer.provideMerge(runtimeDatabase)
);
const denied = <A, E>(result: Result.Result<A, E>) => {
  expect(Result.isFailure(result)).toBe(true);
};
let fixture: Awaited<ReturnType<typeof whatsappBridgeFixture>>;
beforeAll(async () => {
  fixture = await whatsappBridgeFixture();
});
afterAll(async () => {
  await fixture.close();
});

const connect = Effect.fn("whatsapp.connect")(function* (
  owner: Parameters<typeof startWhatsAppPairing>[0],
  remoteUserId: string
) {
  const pairing = yield* startWhatsAppPairing(owner);
  expect(pairing.matrixUserId).toBeTruthy();
  fixture.completeLogin(pairing.matrixUserId ?? "", remoteUserId);
  yield* confirmWhatsAppPairing({
    accountId: pairing.id,
    pairingNonce: pairing.pairingNonce,
  });
  return pairing.id;
});

test("WhatsApp user bridge stays unavailable without a paired mautrix session", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* requireWhatsAppBridge().pipe(Effect.result);
      expect(Result.isFailure(result) && result.failure).toBeInstanceOf(
        WhatsAppBridgeUnavailable
      );
      fixture.setReady(false);
      const down = yield* requireWhatsAppBridge().pipe(Effect.result);
      expect(Result.isFailure(down) && down.failure).toBeInstanceOf(
        WhatsAppBridgeUnavailable
      );
      fixture.setReady(true);
      return true;
    }).pipe(Effect.provide(services))
  ));

test("the agent reads only authorized chats and never delivers without a live session", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, guest, personal, sql } = yield* workspaceFixture();
      const dmCanary = `canary-dm-${randomUUID()}`;
      const groupCanary = `canary-group-${randomUUID()}`;
      const dmRemote = `dm:${randomUUID()}`;
      const groupRemote = `group:${randomUUID()}`;
      const roomId = `!dm-${randomUUID()}:zoen.test`;
      denied(yield* startWhatsAppPairing(actor).pipe(Effect.result));
      denied(yield* startWhatsAppPairing(guest).pipe(Effect.result));
      const pairing = yield* startWhatsAppPairing(personal);
      expect(pairing.qr).toBe("synthetic-whatsapp-qr");
      denied(
        yield* confirmWhatsAppPairing({
          accountId: pairing.id,
          pairingNonce: "kapso-bot-session",
        }).pipe(Effect.result)
      );
      denied(
        yield* Schema.decodeUnknownEffect(ConfirmWhatsAppPairingSchema, {
          onExcessProperty: "error",
        })({
          accountId: pairing.id,
          pairingNonce: pairing.pairingNonce,
          remoteUserId: `wa:${randomUUID()}`,
          botToken: "kapso-secret",
        }).pipe(Effect.result)
      );
      denied(
        yield* confirmWhatsAppPairing({
          accountId: pairing.id,
          pairingNonce: pairing.pairingNonce,
        }).pipe(Effect.result)
      );
      const remoteUserId = `wa:${randomUUID()}`;
      fixture.completeLogin(pairing.matrixUserId ?? "", remoteUserId);
      yield* confirmWhatsAppPairing({
        accountId: pairing.id,
        pairingNonce: pairing.pairingNonce,
      });
      const listed = yield* listWhatsAppAccounts(personal);
      expect(listed.map((row) => row.handle)).toEqual([pairing.id]);
      expect(JSON.stringify(listed)).not.toContain(pairing.pairingNonce);
      expect(listed[0]?.status).toBe("connected");
      expect(listed[0]?.remoteUserId).toBe(remoteUserId);
      const dm = yield* authorizeWhatsAppChat(personal, {
        remoteChatId: dmRemote,
        kind: "dm",
        matrixRoomId: roomId,
      });
      const group = yield* authorizeWhatsAppChat(personal, {
        remoteChatId: groupRemote,
        kind: "group",
      });
      const backfill = yield* ingestWhatsAppEvent({
        accountId: pairing.id,
        remoteChatId: dmRemote,
        providerEventId: "evt-1",
        kind: "backfill",
        authorRemoteId: "wa:peer",
        body: dmCanary,
      });
      expect(backfill.alert).toBe(false);
      expect(
        yield* ingestWhatsAppEvent({
          accountId: pairing.id,
          remoteChatId: dmRemote,
          providerEventId: "evt-1",
          kind: "live",
          authorRemoteId: "wa:peer",
          body: dmCanary,
        })
      ).toEqual({ id: backfill.id, duplicate: true, alert: false });
      expect(
        (yield* ingestWhatsAppEvent({
          accountId: pairing.id,
          remoteChatId: dmRemote,
          providerEventId: "evt-2",
          kind: "live",
          authorRemoteId: "wa:peer",
          body: dmCanary,
        })).alert
      ).toBe(true);
      yield* ingestWhatsAppEvent({
        accountId: pairing.id,
        remoteChatId: groupRemote,
        providerEventId: "evt-3",
        kind: "live",
        authorRemoteId: "wa:peer",
        body: groupCanary,
      });
      const inboundId = `$wa-${randomUUID()}`;
      yield* acceptMatrixTransaction(
        new Request("http://localhost/transactions", {
          method: "PUT",
          headers: { authorization: `Bearer ${MATRIX_HS_TOKEN}` },
          body: JSON.stringify({
            events: [
              {
                event_id: inboundId,
                room_id: roomId,
                type: "m.room.message",
                sender: "@whatsapp_peer:zoen.test",
                content: { body: `${dmCanary}-matrix`, msgtype: "m.text" },
              },
            ],
          }),
        }),
        randomUUID()
      );
      expect(
        (yield* readWhatsAppMessages(personal, { chatId: dm.id })).map(
          (row) => row.body
        )
      ).toEqual(expect.arrayContaining([dmCanary, `${dmCanary}-matrix`]));
      denied(
        yield* readWhatsAppMessages(actor, { chatId: dm.id }).pipe(
          Effect.result
        )
      );
      denied(
        yield* shareWhatsAppChat(personal, {
          chatId: dm.id,
          workspaceId: actor.workspaceId,
        }).pipe(Effect.result)
      );
      yield* shareWhatsAppChat(personal, {
        chatId: group.id,
        workspaceId: actor.workspaceId,
      });
      expect(
        (yield* listWhatsAppChats(actor)).map((chat) => chat.handle)
      ).toEqual([group.id]);
      expect(
        (yield* summarizeWhatsAppChat(guest, { chatId: group.id })).text
      ).toContain(groupCanary);
      const companyDm = yield* summarizeWhatsAppChat(actor, {
        chatId: dm.id,
      }).pipe(Effect.result);
      denied(companyDm);
      expect(JSON.stringify(companyDm)).not.toContain(dmCanary);
      yield* pauseWhatsAppBridge(personal);
      expect(
        (yield* ingestWhatsAppEvent({
          accountId: pairing.id,
          remoteChatId: dmRemote,
          providerEventId: "evt-4",
          kind: "live",
          authorRemoteId: "wa:peer",
          body: dmCanary,
        })).alert
      ).toBe(false);
      const draft = yield* draftWhatsAppMessage(personal, {
        chatId: dm.id,
        body: "I arrive at eight.",
      });
      yield* authorizeWhatsAppDraft(personal, draft.id);
      denied(yield* sendWhatsAppDraft(personal, draft.id).pipe(Effect.result));
      yield* resumeWhatsAppBridge(personal);
      yield* sql`UPDATE whatsapp_bridge_drafts SET body = 'changed after approval'
        WHERE id = ${draft.id}`;
      denied(yield* sendWhatsAppDraft(personal, draft.id).pipe(Effect.result));
      yield* authorizeWhatsAppDraft(personal, draft.id);
      const sent = yield* sendWhatsAppDraft(personal, draft.id);
      expect(sent).toEqual({ queued: true, submitted: true });
      expect(fixture.sends.at(-1)).toMatchObject({
        body: "I arrive at eight.",
        roomId,
      });
      const queued = yield* sql<{
        status: string;
      }>`SELECT status FROM whatsapp_bridge_drafts WHERE id = ${draft.id}`;
      expect(queued[0]?.status).toBe("queued");
      yield* revokeWhatsAppBridge(personal);
      expect(fixture.logouts.length).toBeGreaterThan(0);
      denied(
        yield* readWhatsAppMessages(personal, { chatId: dm.id }).pipe(
          Effect.result
        )
      );
      expect(yield* listWhatsAppChats(personal)).toEqual([]);
      return true;
    }).pipe(Effect.scoped, Effect.provide(services))
  ));

test("imported WhatsApp contacts do not grant trust and member removal ends a share", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, guest, personal, guestPersonal, sql } =
        yield* workspaceFixture();
      const remote = `wa:${randomUUID()}`;
      const groupRemote = `group:${randomUUID()}`;
      yield* connect(guestPersonal, remote);
      const pairing = yield* startWhatsAppPairing(personal);
      fixture.completeLogin(pairing.matrixUserId ?? "", remote);
      denied(
        yield* confirmWhatsAppPairing({
          accountId: pairing.id,
          pairingNonce: pairing.pairingNonce,
        }).pipe(Effect.result)
      );
      fixture.completeLogin(pairing.matrixUserId ?? "", `wa:${randomUUID()}`);
      yield* confirmWhatsAppPairing({
        accountId: pairing.id,
        pairingNonce: pairing.pairingNonce,
      });
      const group = yield* authorizeWhatsAppChat(guestPersonal, {
        remoteChatId: groupRemote,
        kind: "group",
      });
      yield* ingestWhatsAppEvent({
        accountId:
          (yield* listWhatsAppAccounts(guestPersonal))[0]?.handle ?? "",
        remoteChatId: groupRemote,
        providerEventId: "evt-share",
        kind: "live",
        authorRemoteId: "wa:peer",
        body: "guest-group",
      });
      yield* shareWhatsAppChat(guestPersonal, {
        chatId: group.id,
        workspaceId: actor.workspaceId,
      });
      expect(
        (yield* listWhatsAppChats(actor)).map((chat) => chat.handle)
      ).toEqual([group.id]);
      yield* importWhatsAppContacts(personal, {
        contacts: [{ remoteUserId: "wa:imported", name: "Imported Peer" }],
      });
      const directory = yield* sql<{
        count: number;
      }>`SELECT count(*)::int AS count FROM user_directory
        WHERE user_id = ${personal.userId.replace("better-auth:", "")}`;
      expect(directory[0]?.count).toBe(0);
      const trust = yield* sql<{
        count: number;
      }>`SELECT count(*)::int AS count FROM personal_trust_edges
        WHERE user_id = ${personal.userId}`;
      expect(trust[0]?.count).toBe(0);
      denied(
        yield* contactNetworkBot(personal, {
          destUsername: "importedpeer",
          message: {
            messageId: randomUUID(),
            role: "ROLE_USER",
            parts: [{ text: "hello" }],
          },
        }).pipe(Effect.result)
      );
      yield* removeWorkspaceMember(actor, guest.userId);
      denied(
        yield* listWhatsAppChats({
          userId: guest.userId,
          workspaceId: actor.workspaceId,
          authSessionId: guest.authSessionId,
        }).pipe(Effect.result)
      );
      expect(yield* listWhatsAppChats(actor)).toEqual([]);
      return true;
    }).pipe(Effect.scoped, Effect.provide(services))
  ));
