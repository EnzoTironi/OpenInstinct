import { randomUUID } from "node:crypto";
import { Effect, Layer, Result, Schema } from "effect";
import { expect, test } from "vitest";
import { contactNetworkBot } from "../../server/workspaces/network";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { removeWorkspaceMember } from "../../server/workspaces/team";
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
import { runtimeDatabase } from "./database";
import { workspaceFixture } from "./workspace-fixture";

const services = WorkspaceRepository.layer.pipe(
  Layer.provideMerge(runtimeDatabase)
);
const denied = <A, E>(result: Result.Result<A, E>) => {
  expect(Result.isFailure(result)).toBe(true);
};
const connect = Effect.fn("whatsapp.connect")(function* (
  owner: Parameters<typeof startWhatsAppPairing>[0],
  remoteUserId: string
) {
  const pairing = yield* startWhatsAppPairing(owner);
  yield* confirmWhatsAppPairing({
    accountId: pairing.id,
    pairingNonce: pairing.pairingNonce,
    remoteUserId,
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
      return true;
    }).pipe(Effect.provide(services))
  ));

test("the agent reads only authorized chats and never delivers without the bridge", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { actor, guest, personal, sql } = yield* workspaceFixture();
      const dmCanary = `canary-dm-${randomUUID()}`;
      const groupCanary = `canary-group-${randomUUID()}`;
      const dmRemote = `dm:${randomUUID()}`;
      const groupRemote = `group:${randomUUID()}`;
      denied(yield* startWhatsAppPairing(actor).pipe(Effect.result));
      denied(yield* startWhatsAppPairing(guest).pipe(Effect.result));
      const pairing = yield* startWhatsAppPairing(personal);
      denied(
        yield* confirmWhatsAppPairing({
          accountId: pairing.id,
          pairingNonce: "kapso-bot-session",
          remoteUserId: `wa:${randomUUID()}`,
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
      yield* confirmWhatsAppPairing({
        accountId: pairing.id,
        pairingNonce: pairing.pairingNonce,
        remoteUserId: `wa:${randomUUID()}`,
      });
      const listed = yield* listWhatsAppAccounts(personal);
      expect(listed.map((row) => row.handle)).toEqual([pairing.id]);
      expect(JSON.stringify(listed)).not.toContain(pairing.pairingNonce);
      expect(listed[0]?.status).toBe("connected");
      const dm = yield* authorizeWhatsAppChat(personal, {
        remoteChatId: dmRemote,
        kind: "dm",
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
      expect(
        (yield* readWhatsAppMessages(personal, { chatId: dm.id })).map(
          (row) => row.body
        )
      ).toContain(dmCanary);
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
      const sent = yield* sendWhatsAppDraft(personal, draft.id).pipe(
        Effect.result
      );
      expect(Result.isFailure(sent) && sent.failure).toBeInstanceOf(
        WhatsAppBridgeUnavailable
      );
      const queued = yield* sql<{
        status: string;
      }>`SELECT status FROM whatsapp_bridge_drafts WHERE id = ${draft.id}`;
      expect(queued[0]?.status).toBe("queued");
      yield* revokeWhatsAppBridge(personal);
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
      denied(
        yield* confirmWhatsAppPairing({
          accountId: pairing.id,
          pairingNonce: pairing.pairingNonce,
          remoteUserId: remote,
        }).pipe(Effect.result)
      );
      yield* confirmWhatsAppPairing({
        accountId: pairing.id,
        pairingNonce: pairing.pairingNonce,
        remoteUserId: `wa:${randomUUID()}`,
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
