import { createServer } from "node:http";
import { Effect, Layer, Schema } from "effect";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { acceptMatrixTransaction } from "../../server/matrix/inbound";
import { runtimeDatabase } from "./database";
const services = WorkspaceRepository.layer.pipe(
  Layer.provideMerge(runtimeDatabase)
);

export async function matrixReceiver() {
  const receipts: { id: string; body: string; authorization: string }[] = [];
  const server = createServer((incoming, outgoing) => {
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
  return {
    receipts,
    close: () =>
      new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        })
      ),
  };
}
