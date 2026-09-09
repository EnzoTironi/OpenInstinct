import { auth } from "@googleapis/gmail";
import { Effect, Redacted, Schema } from "effect";
import {
  ConnectionAuthorizationFailedError,
  ConnectionAuthorizationRequiredError,
  defineInteractiveAuthorization,
  type ConnectionPrincipal,
} from "eve/connections";
import type { SessionAuthContext } from "eve/context";
import type { ToolContext } from "eve/tools";
import { scopeFromPrincipal } from "../../../shared/identity/principal-scope";
import { serverRuntime } from "../../../server/runtime";
import { getGoogleWorkspaceToken } from "../../../server/google-workspace";
import { createGoogleWorkspaceChallenge } from "../../../server/google-workspace/challenge";

function googleScope(principal: ConnectionPrincipal) {
  if (principal.type !== "user")
    throw new ConnectionAuthorizationFailedError("google-workspace", {
      reason: "principal_required",
      retryable: false,
    });
  return scopeFromPrincipal(principal);
}

/** Project Eve's connection principal into the live-authority SessionAuth shape. */
function liveGoogleConsentPrincipal(
  principal: ConnectionPrincipal
): SessionAuthContext {
  if (principal.type !== "user")
    throw new ConnectionAuthorizationFailedError("google-workspace", {
      reason: "principal_required",
      retryable: false,
    });
  return {
    attributes: principal.attributes ?? {},
    // Eve stores the session authenticator on issuer when no IdP issuer is set.
    authenticator: principal.issuer ?? "unknown",
    principalId: principal.id,
    principalType: "user",
  };
}

async function readToken(principal: ConnectionPrincipal) {
  return serverRuntime.runPromise(
    getGoogleWorkspaceToken(googleScope(principal)).pipe(
      Effect.map(Redacted.value),
      Effect.catchTag("GoogleWorkspaceError", (error) =>
        Effect.fail(
          error.reason === "authorization_required"
            ? new ConnectionAuthorizationRequiredError("google-workspace")
            : new ConnectionAuthorizationFailedError("google-workspace", {
                reason: error.reason,
                retryable: false,
              })
        )
      ),
      Effect.catchTag("AuthUnavailable", () =>
        Effect.fail(
          new ConnectionAuthorizationFailedError("google-workspace", {
            reason: "unavailable",
            retryable: false,
          })
        )
      )
    )
  );
}

const googleWorkspaceAuth = defineInteractiveAuthorization({
  getToken: ({ principal }) => readToken(principal),
  async startAuthorization({ principal, callbackUrl }) {
    const url = await serverRuntime.runPromise(
      createGoogleWorkspaceChallenge(
        liveGoogleConsentPrincipal(principal),
        callbackUrl
      ).pipe(
        Effect.catchTag("GoogleWorkspaceError", (error) =>
          Effect.fail(
            new ConnectionAuthorizationFailedError("google-workspace", {
              reason: error.reason,
              retryable: false,
            })
          )
        )
      )
    );
    return { challenge: { url, displayName: "Google Workspace" } };
  },
  completeAuthorization({ principal, callback }) {
    if (callback.params.error)
      throw new ConnectionAuthorizationFailedError("google-workspace", {
        reason: "authorization_denied",
        retryable: false,
      });
    return readToken(principal);
  },
});

class GoogleApiError extends Schema.TaggedError<GoogleApiError>()(
  "GoogleApiError",
  { status: Schema.optionalKey(Schema.Number) }
) {}
const googleApiErrorSchema = Schema.Struct({
  response: Schema.Struct({
    status: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 })),
  }),
});

export function googleApiErrorStatus(cause: unknown) {
  return Schema.is(googleApiErrorSchema)(cause)
    ? cause.response.status
    : undefined;
}

export function googleApiFailure(cause: unknown) {
  return new GoogleApiError({ status: googleApiErrorStatus(cause) });
}

export async function withGoogleAuth<T>(
  ctx: ToolContext,
  execute: (authClient: InstanceType<typeof auth.OAuth2>) => Promise<T>
) {
  const { token } = await ctx.getToken(googleWorkspaceAuth);
  const authClient = new auth.OAuth2();
  authClient.setCredentials({ access_token: token });
  return Effect.runPromise(
    Effect.tryPromise({
      try: () => execute(authClient),
      catch: googleApiFailure,
    }).pipe(
      Effect.catchTag("GoogleApiError", (error) => {
        if (error.status === 401)
          return Effect.sync(() => ctx.requireAuth(googleWorkspaceAuth));
        return Effect.fail(error);
      })
    ),
    { signal: ctx.abortSignal }
  );
}
