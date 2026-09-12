import { Effect, Option, Schema } from "effect";
import type { ChannelSendOptions } from "eve/channels";
import type { Identity } from "../accounts";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { groupSessionMemoryAttributes } from "../personal-memory/group-memory-policy";
import { groupConversationMatchesIdentity } from "./group-policy";
import { ChannelTransport } from "./transport";

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
  sourceMessageId?: string,
  group?: {
    readonly conversationScope: string;
    readonly chatKind: "group";
    readonly chatId: string;
  }
) => {
  const principalId = `better-auth:${identity.userId}`;
  const workspaceId = accessScopeForUser(principalId).workspaceId;
  const attributes = group
    ? {
        channelIdentityId: identity.id,
        conversationChannel: identity.channel,
        conversationId: group.conversationScope,
        workspaceId,
        ...groupSessionMemoryAttributes(group),
      }
    : {
        channelIdentityId: identity.id,
        conversationChannel: identity.channel,
        conversationId: identity.id,
        workspaceId,
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
    const identityId = yield* Schema.decodeUnknownEffect(
      Schema.String.check(Schema.isUUID())
    )(auth.attributes.channelIdentityId).pipe(
      Effect.mapError(
        () => new ChannelDispatchError({ reason: "unauthorized" })
      )
    );
    const transport = yield* ChannelTransport;
    const identity = yield* transport.activeIdentity(identityId, channel);
    const expected = channelPrincipal(identity);
    const conversationId = Option.getOrUndefined(
      Schema.decodeUnknownOption(Schema.String)(auth.attributes.conversationId)
    );
    const conversationOk =
      conversationId === identity.id ||
      (conversationId !== undefined &&
        groupConversationMatchesIdentity(conversationId, identity));
    if (
      auth.principalType !== "user" ||
      auth.principalId !== expected.principalId ||
      auth.attributes.workspaceId !== expected.attributes.workspaceId ||
      auth.attributes.conversationChannel !== channel ||
      !conversationOk
    )
      return yield* new ChannelDispatchError({ reason: "unauthorized" });
    return identity;
  }
);
