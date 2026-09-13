import { defineChannel } from "eve/channels";
import { eveChannel } from "eve/channels/eve";
import {
  ForbiddenError,
  localDev,
  routeAuth,
  UnauthenticatedError,
} from "eve/channels/auth";
import { Effect, Result, Schedule, Schema } from "effect";
import { AuthUnavailable } from "@db/services/auth";
import { isSessionOwned } from "@db/services/sessions";
import {
  accessScopeForUser,
  type AccessScope,
} from "@shared/identity/access-scope";
import { getAuthSession } from "@db/services/auth/session";
import { serverRuntime } from "../../server/runtime";
import { resolveWorkspaceActor } from "../../server/workspaces/session";
import { sendMessageToolResultSchema } from "@shared/chat/message-delivery";
import {
  finalizeScheduledReportDelivery,
  releaseScheduledReportDelivery,
  scheduledReportFromSession,
} from "@agent/lib/schedules/report-lifecycle";

const authenticateLocalDev = localDev();

const authenticate: Parameters<typeof routeAuth>[1] = [
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
        workspaceKind: identity.workspaceKind,
      },
      authenticator: "authjs",
      principalId: scope.userId,
      principalType: "user",
    };
  },
  async (request) => {
    const local = await authenticateLocalDev(request);
    if (!local) return null;

    const scope = accessScopeForUser("better-auth:browser-benchmark");
    await requireOwnedRouteSubject(scope, request);

    return {
      ...local,
      attributes: {
        ...local.attributes,
        authSessionId: "browser-benchmark",
        conversationChannel: "eve",
        workspaceId: scope.workspaceId,
      },
      principalId: scope.userId,
      principalType: "user" as const,
    };
  },
  () => {
    throw new UnauthenticatedError({
      code: "authentication_required",
      message: "Sign in to continue.",
    });
  },
];

const channel = eveChannel({
  auth: authenticate,
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

// Eve callback handlers authenticate their capability tokens internally. Apply
// this app's caller and workspace ownership policy at the public route boundary.
const ownedCallbackRoutes = new Set([
  "/eve/v1/connections/:name/callback/:attemptId/:token",
  "/eve/v1/connections/:name/callback/:token",
  "/eve/v1/callback/:token",
  "/eve/v1/task-input/:token",
]);

export default defineChannel({
  ...channel,
  // oxlint-disable-next-line oxc/no-map-spread -- Keep Eve's original route definitions intact when adding the app authorization boundary.
  routes: channel.routes.map((route) => {
    if (
      route.transport === "websocket" ||
      !ownedCallbackRoutes.has(route.path)
    ) {
      return route;
    }
    return {
      ...route,
      async handler(request, context) {
        const principal = await routeAuth(request, authenticate);
        if (principal instanceof Response) return principal;
        return route.handler(request, context);
      },
    };
  }),
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
  const actor = await serverRuntime.runPromise(
    resolveWorkspaceActor(request.headers),
    { signal: request.signal }
  );
  return {
    scope: { userId: actor.userId, workspaceId: actor.workspaceId },
    workspaceKind: actor.organizationId === null ? "personal" : "company",
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
