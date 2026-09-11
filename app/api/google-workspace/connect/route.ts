import { authentication } from "@db/services/auth";
import { applicationOrigin } from "@shared/environment/origin";
import { googleWorkspaceReturnTo } from "@shared/google-workspace/connection";
import { Effect } from "effect";

import {
  connectGoogleWorkspace,
  GoogleWorkspaceError,
} from "../../../../server/google-workspace";
import { readGoogleWorkspaceChallenge } from "../../../../server/google-workspace/challenge";
import { serverRuntime } from "../../../../server/runtime";

// oxlint-disable-next-line react-doctor/nextjs-no-side-effect-in-get-handler -- OAuth connect handoff; Set-Cookie is the intended side effect
export async function GET(request: Request) {
  return serverRuntime.runPromise(
    Effect.gen(connectGoogleWorkspaceHandoff(request)).pipe(
      Effect.catchTag("GoogleWorkspaceError", succeedHandoffFailure),
      Effect.catchTag("AuthUnavailable", unavailableHandoffFailure)
    ),
    { signal: request.signal }
  );
}

function connectGoogleWorkspaceHandoff(request: Request) {
  return function* () {
    const params = new URL(request.url).searchParams;
    const flow = params.get("flow");

    if (isInvalidFlow(flow)) {
      return handoffFailure("invalid_callback");
    }

    const auth = yield* authentication;
    const session = yield* Effect.tryPromise(sessionAttempt(auth, request));

    if (!session) {
      return handoffFailure("unauthenticated");
    }

    const home = homeCallbacks(params.get("returnTo") ?? undefined);
    const callbackURL = yield* resolveCallbackURL(flow, home, session.user.id);

    const errorCallbackURL =
      flow === null ? home.errorCallbackURL : callbackURL;

    const result = yield* connectGoogleWorkspace(
      request.headers,
      callbackURL,
      errorCallbackURL
    );

    return redirectWithCookies(result.url, result.headers);
  };
}

function isInvalidFlow(flow: string | null): boolean {
  return flow !== null && (!flow || flow.length > 8192);
}

function sessionAttempt(
  auth: {
    readonly api: {
      readonly getSession: (args: {
        readonly headers: Headers;
      }) => Promise<{ readonly user: { readonly id: string } } | null>;
    };
  },
  request: Request
) {
  return {
    try: () => auth.api.getSession({ headers: request.headers }),
    catch: () => new GoogleWorkspaceError({ reason: "unauthenticated" }),
  } as const;
}

function resolveCallbackURL(
  flow: string | null,
  home: ReturnType<typeof homeCallbacks>,
  userId: string
) {
  if (flow === null) {
    return Effect.succeed(home.callbackURL);
  }

  return readGoogleWorkspaceChallenge(flow, userId);
}

function redirectWithCookies(location: string, source: Headers) {
  const headers = new Headers({
    Location: location,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });

  for (const cookie of source.getSetCookie()) {
    headers.append("Set-Cookie", cookie);
  }

  return new Response(null, { status: 302, headers });
}

function succeedHandoffFailure(error: GoogleWorkspaceError) {
  return Effect.succeed(handoffFailure(error.reason));
}

function unavailableHandoffFailure() {
  return Effect.succeed(handoffFailure("unavailable"));
}

function handoffFailure(reason: GoogleWorkspaceError["reason"]) {
  const messages = {
    invalid_callback:
      "This connection link has expired or could not be verified. Return to your conversation and ask to connect Google Workspace again.",
    unauthenticated:
      "This link belongs to a different Companion account, or you need to sign in. Sign in with the account that requested the connection, then retry from that conversation.",
    unconfigured:
      "Google Workspace is not configured on this installation. Ask the installation owner to configure it, then retry from your conversation.",
    unavailable:
      "Google Workspace could not be connected. Return to your conversation and try again.",
    authorization_required:
      "Google Workspace needs your authorization. Return to your conversation and start the connection again.",
  };

  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect Google Workspace</title></head><body><main><h1>Google Workspace could not be connected</h1><p>${messages[reason]}</p><p><a href="/chat/history">Return to your conversations</a></p><p><a href="/">Return home</a></p></main></body></html>`,
    {
      status: handoffFailureStatus(reason),
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      },
    }
  );
}

function handoffFailureStatus(reason: GoogleWorkspaceError["reason"]): number {
  if (reason === "unauthenticated") {
    return 403;
  }

  if (reason === "unavailable" || reason === "unconfigured") {
    return 503;
  }

  return 400;
}

function homeCallbacks(returnTo: string | undefined) {
  const origin = applicationOrigin();
  const path = googleWorkspaceReturnTo(returnTo);
  const callback = new URL(path, origin);
  callback.searchParams.set("google", "connected");
  const errorCallback = new URL("/", origin);
  errorCallback.searchParams.set("google", "unavailable");
  errorCallback.searchParams.set("returnTo", path);

  return { callbackURL: callback.href, errorCallbackURL: errorCallback.href };
}
