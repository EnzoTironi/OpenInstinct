import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Effect, Redacted, Schema } from "effect";
import { matrixConfiguration, MatrixError, MatrixEventSchema } from "./client";
import { ingestWhatsAppMatrixEvent } from "../workspaces/whatsapp";
import { acceptMatrixNetworkEvent } from "./network-delivery";

const transactionSchema = Schema.Struct({
  events: Schema.Array(MatrixEventSchema).check(Schema.isMaxLength(1000)),
});

export const authorizeMatrixHomeserver = Effect.fn(
  "matrix.authorizeHomeserver"
)(function* (request: Request) {
  const config = yield* matrixConfiguration;
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(
    `Bearer ${Redacted.value(config.homeserverToken)}`
  );
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    return yield* new MatrixError({ reason: "forbidden" });
  return undefined;
});

export const acceptMatrixTransaction = Effect.fn("matrix.acceptTransaction")(
  function* (request: Request, transactionId: string) {
    yield* authorizeMatrixHomeserver(request);
    const raw = yield* Effect.tryPromise({
      try: async (signal) => {
        const reader = request.body?.getReader();
        if (!reader) throw new Error("Missing events");
        const chunks: Uint8Array[] = [];
        let size = 0;
        const abort = () => {
          void reader.cancel();
        };
        signal.addEventListener("abort", abort, { once: true });
        try {
          for (;;) {
            // The bounded stream must be read sequentially.
            // oxlint-disable-next-line eslint/no-await-in-loop
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 2_000_000) throw new Error("Too many events");
            chunks.push(value);
          }
          return Buffer.concat(chunks).toString("utf8");
        } finally {
          signal.removeEventListener("abort", abort);
          await reader.cancel();
        }
      },
      catch: () => new MatrixError({ reason: "unavailable" }),
    }).pipe(Effect.timeout("5 seconds"));
    const transaction = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(transactionSchema)
    )(raw);
    const hash = createHash("sha256").update(raw).digest("hex");
    const sql = yield* PgClient.PgClient;
    const config = yield* matrixConfiguration;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`SELECT pg_advisory_xact_lock(hashtextextended(${config.serverName}, 6))`;
        const previous = yield* sql<{
          hash: string;
        }>`SELECT hash FROM matrix_transactions WHERE id = ${transactionId}`;
        if (previous[0]) {
          if (previous[0].hash !== hash)
            return yield* new MatrixError({ reason: "conflict" });
          return [];
        }
        const accepted: string[] = [];
        for (const event of transaction.events) {
          const received =
            yield* sql`INSERT INTO matrix_received_events(id) VALUES (${event.event_id}) ON CONFLICT DO NOTHING RETURNING id`;
          if (!received.length || !event.room_id) continue;
          const bindings = yield* sql<{
            id: string;
            epoch: string;
          }>`SELECT id, epoch FROM workspace_group_bindings
        WHERE channel = 'matrix' AND installation_id = ${config.serverName} AND conversation_id = ${event.room_id} AND revoked_at IS NULL FOR UPDATE`;
          const binding = bindings[0];
          if (!binding) {
            if (yield* ingestWhatsAppMatrixEvent(event)) {
              accepted.push(event.event_id);
              continue;
            }
            if (yield* acceptMatrixNetworkEvent(event))
              accepted.push(event.event_id);
            continue;
          }
          if (event.type === "m.room.member") {
            yield* sql`UPDATE workspace_group_bindings SET epoch = ${randomUUID()} WHERE id = ${binding.id}`;
            if (event.content.membership !== "join")
              yield* sql`DELETE FROM matrix_room_members WHERE binding_id = ${binding.id}
          AND user_id IN (SELECT user_id FROM matrix_identities WHERE matrix_id = ${event.state_key ?? ""})`;
            continue;
          }
          if (
            event.type !== "m.room.message" ||
            event.content.msgtype !== "m.text" ||
            event.sender === config.botId ||
            !event.content.body?.trim()
          )
            continue;
          const users = yield* sql<{
            userId: string;
          }>`SELECT m.user_id AS "userId" FROM matrix_room_members m
        JOIN matrix_identities i ON i.user_id = m.user_id
        JOIN workspace_group_bindings b ON b.id = m.binding_id
        JOIN workspace_memberships w ON w.workspace_id = b.workspace_id AND w.user_id = m.user_id
        JOIN workspaces s ON s.id = w.workspace_id
        JOIN organization_memberships o ON o.organization_id = s.organization_id AND o.user_id = m.user_id
        WHERE m.binding_id = ${binding.id} AND i.matrix_id = ${event.sender}`;
          if (!users[0]) continue;
          // In groups only an explicit Zoen mention activates the agent.
          if (!/(^|\s)@?zoen\b/i.test(event.content.body)) continue;
          if (event.content.body.length > 8000) continue;
          yield* sql`INSERT INTO matrix_deliveries(event_id, binding_id, epoch, user_id, message)
        VALUES (${event.event_id}, ${binding.id}, ${binding.epoch}, ${users[0].userId}, ${event.content.body}) ON CONFLICT DO NOTHING`;
          accepted.push(event.event_id);
        }
        yield* sql`INSERT INTO matrix_transactions(id, hash) VALUES (${transactionId}, ${hash})`;
        return accepted;
      })
    );
  }
);
