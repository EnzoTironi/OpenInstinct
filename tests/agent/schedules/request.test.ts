import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { getVercelOidcToken } from "@vercel/oidc";
import { ResolvedInstallationSecrets } from "@db/services/installation-secrets";
import { ConfigProvider, Effect, Schema } from "effect";
import { afterEach, expect, test, vi } from "vitest";
import { readVerifiedInternalCallback } from "../../../server/internal/callback-auth";

const mocks = vi.hoisted(() => ({
  getToken: vi.fn<typeof getVercelOidcToken>(),
}));
vi.mock("@vercel/oidc", () => ({ getVercelOidcToken: mocks.getToken }));
import { postInternalRequest } from "@agent/lib/internal-request";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

test("preserves the Vercel deployment destination and both OIDC headers", async () => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("VERCEL_URL", "openinstinct-preview.vercel.app");
  mocks.getToken.mockResolvedValue("vercel-oidc-token");
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(new Response(null));
  vi.stubGlobal("fetch", fetch);
  const body = { runId: randomUUID() };
  await postInternalRequest("/internal/scheduled-run/report", body);
  expect(mocks.getToken).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledWith(
    new URL(
      "https://openinstinct-preview.vercel.app/internal/scheduled-run/report"
    ),
    expect.objectContaining({
      body: JSON.stringify(body),
      method: "POST",
      redirect: "error",
    })
  );
  const call = fetch.mock.calls[0];
  if (!call) throw new Error("No request was sent");
  const headers = new Headers(call[1]?.headers);
  expect(headers.get("authorization")).toBe("Bearer vercel-oidc-token");
  expect(headers.get("x-vercel-trusted-oidc-idp-token")).toBe(
    "vercel-oidc-token"
  );
  expect(headers.get("content-type")).toBe("application/json");
  expect(headers.has("x-internal-callback-signature")).toBe(false);
});

const route = "/internal/scheduled-run/report";
const run = <A, E>(
  effect: Effect.Effect<A, E, ResolvedInstallationSecrets>,
  config: Record<string, string>
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(ResolvedInstallationSecrets.layer),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown(config)
      )
    ) as Effect.Effect<A, E>
  );

test("production-local client signs real HTTP requests and refuses redirects", async () => {
  let origin = "";
  let requests = 0;
  let redirect = false;
  const server = createServer((incoming, outgoing) => {
    requests += 1;
    const headers = new Headers();
    for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
      const name = incoming.rawHeaders[index];
      const value = incoming.rawHeaders[index + 1];
      if (name !== undefined && value !== undefined)
        headers.append(name, value);
    }
    let payload = "";
    incoming.setEncoding("utf8");
    incoming.on("data", (chunk: string) => {
      payload += chunk;
    });
    incoming.on("end", () => {
      const input = new Request(new URL(incoming.url ?? "/", origin), {
        method: incoming.method,
        headers,
        body: payload,
      });
      void run(
        readVerifiedInternalCallback(
          input,
          incoming.url === "/internal/scheduled-run/respond"
            ? "/internal/scheduled-run/respond"
            : route
        ),
        { BETTER_AUTH_URL: origin }
      ).then(
        (raw) => {
          outgoing.writeHead(
            redirect ? 307 : 202,
            redirect ? { location: `${origin}/redirect-target` } : {}
          );
          outgoing.end(raw);
          return undefined;
        },
        () => {
          outgoing.writeHead(401);
          outgoing.end();
        }
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = Schema.decodeUnknownSync(
    Schema.Struct({ port: Schema.Number })
  )(server.address());
  origin = `http://127.0.0.1:${String(address.port)}`;
  vi.stubEnv("BETTER_AUTH_URL", origin);
  vi.stubEnv("VERCEL_ENV", undefined);
  try {
    const input = { runId: randomUUID() };
    const response = await postInternalRequest(route, input);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(input);
    const answer = {
      runId: randomUUID(),
      leaseToken: randomUUID(),
      answer: "Logan",
    };
    const answered = await postInternalRequest(
      "/internal/scheduled-run/respond",
      answer
    );
    expect(answered.status).toBe(202);
    expect(await answered.json()).toEqual(answer);
    expect(mocks.getToken).not.toHaveBeenCalled();
    redirect = true;
    await expect(postInternalRequest(route, input)).rejects.toMatchObject({
      _tag: "InternalCallbackRejected",
      status: 503,
    });
    expect(requests).toBe(3);
  } finally {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      })
    );
  }
});
