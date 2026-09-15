import { Clock, Effect, Schema } from "effect";

import { actionHostBindingSchema, type ActionHostBinding } from "./catalog";
import { generatePrefixedId } from "./types";

const decodeScope = Schema.decodeUnknownEffect(actionHostBindingSchema);

export const whatsAppHistorySchema = Schema.Literals(["complete", "partial"]);
export type WhatsAppHistory = typeof whatsAppHistorySchema.Type;

export const whatsAppDeliverySchema = Schema.Literals([
  "accepted",
  "delivered",
  "queued",
]);
export type WhatsAppDelivery = typeof whatsAppDeliverySchema.Type;

export const whatsAppSendClaimSchema = Schema.Literals([
  "delivered",
  "pending",
]);
export type WhatsAppSendClaim = typeof whatsAppSendClaimSchema.Type;

export class WhatsAppRejected extends Schema.TaggedError<WhatsAppRejected>()(
  "WhatsAppRejected",
  {
    reason: Schema.Literals([
      "coverage_overclaim",
      "invalid_parameter",
      "invalid_scope",
      "unauthorized_chat",
      "unpaired",
    ]),
  }
) {}

interface StoredChat {
  readonly authorized: boolean;
  readonly history: WhatsAppHistory;
  readonly id: string;
  readonly messages: readonly string[];
  readonly remoteId: string;
  readonly userId: string;
  readonly workspaceId: string;
}

interface BridgeState {
  readonly chats: Map<string, StoredChat>;
  readonly connected: Map<string, true>;
  readonly pairingSecrets: Map<string, string>;
}

function reject(reason: WhatsAppRejected["reason"]) {
  return new WhatsAppRejected({ reason });
}

function scopeKey(scope: ActionHostBinding): string {
  return `${scope.workspaceId}\0${scope.userId}`;
}

function recordKey(scope: ActionHostBinding, id: string): string {
  return `${scopeKey(scope)}\0${id}`;
}

const requireHost = Effect.fn("InMemoryWhatsApp.requireHost")(function* (
  scope: ActionHostBinding
) {
  return yield* decodeScope(scope).pipe(
    Effect.mapError(() => reject("invalid_scope"))
  );
});

export function whatsAppSendClaim(
  delivery: WhatsAppDelivery
): WhatsAppSendClaim {
  switch (delivery) {
    case "accepted":
    case "queued":
      return "pending";
    case "delivered":
      return "delivered";
    default: {
      const exhaustive: never = delivery;
      return exhaustive;
    }
  }
}

const connectImpl = Effect.fn("InMemoryWhatsApp.connect")(function* (
  state: BridgeState,
  scope: ActionHostBinding
) {
  const host = yield* requireHost(scope);
  const recordedAt = yield* Clock.currentTimeMillis;
  const secret = generatePrefixedId("pair", recordedAt);
  state.connected.set(scopeKey(host), true);
  state.pairingSecrets.set(scopeKey(host), secret);
  return { pairingNonce: secret };
});

const requireConnected = Effect.fn("InMemoryWhatsApp.requireConnected")(
  function* (state: BridgeState, scope: ActionHostBinding) {
    const host = yield* requireHost(scope);
    if (!state.connected.has(scopeKey(host))) {
      return yield* reject("unpaired");
    }
    return host;
  }
);

const storeChatImpl = Effect.fn("InMemoryWhatsApp.storeChat")(function* (
  state: BridgeState,
  scope: ActionHostBinding,
  remoteId: string
) {
  const host = yield* requireConnected(state, scope);
  const id = remoteId.trim();
  if (id.length === 0) {
    return yield* reject("invalid_parameter");
  }
  const recordedAt = yield* Clock.currentTimeMillis;
  const chat: StoredChat = {
    authorized: false,
    history: "partial",
    id: generatePrefixedId("wac", recordedAt),
    messages: [],
    remoteId: id,
    userId: host.userId,
    workspaceId: host.workspaceId,
  };
  state.chats.set(recordKey(host, chat.id), chat);
  return chat.id;
});

const authorizeChatImpl = Effect.fn("InMemoryWhatsApp.authorizeChat")(
  function* (state: BridgeState, scope: ActionHostBinding, chatId: string) {
    const host = yield* requireConnected(state, scope);
    const key = recordKey(host, chatId);
    const chat = state.chats.get(key);
    if (!chat) {
      return yield* reject("unauthorized_chat");
    }
    state.chats.set(key, { ...chat, authorized: true });
    return chatId;
  }
);

const revokeChatImpl = Effect.fn("InMemoryWhatsApp.revokeChat")(function* (
  state: BridgeState,
  scope: ActionHostBinding,
  chatId: string
) {
  const host = yield* requireConnected(state, scope);
  const key = recordKey(host, chatId);
  const chat = state.chats.get(key);
  if (!chat) {
    return yield* reject("unauthorized_chat");
  }
  state.chats.set(key, { ...chat, authorized: false });
  return chatId;
});

const requireAuthorizedChat = Effect.fn(
  "InMemoryWhatsApp.requireAuthorizedChat"
)(function* (state: BridgeState, scope: ActionHostBinding, chatId: string) {
  const host = yield* requireConnected(state, scope);
  const chat = state.chats.get(recordKey(host, chatId));
  if (!chat || !chat.authorized) {
    return yield* reject("unauthorized_chat");
  }
  return chat;
});

const storeMessageImpl = Effect.fn("InMemoryWhatsApp.storeMessage")(function* (
  state: BridgeState,
  scope: ActionHostBinding,
  chatId: string,
  body: string
) {
  const host = yield* requireConnected(state, scope);
  const key = recordKey(host, chatId);
  const chat = state.chats.get(key);
  if (!chat) {
    return yield* reject("unauthorized_chat");
  }
  const text = body.trim();
  if (text.length === 0) {
    return yield* reject("invalid_parameter");
  }
  state.chats.set(key, { ...chat, messages: [...chat.messages, text] });
  return chatId;
});

const readMessagesImpl = Effect.fn("InMemoryWhatsApp.readMessages")(function* (
  state: BridgeState,
  scope: ActionHostBinding,
  chatId: string
) {
  const chat = yield* requireAuthorizedChat(state, scope, chatId);
  return chat.messages;
});

const listAgentChatsImpl = Effect.fn("InMemoryWhatsApp.listAgentChats")(
  function* (state: BridgeState, scope: ActionHostBinding) {
    const host = yield* requireConnected(state, scope);
    return [...state.chats.values()]
      .filter(
        (chat) =>
          chat.authorized &&
          chat.userId === host.userId &&
          chat.workspaceId === host.workspaceId
      )
      .map((chat) => ({
        history: chat.history,
        id: chat.id,
        remoteId: chat.remoteId,
      }));
  }
);

const catchUpImpl = Effect.fn("InMemoryWhatsApp.catchUp")(function* (
  state: BridgeState,
  scope: ActionHostBinding
) {
  const visible = yield* listAgentChatsImpl(state, scope);
  const host = yield* requireConnected(state, scope);
  const stored = [...state.chats.values()].filter(
    (chat) =>
      chat.userId === host.userId && chat.workspaceId === host.workspaceId
  );
  const incomplete = visible.some((chat) => chat.history === "partial");
  return {
    chatIds: visible.map((chat) => chat.id),
    history:
      incomplete || visible.length < stored.length
        ? ("partial" as const)
        : ("complete" as const),
  };
});

const markHistoryImpl = Effect.fn("InMemoryWhatsApp.markHistory")(function* (
  state: BridgeState,
  scope: ActionHostBinding,
  chatId: string,
  history: WhatsAppHistory
) {
  const chat = yield* requireAuthorizedChat(state, scope, chatId);
  const host = yield* requireHost(scope);
  state.chats.set(recordKey(host, chat.id), { ...chat, history });
  return history;
});

export const claimExhaustiveWhatsAppHistory = Effect.fn(
  "claimExhaustiveWhatsAppHistory"
)(function* (history: WhatsAppHistory) {
  switch (history) {
    case "complete":
      return history;
    case "partial":
      return yield* reject("coverage_overclaim");
    default: {
      const exhaustive: never = history;
      return exhaustive;
    }
  }
});

/**
 * Host-scoped WhatsApp grant catalog: chats may exist in bridge storage before
 * the agent may read them. Pairing secrets never appear on the agent surface.
 * This catalog does not talk to a provider or Mem0.
 */
export class InMemoryWhatsApp {
  readonly #state: BridgeState = {
    chats: new Map(),
    connected: new Map(),
    pairingSecrets: new Map(),
  };

  connect(scope: ActionHostBinding) {
    return connectImpl(this.#state, scope);
  }

  storeChat(scope: ActionHostBinding, remoteId: string) {
    return storeChatImpl(this.#state, scope, remoteId);
  }

  authorizeChat(scope: ActionHostBinding, chatId: string) {
    return authorizeChatImpl(this.#state, scope, chatId);
  }

  revokeChat(scope: ActionHostBinding, chatId: string) {
    return revokeChatImpl(this.#state, scope, chatId);
  }

  storeMessage(scope: ActionHostBinding, chatId: string, body: string) {
    return storeMessageImpl(this.#state, scope, chatId, body);
  }

  readMessages(scope: ActionHostBinding, chatId: string) {
    return readMessagesImpl(this.#state, scope, chatId);
  }

  listAgentChats(scope: ActionHostBinding) {
    return listAgentChatsImpl(this.#state, scope);
  }

  catchUp(scope: ActionHostBinding) {
    return catchUpImpl(this.#state, scope);
  }

  markHistory(
    scope: ActionHostBinding,
    chatId: string,
    history: WhatsAppHistory
  ) {
    return markHistoryImpl(this.#state, scope, chatId, history);
  }
}
