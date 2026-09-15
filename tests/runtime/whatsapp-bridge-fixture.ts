import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import { Schema } from "effect";

const WHATSAPP_BRIDGE_PORT = 14351;
const WHATSAPP_PROVISIONING_SECRET = "synthetic-whatsapp-provision-secret-32b";
const WHATSAPP_AS_TOKEN = "synthetic-whatsapp-appservice-token-32bxx";
export const MATRIX_HS_TOKEN = "synthetic-zoen-matrix-homeserver-token-32bx";
const jsonBody = Schema.fromJsonString(
  Schema.Struct({ body: Schema.optional(Schema.String) })
);

interface LoginRecord {
  loginId: string;
  matrixUserId: string;
  remoteUserId?: string;
  loggedIn: boolean;
}

interface SendRecord {
  roomId: string;
  body: string;
  userId: string;
  txnId: string;
}

function writeJson(outgoing: ServerResponse, status: number, body: string) {
  outgoing.writeHead(status, { "content-type": "application/json" });
  outgoing.end(body);
}

function userIdOf(incoming: IncomingMessage) {
  const url = new URL(incoming.url ?? "/", "http://127.0.0.1");
  return url.searchParams.get("user_id") ?? "";
}

function authorized(incoming: IncomingMessage, secret: string) {
  return incoming.headers.authorization === `Bearer ${secret}`;
}

async function readJsonBody(incoming: IncomingMessage) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of incoming)
    chunks.push(Schema.decodeUnknownSync(Schema.Uint8Array)(chunk));
  return Schema.decodeUnknownSync(jsonBody)(
    Buffer.concat(chunks).toString("utf8") || "{}"
  );
}

export async function whatsappBridgeFixture() {
  const byUser = new Map<string, LoginRecord>();
  const sends: SendRecord[] = [];
  const logouts: string[] = [];
  let ready = true;

  const server = createServer((incoming, outgoing) => {
    const receive = async () => {
      const url = new URL(incoming.url ?? "/", "http://127.0.0.1");
      const path = url.pathname;
      try {
        if (path === "/_matrix/mau/live" || path === "/_matrix/mau/ready") {
          writeJson(
            outgoing,
            ready ? 200 : 503,
            JSON.stringify(ready ? { ok: true } : { ok: false })
          );
          return;
        }
        if (path.startsWith("/_matrix/provision/")) {
          if (!authorized(incoming, WHATSAPP_PROVISIONING_SECRET)) {
            writeJson(
              outgoing,
              401,
              JSON.stringify({ errcode: "M_UNKNOWN_TOKEN" })
            );
            return;
          }
          const userId = userIdOf(incoming);
          if (path === "/_matrix/provision/v3/whoami") {
            const login = byUser.get(userId);
            writeJson(
              outgoing,
              200,
              JSON.stringify({
                logins: login?.loggedIn
                  ? [
                      {
                        id: login.remoteUserId ?? login.loginId,
                        name: login.remoteUserId,
                      },
                    ]
                  : [],
              })
            );
            return;
          }
          if (
            path === "/_matrix/provision/v3/login/start/qr" &&
            incoming.method === "POST"
          ) {
            const loginId = randomUUID();
            byUser.set(userId, {
              loginId,
              matrixUserId: userId,
              loggedIn: false,
            });
            writeJson(
              outgoing,
              200,
              JSON.stringify({
                login_id: loginId,
                type: "display_and_wait",
                step_id: "fi.mau.whatsapp.login.qr",
                display_and_wait: { type: "qr", data: "synthetic-whatsapp-qr" },
              })
            );
            return;
          }
          const logout = /^\/_matrix\/provision\/v3\/logout\/([^/]+)$/.exec(
            path
          );
          if (logout && incoming.method === "POST") {
            logouts.push(logout[1] ?? "all");
            const login = byUser.get(userId);
            if (login) login.loggedIn = false;
            writeJson(outgoing, 200, "{}");
            return;
          }
          writeJson(
            outgoing,
            404,
            JSON.stringify({ errcode: "M_UNRECOGNIZED" })
          );
          return;
        }
        const send =
          /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/send\/m\.room\.message\/([^/]+)$/.exec(
            path
          );
        if (send && incoming.method === "PUT") {
          if (!authorized(incoming, WHATSAPP_AS_TOKEN)) {
            writeJson(
              outgoing,
              401,
              JSON.stringify({ errcode: "M_UNKNOWN_TOKEN" })
            );
            return;
          }
          const payload = await readJsonBody(incoming);
          sends.push({
            roomId: decodeURIComponent(send[1] ?? ""),
            body: payload.body ?? "",
            userId: userIdOf(incoming),
            txnId: decodeURIComponent(send[2] ?? ""),
          });
          writeJson(
            outgoing,
            200,
            JSON.stringify({ event_id: `$synthetic-${randomUUID()}` })
          );
          return;
        }
        writeJson(outgoing, 404, JSON.stringify({ errcode: "M_UNRECOGNIZED" }));
      } catch {
        writeJson(outgoing, 500, JSON.stringify({ errcode: "M_UNKNOWN" }));
      }
    };
    void receive();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(WHATSAPP_BRIDGE_PORT, "127.0.0.1", resolve);
  });
  return {
    sends,
    logouts,
    setReady(value: boolean) {
      ready = value;
    },
    completeLogin(matrixUserId: string, remoteUserId: string) {
      const login = byUser.get(matrixUserId);
      if (!login) throw new Error("No login started for this Matrix user.");
      login.loggedIn = true;
      login.remoteUserId = remoteUserId;
      return login;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}
