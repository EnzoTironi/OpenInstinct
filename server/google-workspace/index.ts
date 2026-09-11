import { authentication } from "@db/services/auth";
import { PgClient } from "@effect/sql-pg";
import { auth as google } from "@googleapis/gmail";
import { env } from "@shared/environment";
import { applicationOrigin } from "@shared/environment/origin";
import { googleWorkspaceScopes } from "@shared/google-workspace/connection";
import {
  accessScopeForUser,
  type AccessScope,
} from "@shared/identity/access-scope";
import { symmetricDecrypt } from "better-auth/crypto";
import { DateTime, Effect, Redacted, Schema } from "effect";

export class GoogleWorkspaceError extends Schema.TaggedError<GoogleWorkspaceError>()(
  "GoogleWorkspaceError",
  {
    reason: Schema.Literals([
      "unconfigured",
      "unauthenticated",
      "authorization_required",
      "unavailable",
      "invalid_callback",
    ]),
  }
) {}

export const googleWorkspaceUserId = Effect.fn("googleWorkspaceUserId")(
  function* (scope: AccessScope) {
    if (
      !scope.userId.startsWith("better-auth:") ||
      !scope.userId.slice(12).trim() ||
      accessScopeForUser(scope.userId).workspaceId !== scope.workspaceId
    ) {
      return yield* new GoogleWorkspaceError({ reason: "unauthenticated" });
    }

    return scope.userId.slice(12);
  }
);

export const requireGoogleWorkspaceMembership = Effect.fn(
  "requireGoogleWorkspaceMembership"
)(
  function* (scope: AccessScope) {
    const userId = yield* googleWorkspaceUserId(scope);
    const sql = yield* PgClient.PgClient;

    const rows =
      yield* sql`SELECT 1 FROM workspace_memberships WHERE user_id = ${scope.userId} AND workspace_id = ${scope.workspaceId}`;

    if (rows.length !== 1)
      return yield* new GoogleWorkspaceError({ reason: "unauthenticated" });

    return userId;
  },
  Effect.catchTag(
    "SqlError",
    () => new GoogleWorkspaceError({ reason: "unavailable" })
  )
);

const requireConfiguration = Effect.fn("requireGoogleConfiguration")(
  function* () {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      return yield* new GoogleWorkspaceError({ reason: "unconfigured" });
    }

    return yield* Effect.void;
  }
);

const accountSchema = Schema.Struct({
  id: Schema.String,
  scope: Schema.NullOr(Schema.String),
  hasToken: Schema.Boolean,
});

const decodeSchema_Array_accountSchema = Schema.decodeUnknownEffect(
  Schema.Array(accountSchema)
);

const decodeSchema_Array_Schema_Struct_token_Schema_NullOr_Sch =
  Schema.decodeUnknownEffect(
    Schema.Array(Schema.Struct({ token: Schema.NullOr(Schema.String) }))
  );

const findAccount = Effect.fn("findGoogleWorkspaceAccount")(
  function* (scope: AccessScope) {
    const userId = yield* googleWorkspaceUserId(scope);
    const sql = yield* PgClient.PgClient;

    const rows = yield* sql`
    SELECT a.id, a.scope, (a."accessToken" IS NOT NULL OR a."refreshToken" IS NOT NULL) AS "hasToken"
    FROM account a
    INNER JOIN workspace_memberships m ON m.user_id = ${scope.userId} AND m.workspace_id = ${scope.workspaceId}
    WHERE a."userId" = ${userId} AND a."providerId" = 'google'
      AND a.issuer = 'https://accounts.google.com' ORDER BY a."createdAt", a.id LIMIT 2`;

    const accounts = yield* decodeSchema_Array_accountSchema(rows);

    if (accounts.length > 1)
      return yield* new GoogleWorkspaceError({ reason: "unavailable" });

    return accounts[0];
  },
  Effect.catchTag(
    ["SqlError", "SchemaError"],
    () => new GoogleWorkspaceError({ reason: "unavailable" })
  )
);

export function hasGoogleWorkspaceScopes(scope: string | null) {
  const granted = new Set(scope?.split(/[ ,]+/u));

  return googleWorkspaceScopes
    .filter((required) =>
      required.startsWith("https://www.googleapis.com/auth/")
    )
    .every((required) => granted.has(required));
}

const googleAuthRequired = () =>
  new GoogleWorkspaceError({ reason: "authorization_required" });

const googleUnavailable = () =>
  new GoogleWorkspaceError({ reason: "unavailable" });

const googleUnauthenticated = () =>
  new GoogleWorkspaceError({ reason: "unauthenticated" });

type GoogleAccount = typeof accountSchema.Type;

const accountIsAuthorized = (
  account: GoogleAccount | undefined
): account is GoogleAccount =>
  Boolean(account?.hasToken && hasGoogleWorkspaceScopes(account.scope));

const accountStillAuthorized = (
  current: GoogleAccount | undefined,
  account: GoogleAccount
) =>
  current !== undefined &&
  current.id === account.id &&
  current.hasToken &&
  hasGoogleWorkspaceScopes(current.scope);

const accessTokenMissingOrExpired = (
  token: {
    readonly accessToken?: string | null;
    readonly accessTokenExpiresAt?: Date | null;
  },
  now: DateTime.DateTime
) =>
  !token.accessToken ||
  Boolean(
    token.accessTokenExpiresAt &&
    token.accessTokenExpiresAt.getTime() <= DateTime.toEpochMillis(now)
  );

const fetchGoogleAccessToken = (
  auth: Effect.Success<typeof authentication>,
  accountId: string,
  userId: string
) =>
  Effect.tryPromise({
    try: async () =>
      Redacted.make(
        await auth.api.getAccessToken({
          body: { accountId, userId },
        })
      ),
    catch: googleAuthRequired,
  });

const readGoogleSession = (
  auth: Effect.Success<typeof authentication>,
  headers: Headers
) =>
  Effect.tryPromise({
    try: () => auth.api.getSession({ headers }),
    catch: googleUnauthenticated,
  });

const decryptGoogleAccountToken = (
  auth: Effect.Success<typeof authentication>,
  encrypted: string
) =>
  Effect.tryPromise({
    try: async () =>
      Redacted.make(
        await symmetricDecrypt({
          data: encrypted,
          key: (await auth.$context).secretConfig,
        })
      ),
    catch: googleUnavailable,
  });

export const readGoogleWorkspaceConnection = Effect.fn(
  "readGoogleWorkspaceConnection"
)(function* (scope: AccessScope) {
  yield* googleWorkspaceUserId(scope);

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
    return { state: "unavailable" as const };
  const account = yield* findAccount(scope);

  return {
    state:
      account?.hasToken && hasGoogleWorkspaceScopes(account.scope)
        ? ("connected" as const)
        : ("disconnected" as const),
  };
});

export const getGoogleWorkspaceToken = Effect.fn("getGoogleWorkspaceToken")(
  function* (scope: AccessScope) {
    yield* requireConfiguration();
    const userId = yield* googleWorkspaceUserId(scope);
    const account = yield* findAccount(scope);

    if (!accountIsAuthorized(account)) return yield* googleAuthRequired();
    const auth = yield* authentication;
    const result = yield* fetchGoogleAccessToken(auth, account.id, userId);
    const current = yield* findAccount(scope);

    if (!accountStillAuthorized(current, account))
      return yield* googleAuthRequired();

    const token = Redacted.value(result);
    const now = yield* DateTime.now;

    if (accessTokenMissingOrExpired(token, now))
      return yield* googleAuthRequired();

    return Redacted.make({
      token: token.accessToken,
      expiresAt: token.accessTokenExpiresAt?.getTime(),
    });
  }
);

const googleCallbackURL = Effect.fn("googleCallbackURL")(function* (
  value: string
) {
  const url = yield* Effect.try({
    try: () => new URL(value, applicationOrigin()),
    catch: () => new GoogleWorkspaceError({ reason: "invalid_callback" }),
  });

  if (url.origin !== applicationOrigin() || url.username || url.password) {
    return yield* new GoogleWorkspaceError({ reason: "invalid_callback" });
  }

  return url.href;
});

export const connectGoogleWorkspace = Effect.fn("connectGoogleWorkspace")(
  function* (
    headers: Headers,
    callbackURL: string,
    errorCallbackURL: string = callbackURL
  ) {
    yield* requireConfiguration();
    const callback = yield* googleCallbackURL(callbackURL);
    const errorCallback = yield* googleCallbackURL(errorCallbackURL);
    const auth = yield* authentication;

    const session = yield* Effect.tryPromise({
      try: () => auth.api.getSession({ headers }),
      catch: () => new GoogleWorkspaceError({ reason: "unauthenticated" }),
    });

    if (!session)
      return yield* new GoogleWorkspaceError({ reason: "unauthenticated" });
    yield* requireGoogleWorkspaceMembership(
      accessScopeForUser(`better-auth:${session.user.id}`)
    );

    const result = yield* Effect.tryPromise({
      try: () =>
        auth.api.linkSocialAccount({
          headers,
          returnHeaders: true,
          body: {
            provider: "google",
            callbackURL: callback,
            errorCallbackURL: errorCallback,
            disableRedirect: true,
            scopes: [...googleWorkspaceScopes],
          },
        }),
      catch: () => new GoogleWorkspaceError({ reason: "unavailable" }),
    });

    if (!result.response.url)
      return yield* new GoogleWorkspaceError({ reason: "unavailable" });

    return { url: result.response.url, headers: result.headers };
  }
);

export const isInvalidGoogleRevocationToken = Schema.is(
  Schema.Struct({
    response: Schema.Struct({
      status: Schema.Literal(400),
      data: Schema.Struct({ error: Schema.Literal("invalid_token") }),
    }),
  })
);

const revokeGoogleOAuthToken = (token: Redacted.Redacted) =>
  Effect.tryPromise({
    try: () => new google.OAuth2().revokeToken(Redacted.value(token)),
    catch: (cause) => Redacted.make(cause),
  }).pipe(
    Effect.catch((cause) =>
      isInvalidGoogleRevocationToken(Redacted.value(cause))
        ? Effect.void
        : googleUnavailable()
    )
  );

const unlinkGoogleAccount = (
  auth: Effect.Success<typeof authentication>,
  headers: Headers,
  accountId: string
) =>
  Effect.tryPromise({
    try: () => auth.api.unlinkAccount({ headers, body: { accountId } }),
    catch: googleUnavailable,
  });

const revokeEncryptedGoogleToken = Effect.fn("revokeEncryptedGoogleToken")(
  function* (auth: Effect.Success<typeof authentication>, encrypted: string) {
    const token = yield* decryptGoogleAccountToken(auth, encrypted);
    yield* revokeGoogleOAuthToken(token);
  }
);

export const disconnectGoogleWorkspace = Effect.fn("disconnectGoogleWorkspace")(
  function* (headers: Headers) {
    const auth = yield* authentication;
    const session = yield* readGoogleSession(auth, headers);

    if (!session) return yield* googleUnauthenticated();

    const account = yield* findAccount(
      accessScopeForUser(`better-auth:${session.user.id}`)
    );

    if (!account) return yield* Effect.void;
    const sql = yield* PgClient.PgClient;

    const rows =
      yield* sql`SELECT COALESCE("refreshToken", "accessToken") AS token FROM account WHERE id = ${account.id} AND "userId" = ${session.user.id} AND "providerId" = 'google' AND issuer = 'https://accounts.google.com'`;

    const tokens =
      yield* decodeSchema_Array_Schema_Struct_token_Schema_NullOr_Sch(rows);

    const encrypted = tokens[0]?.token;

    if (encrypted) yield* revokeEncryptedGoogleToken(auth, encrypted);

    yield* unlinkGoogleAccount(auth, headers, account.id);

    return yield* Effect.void;
  },
  Effect.catchTag(["SqlError", "SchemaError"], googleUnavailable)
);
