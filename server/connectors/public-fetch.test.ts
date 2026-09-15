import {
  createServer,
  request as httpRequest,
  type ClientRequest,
} from "node:http";
import type { LookupAddress } from "node:dns";
import type { Socket } from "node:net";
import { Schema } from "effect";
import type { RequestOptions } from "node:https";
import { once } from "node:events";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { connectorEndpoint, publicFetch } from "./public-fetch";

const state = vi.hoisted(() => {
  const requests: RequestOptions[] = [];
  return { addresses: ["93.184.216.34"], requests, port: 0 };
});
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn<() => Promise<LookupAddress[]>>(async () =>
    state.addresses.map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    }))
  ),
}));
vi.mock("node:https", () => ({
  request: vi.fn<(options: RequestOptions) => ClientRequest>((options) => {
    state.requests.push(options);
    return httpRequest({ ...options, hostname: "127.0.0.1", port: state.port });
  }),
}));
const sockets = new Set<Socket>();
const server = createServer((request, response) => {
  if (request.url === "/redirect") {
    response.writeHead(302, {
      location: "http://169.254.169.254/latest/meta-data",
    });
    response.end();
    return;
  }
  if (request.url === "/large") {
    response.end("x".repeat(524_289));
    return;
  }
  if (request.url === "/wait") return;
  if (request.url === "/compressed") {
    response.writeHead(200, { "Content-Encoding": "gzip" });
    response.end("x");
    return;
  }
  response.writeHead(200, {
    "Content-Type": "application/json",
    "Set-Cookie": "ambient=secret",
  });
  response.end(
    JSON.stringify({
      host: request.headers.host,
      cookie: request.headers.cookie ?? null,
    })
  );
});
server.on("connection", (socket) => {
  sockets.add(socket);
  socket.once("close", () => {
    sockets.delete(socket);
  });
});
beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = Schema.decodeUnknownSync(
    Schema.Struct({ port: Schema.Number })
  )(server.address());
  state.port = address.port;
});
beforeEach(() => {
  state.addresses = ["93.184.216.34"];
  state.requests = [];
});
afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  server.close();
  await once(server, "close");
});

test.each([
  "http://example.com",
  "https://example.com:8443",
  "https://user:pass@example.com",
  "https://example.com?token=x",
  "https://example.com#fragment",
])("rejects unsafe endpoint %s", (value) => {
  expect(() => connectorEndpoint(value)).toThrow(
    "Connector requires a public HTTPS endpoint"
  );
});
test.each([
  "127.0.0.1",
  "10.0.0.1",
  "169.254.169.254",
  "100.64.0.1",
  "168.63.129.16",
  "192.168.1.1",
  "::1",
  "fc00::1",
  "fe80::1",
  "::ffff:127.0.0.1",
  "2001:db8::1",
  "2002:7f00:1::1",
])(
  "rejects private or reserved DNS answer %s before network",
  async (address) => {
    state.addresses = [address];
    await expect(publicFetch("https://connector.example/")).rejects.toThrow(
      "not public"
    );
    expect(state.requests).toEqual([]);
  }
);
test("rejects mixed public/private DNS answers and pins the validated IP with original TLS identity", async () => {
  state.addresses = ["93.184.216.34", "127.0.0.1"];
  await expect(publicFetch("https://connector.example/")).rejects.toThrow(
    "not public"
  );
  expect(state.requests).toEqual([]);
  state.addresses = ["93.184.216.34"];
  const response = await publicFetch("https://connector.example/", {
    headers: { cookie: "must-not-leak", host: "attacker.example" },
  });
  expect(await response.json()).toEqual({
    host: "connector.example",
    cookie: null,
  });
  expect(state.requests[0]).toMatchObject({
    hostname: "93.184.216.34",
    servername: "connector.example",
    rejectUnauthorized: true,
    agent: false,
  });
  expect(response.headers.has("set-cookie")).toBe(false);
});
test("redirects and compressed payloads cannot bypass the destination/size policy", async () => {
  await Promise.all(
    ["redirect", "compressed"].map((path) =>
      expect(publicFetch(`https://connector.example/${path}`)).rejects.toThrow(
        "Connector request failed"
      )
    )
  );
  expect(state.requests).toHaveLength(2);
});
test("bounds streaming responses and cancels pending HTTP", async () => {
  const response = await publicFetch("https://connector.example/large");
  await expect(response.text()).rejects.toThrow("Connector request failed");
  const controller = new AbortController();
  const pending = publicFetch("https://connector.example/wait", {
    signal: controller.signal,
  });
  setTimeout(() => {
    controller.abort();
  }, 30);
  await expect(pending).rejects.toThrow("Connector request failed");
});
