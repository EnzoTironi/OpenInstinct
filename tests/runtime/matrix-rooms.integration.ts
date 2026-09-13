import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { Effect, Layer, Result, Schema } from "effect";
import { afterAll, beforeAll, expect, test } from "vitest";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { requireWorkspaceAccess } from "../../server/workspaces/access";
import { acceptMatrixTransaction } from "../../server/matrix/inbound";
import {
  createMatrixRoom,
  readMatrixMessages,
  sendMatrixMessage,
  closeMatrixRoom,
  reconcileMatrixRooms,
} from "../../server/matrix/rooms";
import { matrixDeliveryActor } from "../../server/matrix/authority";
import { pendingMatrixEvents } from "../../server/matrix/delivery";
import { runtimeDatabase } from "./database";
import { workspaceFixture } from "./workspace-fixture";

const services = WorkspaceRepository.layer.pipe(
  Layer.provideMerge(runtimeDatabase)
);
let server: Server;
const receipts: { id: string; body: string; authorization: string }[] = [];
beforeAll(async () => {
  server = createServer((incoming, outgoing) => {
    const receive = async () => {
      if (!incoming.url?.startsWith("/_matrix/app/v1/transactions/")) {
        outgoing.writeHead(200);
        outgoing.end("{}");
        return;
      }
      try {
        const chunks: Uint8Array[] = [];
        for await (const chunk of incoming)
          chunks.push(Schema.decodeUnknownSync(Schema.Uint8Array)(chunk));
        const body = Buffer.concat(chunks).toString("utf8");
        const authorization = incoming.headers.authorization ?? "";
        const id = incoming.url.split("/").at(-1) ?? "";
        await Effect.runPromise(
          acceptMatrixTransaction(
            new Request("http://localhost/transactions", {
              method: "PUT",
              headers: { authorization },
              body,
            }),
            id
          ).pipe(Effect.provide(services))
        );
        receipts.push({ id, body, authorization });
        outgoing.writeHead(200);
        outgoing.end("{}");
      } catch {
        outgoing.writeHead(503);
        outgoing.end("{}");
      }
    };
    void receive();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(4350, "0.0.0.0", resolve);
  });
});
afterAll(async () => {
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    })
  );
});

test(
  "real Synapse rooms isolate history, durably accept mentions and revoke a removed member",
  { timeout: 60000 },
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { actor, guest, personal, sql } = yield* workspaceFixture();
        const operationId = randomUUID();
        const room = yield* createMatrixRoom(actor, {
          operationId,
          name: "Synthetic team room",
        });
        expect(
          (yield* createMatrixRoom(actor, {
            operationId,
            name: "Synthetic team room",
          })).id
        ).toBe(room.id);
        expect(
          Result.isFailure(
            yield* readMatrixMessages(personal, room.id).pipe(Effect.result)
          )
        ).toBe(true);
        yield* readMatrixMessages(actor, room.id);
        yield* sendMatrixMessage(actor, {
          id: room.id,
          operationId: randomUUID(),
          text: "Before the guest joined: synthetic private history.",
        });
        const firstGuestView = yield* readMatrixMessages(guest, room.id);
        expect(
          firstGuestView.messages.some((m) =>
            m.text.includes("Before the guest")
          )
        ).toBe(false);
        const sendId = randomUUID();
        yield* sendMatrixMessage(guest, {
          id: room.id,
          operationId: sendId,
          text: "Zoen, summarize our shared workspace.",
        });
        yield* sendMatrixMessage(guest, {
          id: room.id,
          operationId: sendId,
          text: "Zoen, summarize our shared workspace.",
        });
        const deliveries = yield* Effect.gen(function* () {
          for (let n = 0; n < 150; n++) {
            const rows = yield* sql<{
              eventId: string;
            }>`SELECT event_id AS "eventId" FROM matrix_deliveries WHERE binding_id = ${room.id}`;
            if (rows.length) return rows;
            yield* Effect.sleep("100 millis");
          }
          throw new Error("Synapse did not deliver a room mention");
        });
        expect(deliveries).toHaveLength(1);
        const first = deliveries[0];
        if (!first) throw new Error("Missing Matrix receipt");
        const eventId = first.eventId;
        const source = receipts.find((r) => r.body.includes(eventId));
        expect(source).toBeDefined();
        if (!source) throw new Error("Missing homeserver transaction");
        yield* acceptMatrixTransaction(
          new Request("http://localhost/transactions", {
            method: "PUT",
            headers: { authorization: source.authorization },
            body: source.body,
          }),
          source.id
        );
        expect(
          yield* sql`SELECT event_id FROM matrix_deliveries WHERE binding_id = ${room.id}`
        ).toHaveLength(1);
        const external = yield* matrixDeliveryActor(eventId);
        expect(external.userId).toBe(guest.userId);
        expect(external.workspaceId).toBe(actor.workspaceId);
        expect(
          Result.isFailure(
            yield* requireWorkspaceAccess({
              ...external,
              workspaceId: personal.workspaceId,
            }).pipe(Effect.result)
          )
        ).toBe(true);
        yield* sql`DELETE FROM organization_memberships WHERE user_id = ${guest.userId}`;
        expect(
          Result.isFailure(
            yield* matrixDeliveryActor(eventId).pipe(Effect.result)
          )
        ).toBe(true);
        expect(
          Result.isFailure(
            yield* sendMatrixMessage(guest, {
              id: room.id,
              operationId: randomUUID(),
              text: "Denied message",
            }).pipe(Effect.result)
          )
        ).toBe(true);
        yield* reconcileMatrixRooms();
        expect(
          yield* sql`SELECT user_id FROM matrix_room_members WHERE binding_id = ${room.id} AND user_id = ${guest.userId}`
        ).toEqual([]);
        yield* pendingMatrixEvents();
        expect(
          (yield* sql<{
            state: string;
          }>`SELECT state FROM matrix_deliveries WHERE event_id = ${eventId}`)[0]
            ?.state
        ).toBe("suppressed");
        yield* closeMatrixRoom(actor, room.id);
        expect(
          Result.isFailure(
            yield* readMatrixMessages(actor, room.id).pipe(Effect.result)
          )
        ).toBe(true);
        yield* reconcileMatrixRooms();
      }).pipe(Effect.scoped, Effect.provide(services))
    )
);
