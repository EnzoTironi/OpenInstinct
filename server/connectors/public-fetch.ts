import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { Schema } from "effect";

const denied = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  denied.addSubnet(address, prefix, "ipv4");
denied.addAddress("168.63.129.16", "ipv4");
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3ffe::", 16],
  ["3fff::", 20],
] as const)
  denied.addSubnet(address, prefix, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const requestError = () => new Error("Connector request failed.");

function publicAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return !denied.check(address, "ipv4");
  return (
    family === 6 &&
    globalV6.check(address, "ipv6") &&
    !denied.check(address, "ipv6")
  );
}

export function connectorEndpoint(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (url.port && url.port !== "443")
  )
    throw new Error(
      "Connector requires a public HTTPS endpoint without credentials or query parameters."
    );
  return url;
}

/** SDK boundary: resolve once, validate every answer, then pin TLS to that IP.
 * No redirects, ambient proxy, cookies, compressed bodies, or retry of writes.
 * Streams stay bounded even when the MCP server keeps an SSE response open.
 */
export const publicFetch: typeof fetch = async (input, init) => {
  const incoming = new Request(input, init);
  const url = new URL(incoming.url);
  if (url.username || url.password || url.hash)
    throw new Error("Invalid connector URL.");
  connectorEndpoint(`${url.origin}${url.pathname}`);
  const host = url.hostname.replace(/^\[|\]$/gu, "");
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true, order: "verbatim" });
  const address = addresses[0]?.address;
  if (!address || addresses.some((entry) => !publicAddress(entry.address)))
    throw new Error("Connector endpoint is not public.");
  incoming.signal.throwIfAborted();
  const body = incoming.body
    ? Buffer.from(await incoming.arrayBuffer())
    : undefined;
  if (body && body.byteLength > 65_536)
    throw new Error("Connector request is too large.");
  const headers = Object.fromEntries(incoming.headers);
  delete headers.cookie;
  delete headers.host;
  headers.host = url.host;
  headers["accept-encoding"] = "identity";
  return new Promise<Response>((resolve, reject) => {
    const req = request({
      hostname: address,
      servername: isIP(host) ? undefined : host,
      port: 443,
      method: incoming.method,
      path: `${url.pathname}${url.search}`,
      headers,
      agent: false,
      rejectUnauthorized: true,
    });
    const abort = () => {
      req.destroy(requestError());
    };
    const timer = setTimeout(abort, 25_000);
    incoming.signal.addEventListener("abort", abort, { once: true });
    req.once("close", () => {
      clearTimeout(timer);
      incoming.signal.removeEventListener("abort", abort);
    });
    req.once("error", () => {
      reject(requestError());
    });
    req.once("response", (response) => {
      const status = response.statusCode ?? 502;
      if (
        (status >= 300 && status < 400) ||
        (response.headers["content-encoding"] &&
          response.headers["content-encoding"] !== "identity")
      ) {
        response.destroy();
        reject(requestError());
        return;
      }
      const responseHeaders = new Headers();
      for (const key of [
        "content-type",
        "mcp-session-id",
        "mcp-protocol-version",
      ])
        if (Schema.is(Schema.String)(response.headers[key]))
          responseHeaders.set(key, response.headers[key]);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          let bytes = 0;
          response.on("data", (chunk: Buffer) => {
            bytes += chunk.byteLength;
            if (bytes > 524_288) {
              response.destroy(requestError());
              return;
            }
            controller.enqueue(chunk);
          });
          response.once("end", () => {
            controller.close();
          });
          response.once("error", () => {
            controller.error(requestError());
          });
        },
        cancel() {
          response.destroy();
        },
      });
      resolve(
        new Response([204, 205, 304].includes(status) ? null : stream, {
          status,
          headers: responseHeaders,
        })
      );
    });
    req.end(body);
  });
};
