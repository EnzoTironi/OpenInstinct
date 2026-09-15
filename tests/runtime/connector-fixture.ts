import { createServer } from "node:http";
import { once } from "node:events";
import type { Socket } from "node:net";
import { Schema } from "effect";

const connectorSchema = {
  type: "object",
  properties: { text: { type: "string", maxLength: 500 } },
  required: ["text"],
  additionalProperties: false,
};
export const connectorDocument = JSON.stringify({
  openapi: "3.1.0",
  paths: {
    "/notes": {
      post: {
        operationId: "create-note",
        summary: "Create a note",
        requestBody: {
          content: { "application/json": { schema: connectorSchema } },
        },
        responses: {
          "201": {
            content: { "application/json": { schema: connectorSchema } },
          },
        },
      },
    },
  },
});
const Rpc = Schema.Struct({
  id: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
  method: Schema.String,
  params: Schema.optional(
    Schema.Struct({
      arguments: Schema.optional(Schema.Struct({ text: Schema.String })),
    })
  ),
});

export async function connectorFixture() {
  const writes: string[] = [];
  const credentials: string[] = [];
  const paused = {
    initialize: false,
    response: false,
    reached: Promise.withResolvers<undefined>(),
    resume: Promise.withResolvers<undefined>(),
  };
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: string[] = [];
      request.setEncoding("utf8");
      for await (const chunk of request)
        chunks.push(Schema.decodeUnknownSync(Schema.String)(chunk));
      const content = chunks.join("");
      credentials.push(request.headers.authorization ?? "");
      response.setHeader("Content-Type", "application/json");
      if (request.method === "GET") {
        response.writeHead(405);
        response.end();
        return;
      }
      if (request.url === "/api/notes") {
        const input = Schema.decodeUnknownSync(
          Schema.fromJsonString(Schema.Struct({ text: Schema.String }))
        )(content);
        writes.push(input.text);
        if (input.text === "lose response") {
          response.destroy();
          return;
        }
        if (paused.response) {
          paused.reached.resolve(undefined);
          await paused.resume.promise;
        }
        response.writeHead(201);
        response.end(JSON.stringify(input));
        return;
      }
      const rpc = Schema.decodeUnknownSync(Schema.fromJsonString(Rpc))(content);
      if (rpc.method === "initialize" && paused.initialize) {
        paused.reached.resolve(undefined);
        await paused.resume.promise;
      }
      if (rpc.id === undefined) {
        response.writeHead(202);
        response.end();
        return;
      }
      if (rpc.method !== "initialize" && rpc.method !== "tools/list") {
        const text = rpc.params?.arguments?.text ?? "";
        writes.push(text);
        if (text === "lose response") {
          response.destroy();
          return;
        }
      }
      const text = rpc.params?.arguments?.text ?? "";
      const result =
        rpc.method === "initialize"
          ? {
              protocolVersion: "2025-11-25",
              capabilities: { tools: {} },
              serverInfo: { name: "synthetic-write-service", version: "1" },
            }
          : rpc.method === "tools/list"
            ? {
                tools: [
                  {
                    name: "create-note",
                    description: "Create a note",
                    inputSchema: connectorSchema,
                    outputSchema: connectorSchema,
                    annotations: { readOnlyHint: true, destructiveHint: false },
                  },
                ],
              }
            : {
                content: [{ type: "text", text }],
                structuredContent: { text },
              };
      const envelope = JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result });
      if (request.url === "/mcp-sse") {
        response.setHeader("Content-Type", "text/event-stream");
        response.end(`data: ${envelope}\n\n`);
      } else response.end(envelope);
    })().catch(() => {
      response.writeHead(500);
      response.end();
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = Schema.decodeUnknownSync(
    Schema.Struct({ port: Schema.Number })
  )(server.address());
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    writes,
    credentials,
    paused,
    async close() {
      for (const socket of sockets) socket.destroy();
      server.close();
      await once(server, "close");
    },
  };
}
