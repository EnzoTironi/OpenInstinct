import { eveChannel } from "eve/channels/eve";
import { ForbiddenError, UnauthenticatedError } from "eve/channels/auth";
import { Effect, Result, Schedule, Schema } from "effect";
import { AuthUnavailable } from "@db/services/auth";
import { isSessionOwned } from "@db/services/sessions";
import {
  accessScopeForUser,
  type AccessScope,
} from "@shared/identity/access-scope";
import { getAuthSession } from "@db/services/auth/session";
import { sendMessageToolResultSchema } from "@shared/chat/message-delivery";
import {
  finalizeScheduledReportDelivery,
  releaseScheduledReportDelivery,
  scheduledReportFromSession,
} from "@agent/lib/schedules/report-lifecycle";

export default eveChannel({
  auth: [
    async (request) => {
      const identity = await requestIdentityFromRequest(request);
      if (!identity) return null;
      const { scope } = identity;

      await requireOwnedRouteSubject(scope, request);

      return {
        attributes: {
          authSessionId: identity.sessionId,
          conversationChannel: "eve",
          workspaceId: scope.workspaceId,
        },
        authenticator: "authjs",
        principalId: scope.userId,
        principalType: "user",
      };
    },
    () => {
      throw new UnauthenticatedError({
        code: "authentication_required",
        message: "Sign in to continue.",
      });
    },
  ],
  events: {
    async "action.result"(event, _channel, session) {
      if (
        event.status === "completed" &&
        Result.isSuccess(
          Schema.decodeUnknownResult(sendMessageToolResultSchema)(event.result)
        )
      ) {
        await finalizeScheduledReportDelivery(session);
      }
    },
    async "message.completed"(event, _channel, session) {
      if (event.finishReason === "tool-calls") return;
      if (scheduledReportFromSession(session)) {
        await finalizeScheduledReportDelivery(session, "suppressed");
      }
    },
    async "session.completed"(_event, _channel, session) {
      if (scheduledReportFromSession(session)) {
        await finalizeScheduledReportDelivery(session, "suppressed");
      }
    },
    async "turn.cancelled"(_event, _channel, session) {
      await releaseScheduledReportDelivery(
        session,
        "Scheduled result reporting was cancelled."
      );
    },
    async "turn.failed"(event, _channel, session) {
      await releaseScheduledReportDelivery(session, event.message);
    },
  },
});

// Routes without a session subject. Every other eve route must name a session
// this caller owns, either in the path or inside a hook token.
const subjectFreeRoutes = new Set(["/eve/v1/info", "/eve/v1/session"]);

async function requireOwnedRouteSubject(scope: AccessScope, request: Request) {
  const { pathname } = new URL(request.url);
  if (subjectFreeRoutes.has(pathname)) return;
  const sessionId = sessionIdFromPath(pathname);
  if (
    !sessionId ||
    !(await Effect.runPromise(waitForSessionOwnership(scope, sessionId), {
      signal: request.signal,
    }))
  ) {
    throw new ForbiddenError({ message: "Session not found." });
  }
}

export function sessionIdFromPath(pathname: string) {
  const session = /^\/eve\/v1\/session\/([^/]+)/.exec(pathname)?.[1];
  if (session) return decodePathSegment(session);
  const hookToken =
    /^\/eve\/v1\/(?:callback|connections\/[^/]+\/callback(?:\/[^/]+)?)\/([^/]+)$/.exec(
      pathname
    )?.[1];
  const token = hookToken ? decodePathSegment(hookToken) : undefined;
  return token ? sessionIdFromHookToken(token) : undefined;
}

// Hook tokens are derived from the session id: `eve:session:<id>:inbox`,
// `<id>:turn-control:<n>[:cancel|:inbox]`, and `<id>:auth`.
function sessionIdFromHookToken(token: string) {
  return (
    /^eve:session:([^:]+):inbox$/.exec(token)?.[1] ??
    /^([^:]+):turn-control:\d+(?::(?:cancel|inbox))?$/.exec(token)?.[1] ??
    /^([^:]+):auth$/.exec(token)?.[1]
  );
}

function decodePathSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

async function requestIdentityFromRequest(request: Request) {
  const session = await getAuthSession(request.headers);
  if (!session) return undefined;
  return {
    scope: accessScopeForUser(`better-auth:${session.user.id}`),
    sessionId: session.session.id,
  };
}

const waitForSessionOwnership = Effect.fn("waitForSessionOwnership")(function* (
  scope: AccessScope,
  sessionId: string
) {
  return yield* Effect.tryPromise({
    try: () => isSessionOwned(scope, sessionId),
    catch: () => new AuthUnavailable(),
  }).pipe(
    Effect.repeat({
      while: (owned) => !owned,
      times: 49,
      schedule: Schedule.spaced("100 millis"),
    })
  );
});
