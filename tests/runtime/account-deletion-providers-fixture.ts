import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";

function writeJson(outgoing: ServerResponse, status: number, body: string) {
  outgoing.writeHead(status, { "content-type": "application/json" });
  outgoing.end(body);
}

function bearer(incoming: IncomingMessage) {
  return incoming.headers.authorization ?? "";
}

export async function accountDeletionProvidersFixture() {
  const logouts: string[] = [];
  const vaultUsers: string[] = [];
  const deactivated: string[] = [];

  const server = createServer((incoming, outgoing) => {
    const receive = async () => {
      const url = new URL(incoming.url ?? "/", "http://127.0.0.1");
      const path = url.pathname;
      try {
        if (path === "/alive") {
          writeJson(outgoing, 200, JSON.stringify({ ok: true }));
          return;
        }
        if (path === "/_matrix/mau/ready" || path === "/_matrix/mau/live") {
          writeJson(outgoing, 200, JSON.stringify({ ok: true }));
          return;
        }
        const vault = /^\/admin\/users\/([^/]+)$/.exec(path);
        if (vault && incoming.method === "DELETE") {
          if (
            bearer(incoming) !==
            "Bearer synthetic-deletion-vault-client-secret-32"
          ) {
            writeJson(outgoing, 401, "{}");
            return;
          }
          vaultUsers.push(decodeURIComponent(vault[1] ?? ""));
          writeJson(outgoing, 200, "{}");
          return;
        }
        if (
          path === "/_matrix/provision/v3/login/start/qr" &&
          incoming.method === "POST"
        ) {
          if (
            bearer(incoming) !==
            "Bearer synthetic-deletion-whatsapp-provision-32b"
          ) {
            writeJson(outgoing, 401, "{}");
            return;
          }
          const loginId = randomUUID();
          writeJson(
            outgoing,
            200,
            JSON.stringify({
              login_id: loginId,
              type: "display_and_wait",
              display_and_wait: { type: "qr", data: "synthetic-deletion-qr" },
            })
          );
          return;
        }
        const logout = /^\/_matrix\/provision\/v3\/logout\/([^/]+)$/.exec(path);
        if (logout && incoming.method === "POST") {
          if (
            bearer(incoming) !==
            "Bearer synthetic-deletion-whatsapp-provision-32b"
          ) {
            writeJson(outgoing, 401, "{}");
            return;
          }
          logouts.push(decodeURIComponent(logout[1] ?? "all"));
          writeJson(outgoing, 200, "{}");
          return;
        }
        const deactivate = /^\/_synapse\/admin\/v1\/deactivate\/(.+)$/.exec(
          path
        );
        if (deactivate && incoming.method === "POST") {
          if (
            bearer(incoming) !==
            "Bearer synthetic-deletion-matrix-appservice-32bx"
          ) {
            writeJson(outgoing, 401, "{}");
            return;
          }
          deactivated.push(decodeURIComponent(deactivate[1] ?? ""));
          writeJson(outgoing, 200, "{}");
          return;
        }
        writeJson(outgoing, 404, JSON.stringify({ errcode: "M_UNRECOGNIZED" }));
      } catch {
        writeJson(outgoing, 500, "{}");
      }
    };
    void receive();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(14352, "127.0.0.1", resolve);
  });
  return {
    deactivated,
    logouts,
    vaultUsers,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}
