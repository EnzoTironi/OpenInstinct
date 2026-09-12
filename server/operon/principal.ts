import { Context, Effect, Layer, Schema } from "effect";

export const UserId = Schema.NonEmptyString.check(Schema.isTrimmed()).pipe(
  Schema.brand("UserId")
);

export type UserId = typeof UserId.Type;

export const SessionId = Schema.NonEmptyString.check(Schema.isTrimmed()).pipe(
  Schema.brand("SessionId")
);

export type SessionId = typeof SessionId.Type;

export const OrgId = Schema.NonEmptyString.check(Schema.isTrimmed()).pipe(
  Schema.brand("OrgId")
);

export type OrgId = typeof OrgId.Type;

export const Issuer = Schema.NonEmptyString.check(Schema.isTrimmed()).pipe(
  Schema.brand("Issuer")
);

export type Issuer = typeof Issuer.Type;

export const Grant = Schema.Literals(["consumer", "builder"]);

export type Grant = typeof Grant.Type;

export const ChannelBind = Schema.Struct({
  provider: Schema.Literals(["kapso", "telegram", "web"]),
  installationId: Schema.NonEmptyString,
  senderId: Schema.NonEmptyString,
});

export type ChannelBind = typeof ChannelBind.Type;

export const Principal = Schema.TaggedStruct("Principal", {
  userId: UserId,
  sessionId: SessionId,
  issuer: Issuer,
  audience: Schema.Literals(["companion", "operon"]),
  orgId: OrgId,
  grants: Schema.Array(Grant),
  channels: Schema.Array(ChannelBind),
});

export interface Principal extends Schema.Schema.Type<typeof Principal> {}

export const AgentCall = Schema.TaggedStruct("AgentCall", {
  agentId: Schema.NonEmptyString,
  sponsor: UserId,
  grants: Schema.Array(Schema.Literal("consumer")),
});

export interface AgentCall extends Schema.Schema.Type<typeof AgentCall> {}

export const Actor = Schema.Union([Principal, AgentCall]);

export type Actor = typeof Actor.Type;

export class PrincipalError extends Schema.TaggedError<PrincipalError>()(
  "PrincipalError",
  {
    reason: Schema.Literals(["invalid_token", "invalid_principal"]),
  }
) {}

const TokenParts = Schema.Struct({
  version: Schema.Literal("v1"),
  userId: UserId,
  sessionId: SessionId,
  orgId: OrgId,
  audience: Schema.Literals(["companion", "operon"]),
  grants: Schema.Array(Grant),
});

const decodeTokenParts = Schema.decodeUnknownEffect(TokenParts);

export function encodeSessionToken(parts: {
  readonly userId: string;
  readonly sessionId: string;
  readonly orgId: string;
  readonly audience: "companion" | "operon";
  readonly grants: readonly Grant[];
}) {
  return `v1.${parts.userId}.${parts.sessionId}.${parts.orgId}.${parts.audience}.${parts.grants.join("+")}`;
}

function splitToken(token: string) {
  const [version, userId, sessionId, orgId, audience, grantText] =
    token.split(".");
  return {
    version,
    userId,
    sessionId,
    orgId,
    audience,
    grants: grantText === undefined ? [] : grantText.split("+"),
  };
}

function requireConsumer(grants: readonly Grant[]) {
  return grants.includes("consumer")
    ? Effect.void
    : Effect.fail(new PrincipalError({ reason: "invalid_principal" }));
}

interface IssuerApi {
  readonly fromSessionToken: (
    token: string
  ) => Effect.Effect<Principal, PrincipalError>;
}

const makeParseableIssuer = Effect.sync(() =>
  PrincipalIssuer.of({
    fromSessionToken: Effect.fn("PrincipalIssuer.fromSessionToken")(function* (
      token: string
    ) {
      const parts = yield* decodeTokenParts(splitToken(token)).pipe(
        Effect.mapError(() => new PrincipalError({ reason: "invalid_token" }))
      );
      yield* requireConsumer(parts.grants);
      return yield* Principal.makeEffect({
        audience: parts.audience,
        channels: [],
        grants: parts.grants,
        issuer: Issuer.make("companion"),
        orgId: parts.orgId,
        sessionId: parts.sessionId,
        userId: parts.userId,
      }).pipe(
        Effect.mapError(
          () => new PrincipalError({ reason: "invalid_principal" })
        )
      );
    }),
  })
);

export class PrincipalIssuer extends Context.Service<
  PrincipalIssuer,
  IssuerApi
>()("companion/operon/PrincipalIssuer") {
  static readonly parseableLayer = Layer.effect(
    PrincipalIssuer,
    makeParseableIssuer
  );
}
