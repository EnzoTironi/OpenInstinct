import { Effect, Schema } from "effect";
import { ProviderReferenceSchema } from "./inbound";

export const ChatKindSchema = Schema.Literals(["private", "group"]);
export type ChatKind = typeof ChatKindSchema.Type;

export interface GroupMentionSignals {
  readonly mentionedBot: boolean;
  readonly replyToBot: boolean;
}

/** Release-1 group ingress: never accept bare chatter (no spam). */
export const evaluateGroupMentionPolicy = (
  signals: GroupMentionSignals
): boolean => signals.mentionedBot || signals.replyToBot;

export const detectTelegramChatKind = (
  chatType: string
): ChatKind | "unsupported" => {
  if (chatType === "private") return "private";
  if (chatType === "group" || chatType === "supergroup") return "group";
  return "unsupported";
};

export const detectKapsoChatKind = (conversation: {
  readonly is_group?: boolean;
  readonly type?: string;
}): ChatKind => {
  if (conversation.is_group === true || conversation.type === "group")
    return "group";
  return "private";
};

const telegramMentionPattern = (botUsername: string) => {
  const name = botUsername.replace(/^@/, "");
  return new RegExp(`(?:^|\\s)@${name}(?:\\b|$)`, "i");
};

/** UTF-16 entity offsets match Telegram Bot API text indexing. */
export const telegramTextMentionsBot = (
  text: string | undefined,
  botUsername: string,
  entities:
    | readonly {
        readonly type: string;
        readonly offset: number;
        readonly length: number;
        readonly user?: { readonly id: number };
      }[]
    | undefined,
  botId: string
): boolean => {
  const name = botUsername.replace(/^@/, "");
  if (!text) return false;
  if (telegramMentionPattern(name).test(text)) return true;
  if (!entities?.length) return false;
  for (const entity of entities) {
    if (entity.type === "mention") {
      const slice = text.slice(entity.offset, entity.offset + entity.length);
      if (slice.replace(/^@/, "").toLowerCase() === name.toLowerCase())
        return true;
    }
    if (
      entity.type === "text_mention" &&
      entity.user !== undefined &&
      String(entity.user.id) === botId
    )
      return true;
  }
  return false;
};

export const GroupIdentityBindingSchema = Schema.Struct({
  identityId: Schema.String.check(Schema.isUUID()),
  channel: Schema.Literals(["telegram", "kapso"]),
  installationId: ProviderReferenceSchema,
  senderId: ProviderReferenceSchema,
  chatId: ProviderReferenceSchema,
  chatKind: Schema.Literal("group"),
  conversationScope: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(320),
    Schema.isTrimmed()
  ),
  /** Outbound target is the group chat, never the private sender DM. */
  deliveryTargetId: ProviderReferenceSchema,
});
export type GroupIdentityBinding = typeof GroupIdentityBindingSchema.Type;

/**
 * Bind a group conversation to an already-linked private `channel_identity`.
 * Actor authority stays on the sender row; conversation scope is group-keyed.
 * No database writes — G02/G03 own persistence and shared memory.
 */
export const bindGroupChannelIdentity = Effect.fn("bindGroupChannelIdentity")(
  function* (input: {
    readonly identityId: string;
    readonly channel: "telegram" | "kapso";
    readonly installationId: string;
    readonly senderId: string;
    readonly chatId: string;
  }) {
    const conversationScope = `group:${input.channel}:${input.installationId}:${input.chatId}`;
    return yield* Schema.decodeUnknownEffect(GroupIdentityBindingSchema)({
      identityId: input.identityId,
      channel: input.channel,
      installationId: input.installationId,
      senderId: input.senderId,
      chatId: input.chatId,
      chatKind: "group",
      conversationScope,
      deliveryTargetId: input.chatId,
    });
  }
);
