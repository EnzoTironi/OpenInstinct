import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import { Schema } from "effect";

export const WHATSAPP_BRIDGE_PORT = 14351;
export const WHATSAPP_PROVISIONING_SECRET =
  "synthetic-whatsapp-provision-secret-32b";
export const WHATSAPP_AS_TOKEN = "synthetic-whatsapp-appservice-token-32bxx";
export const MATRIX_HS_TOKEN = "synthetic-zoen-matrix-homeserver-token-32bx";

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

export async function whatsappBridgeFixture() {
  const logins = new Map<string, LoginRecord>();
  const byUser = new Map<string, LoginRecord>();
  const sends: SendRecord[] = [];
  const logouts: string[] = [];
  let ready = true;

  const json = (outgoing: ServerResponse, status: number, body: unknown) => {
    outgoing.writeHead(status, { "content-type": "application/json" });
    outgoing.end(JSON.stringify(body));
  };
  const bodyOf = async (incoming: IncomingMessage) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of incoming)
      chunks.push(Schema.decodeUnknownSync(Schema.Uint8Array)(chunk));
    const text = Buffer.concat(chunks).toString("utf8");
    return text ? JSON.parse(text) : {};
  };
  const userIdOf = (incoming: IncomingMessage) => {
    const url = new URL(incoming.url ?? "/", "http://127.0.0.1");
    return url.searchParams.get("user_id") ?? "";
  };
  const authorized = (incoming: IncomingMessage, secret: string) =>
    incoming.headers.authorization === `Bearer ${secret}`;

  const server = createServer((incoming, outgoing) => {
    const run = async () => {
      const url = new URL(incoming.url ?? "/", "http://127.0.0.1");
      const path = url.pathname;
      if (path === "/_matrix/mau/live" || path === "/_matrix/mau/ready") {
        if (!ready) return json(outgoing, 503, { ok: false });
        return json(outgoing, 200, { ok: true });
      }
      if (path.startsWith("/_matrix/provision/")) {
        if (!authorized(incoming, WHATSAPP_PROVISIONING_SECRET))
          return json(outgoing, 401, { errcode: "M_UNKNOWN_TOKEN" });
        const userId = userIdOf(incoming);
        if (path === "/_matrix/provision/v3/whoami") {
          const login = byUser.get(userId);
          return json(outgoing, 200, {
            logins: login?.loggedIn
              ? [
                  {
                    id: login.remoteUserId ?? login.loginId,
                    name: login.remoteUserId,
                  },
                ]
              : [],
          });
        }
        if (
          path === "/_matrix/provision/v3/login/start/qr" &&
          incoming.method === "POST"
        ) {
          const loginId = randomUUID();
          const login = {
            loginId,
            matrixUserId: userId,
            loggedIn: false,
          };
          logins.set(loginId, login);
          byUser.set(userId, login);
          return json(outgoing, 200, {
            login_id: loginId,
            type: "display_and_wait",
            step_id: "fi.mau.whatsapp.login.qr",
            display_and_wait: { type: "qr", data: "synthetic-whatsapp-qr" },
          });
        }
        const logout = /^\/_matrix\/provision\/v3\/logout\/([^/]+)$/.exec(path);
        if (logout && incoming.method === "POST") {
          logouts.push(logout[1] ?? "all");
          const login = byUser.get(userId);
          if (login) login.loggedIn = false;
          return json(outgoing, 200, {});
        }
        return json(outgoing, 404, { errcode: "M_UNRECOGNIZED" });
      }
      const send =
        /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/send\/m\.room\.message\/([^/]+)$/.exec(
          path
        );
      if (send && incoming.method === "PUT") {
        if (!authorized(incoming, WHATSAPP_AS_TOKEN))
          return json(outgoing, 401, { errcode: "M_UNKNOWN_TOKEN" });
        const payload = Schema.decodeUnknownSync(
          Schema.Struct({ body: Schema.optional(Schema.String) })
        )(await bodyOf(incoming));
        sends.push({
          roomId: decodeURIComponent(send[1] ?? ""),
          body: payload.body ?? "",
          userId: userIdOf(incoming),
          txnId: decodeURIComponent(send[2] ?? ""),
        });
        return json(outgoing, 200, { event_id: `$synthetic-${randomUUID()}` });
      }
      return json(outgoing, 404, { errcode: "M_UNRECOGNIZED" });
    };
    void run();
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
