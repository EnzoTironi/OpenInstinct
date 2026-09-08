import { Effect } from "effect";
import { authentication } from "@db/services/auth";
import { serverRuntime } from "../../../../server/runtime";
import {
  connectGoogleWorkspace,
  GoogleWorkspaceError,
} from "../../../../server/google-workspace";
import { readGoogleWorkspaceChallenge } from "../../../../server/google-workspace/challenge";

export async function GET(request: Request) {
  return serverRuntime.runPromise(
    Effect.gen(function* () {
      const flow = new URL(request.url).searchParams.get("flow");
      if (!flow || flow.length > 8192)
        return handoffFailure("invalid_callback");
      const auth = yield* authentication;
      const session = yield* Effect.tryPromise({
        try: () => auth.api.getSession({ headers: request.headers }),
        catch: () => new GoogleWorkspaceError({ reason: "unauthenticated" }),
      });
      if (!session) return handoffFailure("unauthenticated");
      const callbackURL = yield* readGoogleWorkspaceChallenge(
        flow,
        session.user.id
      );
      const result = yield* connectGoogleWorkspace(
        request.headers,
        callbackURL
      );
      const headers = new Headers({
        Location: result.url,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      });
      for (const cookie of result.headers.getSetCookie())
        headers.append("Set-Cookie", cookie);
      return new Response(null, { status: 302, headers });
    }).pipe(
      Effect.catchTag("GoogleWorkspaceError", (error) =>
        Effect.succeed(handoffFailure(error.reason))
      ),
      Effect.catchTag("AuthUnavailable", () =>
        Effect.succeed(handoffFailure("unavailable"))
      )
    ),
    { signal: request.signal }
  );
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
      status:
        reason === "unauthenticated"
          ? 403
          : reason === "unavailable" || reason === "unconfigured"
            ? 503
            : 400,
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
