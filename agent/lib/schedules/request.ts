import { getVercelOidcToken } from "@vercel/oidc";
import { Config, Effect, Option, Schema } from "effect";
import {
  ScheduledCallbackRejected,
  scheduledCallbackBodies,
  scheduledCallbackHeaders,
  scheduledCallbackOrigin,
  type ScheduledCallbackRoute,
} from "../../../server/internal/scheduled-callback-auth";

const postScheduledRequest = Effect.fn("postScheduledRequest")(function* <
  Route extends ScheduledCallbackRoute,
>(route: Route, body: (typeof scheduledCallbackBodies)[Route]["Type"]) {
  const value = yield* route === "/internal/scheduled-run/report"
    ? Schema.decodeUnknownEffect(
        scheduledCallbackBodies["/internal/scheduled-run/report"],
        { onExcessProperty: "error" }
      )(body)
    : Schema.decodeUnknownEffect(
        scheduledCallbackBodies["/internal/scheduled-run/respond"],
        { onExcessProperty: "error" }
      )(body);
  const serialized = JSON.stringify(value);
  const vercel = yield* Config.option(Config.string("VERCEL_ENV"));
  let origin: string;
  let headers: Headers;
  if (Option.isSome(vercel)) {
    const hostname = yield* Config.string("VERCEL_URL");
    origin = new URL(`https://${hostname}`).origin;
    const token = yield* Effect.tryPromise({
      try: () => getVercelOidcToken(),
      catch: () => new ScheduledCallbackRejected({ status: 503 }),
    });
    headers = new Headers({
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-vercel-trusted-oidc-idp-token": token,
    });
  } else {
    origin = yield* scheduledCallbackOrigin;
    headers = yield* scheduledCallbackHeaders(route, serialized);
  }
  return yield* Effect.tryPromise({
    try: (signal) =>
      fetch(new URL(route, origin), {
        body: serialized,
        headers,
        method: "POST",
        redirect: "error",
        signal,
      }),
    catch: () => new ScheduledCallbackRejected({ status: 503 }),
  }).pipe(Effect.timeout("10 seconds"));
});

export function postScheduledRunRoute<Route extends ScheduledCallbackRoute>(
  route: Route,
  body: (typeof scheduledCallbackBodies)[Route]["Type"]
) {
  return Effect.runPromise(postScheduledRequest(route, body));
}

export function postScheduledReport(runId: string) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const response = yield* postScheduledRequest(
        "/internal/scheduled-run/report",
        { runId }
      );
      if (!response.ok)
        return yield* new ScheduledCallbackRejected({ status: 503 });
      return undefined;
    })
  );
}
