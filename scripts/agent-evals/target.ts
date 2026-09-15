import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Predicate } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import type { launchFixture } from "./fixture";
import { Client } from "eve/client";

/** Loopback-only eval adapter. Production receives an ordinary Better Auth session. */
export const launchTarget = Effect.fn("eval.launchTarget")(function* (
  origin: string,
  fixture: Effect.Success<ReturnType<typeof launchFixture>>
) {
  const token = randomBytes(32).toString("hex");
  const authorization = Buffer.from(`Bearer ${token}`);
  const server = yield* NodeHttpServer.make(createServer, {
    host: "127.0.0.1",
    port: 0,
  });
  yield* server.serve(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const supplied = Buffer.from(request.headers.authorization ?? "");
      if (
        supplied.length !== authorization.length ||
        !timingSafeEqual(supplied, authorization)
      )
        return HttpServerResponse.empty({ status: 401 });
      const url = new URL(request.url, origin);
      if (url.origin !== origin)
        return HttpServerResponse.empty({ status: 403 });
      if (request.method === "GET" && url.pathname === "/_eval/fixture")
        return yield* HttpServerResponse.json(fixture.metadata);
      if (fixture.network) {
        if (request.method === "GET" && url.pathname === "/_eval/network")
          return yield* HttpServerResponse.json(
            yield* fixture.network.inspect()
          );
        if (
          request.method === "POST" &&
          url.pathname === "/_eval/network-human"
        )
          return yield* HttpServerResponse.json(
            yield* fixture.network.direct()
          );
        if (
          request.method === "POST" &&
          url.pathname === "/_eval/network-revoke"
        )
          return yield* HttpServerResponse.json(
            yield* fixture.network.revoke()
          );
      }
      if (request.method === "GET" && url.pathname === "/_eval/ontology")
        return yield* HttpServerResponse.json(yield* fixture.ontology());
      if (request.method === "GET" && url.pathname === "/_eval/file")
        return yield* HttpServerResponse.json(
          yield* fixture.inspect(url.searchParams.get("path") ?? "")
        );
      if (!url.pathname.startsWith("/eve/v1/"))
        return HttpServerResponse.empty({ status: 404 });
      const web = yield* HttpServerRequest.toWeb(request);
      const headers = new Headers(web.headers);
      headers.delete("authorization");
      headers.delete("host");
      headers.delete("content-length");
      headers.set("accept-encoding", "identity");
      headers.set("cookie", fixture.cookie);
      headers.set("x-zoen-workspace", fixture.actor.workspaceId);
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetch(new Request(url, web), { headers, signal, redirect: "error" }),
        catch: () => new Error("Isolated eval target request failed."),
      });
      const outgoing = new Headers(response.headers);
      // Fetch decodes compressed bodies; do not tell the next client to decode twice.
      outgoing.delete("content-encoding");
      outgoing.delete("content-length");
      outgoing.delete("transfer-encoding");
      return HttpServerResponse.fromWeb(
        new Response(response.body, {
          status: response.status,
          headers: outgoing,
        })
      );
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(HttpServerResponse.empty({ status: 502 }))
      )
    )
  );
  if (!Predicate.isTagged(server.address, "TcpAddress"))
    return yield* Effect.die("Expected loopback TCP server");
  const client = new Client({
    host: origin,
    redirect: "error",
    headers: {
      cookie: fixture.cookie,
      "x-zoen-workspace": fixture.actor.workspaceId,
    },
  });
  // Retire our native sessions and their tasks before removing fixture membership.
  // This also runs when the evaluator fails or the CLI is interrupted.
  yield* Effect.addFinalizer(() =>
    fixture.sessions().pipe(
      Effect.flatMap((sessions) =>
        Effect.forEach(
          sessions,
          ({ session_id }) =>
            Effect.tryPromise({
              try: async (signal) => {
                const session = client.sessions.attach(session_id);
                await session.cancel({ tasks: true, signal });
                await session.reset({
                  reason: "Synthetic evaluation completed",
                  signal,
                });
              },
              catch: () =>
                new Error("Could not retire an isolated evaluation session"),
            }),
          { concurrency: 2, discard: true }
        )
      ),
      Effect.timeout("30 seconds"),
      Effect.orDie
    )
  );
  return { token, url: `http://127.0.0.1:${String(server.address.port)}` };
});
