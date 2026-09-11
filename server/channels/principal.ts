import { Effect, Schema } from "effect";
import type { ChannelSendOptions } from "eve/channels";

import { accessScopeForUser } from "../../shared/identity/access-scope";
import type { Identity } from "../accounts";
import { ChannelTransport } from "./transport";
const decodeSchema_String_check_Schema_isUUID = Schema.decodeUnknownEffect(Schema.String.check(Schema.isUUID()));

export class ChannelDispatchError extends Schema.TaggedError<ChannelDispatchError>()(
  "ChannelDispatchError",
  {
    reason: Schema.Literals([
      "unauthorized",
      "handoff_unknown",
      "unsupported_media",
    ]),
  }
) {}

export const channelPrincipal = (
  identity: Identity,
  sourceMessageId?: string
) => {
  const principalId = `better-auth:${identity.userId}`;

  const attributes = {
    channelIdentityId: identity.id,
    conversationChannel: identity.channel,
    conversationId: identity.id,
    workspaceId: accessScopeForUser(principalId).workspaceId,
  };

  const principal = {
    attributes,
    authenticator: "verified-channel",
    principalId,
    principalType: "user",
  };

  if (!sourceMessageId) return principal;

  return { ...principal, attributes: { ...attributes, sourceMessageId } };
};

export const requireChannelPrincipal = Effect.fn("requireChannelPrincipal")(
  function* (channel: Identity["channel"], auth: ChannelSendOptions["auth"]) {
    if (!auth)
      return yield* new ChannelDispatchError({ reason: "unauthorized" });

    const identityId = yield* decodeSchema_String_check_Schema_isUUID(auth.attributes.channelIdentityId).pipe(
      Effect.mapError(
        () => new ChannelDispatchError({ reason: "unauthorized" })
      )
    );

    const transport = yield* ChannelTransport;
    const identity = yield* transport.activeIdentity(identityId, channel);
    const expected = channelPrincipal(identity);

    if (
      auth.principalType !== "user" ||
      auth.principalId !== expected.principalId ||
      auth.attributes.workspaceId !== expected.attributes.workspaceId ||
      auth.attributes.conversationChannel !== channel ||
      auth.attributes.conversationId !== identity.id
    )
      return yield* new ChannelDispatchError({ reason: "unauthorized" });

    return identity;
  }
);
