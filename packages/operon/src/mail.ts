import { Clock, Effect, Schema } from "effect";

import { actionHostBindingSchema, type ActionHostBinding } from "./catalog";
import { generatePrefixedId } from "./types";

export const MAX_INBOX_ARCHIVE_BATCH = 20;

const requiredId = Schema.String.check(Schema.isMinLength(1));
const decodeScope = Schema.decodeUnknownEffect(actionHostBindingSchema);

export const mailEffectKindSchema = Schema.Literals([
  "chat_send",
  "local_draft",
  "mailbox_draft",
  "provider_sent",
]);
export type MailEffectKind = typeof mailEffectKindSchema.Type;

export const mailEffectSchema = Schema.Union([
  Schema.Struct({
    accountId: requiredId,
    draftId: requiredId,
    kind: Schema.Literal("mailbox_draft"),
  }),
  Schema.Struct({
    draftId: requiredId,
    kind: Schema.Literal("local_draft"),
  }),
  Schema.Struct({
    channel: Schema.Literals(["telegram", "web", "whatsapp"]),
    kind: Schema.Literal("chat_send"),
    messageId: requiredId,
  }),
  Schema.Struct({
    accountId: requiredId,
    kind: Schema.Literal("provider_sent"),
    messageId: requiredId,
    threadId: requiredId,
  }),
]);
export type MailEffect = typeof mailEffectSchema.Type;

export const mailReportedStatusSchema = Schema.Literals([
  "chat_sent",
  "draft",
  "sent",
]);
export type MailReportedStatus = typeof mailReportedStatusSchema.Type;

export const inboxProtectionSchema = Schema.Literals([
  "none",
  "preview",
  "safelist",
  "urgent",
]);
export type InboxProtection = typeof inboxProtectionSchema.Type;

export const inboxArchiveScopeSchema = Schema.Literals([
  "authorized_batch",
  "none",
]);
export type InboxArchiveScope = typeof inboxArchiveScopeSchema.Type;

export const inboxSendAutonomySchema = Schema.Literal("none");
export type InboxSendAutonomy = typeof inboxSendAutonomySchema.Type;

export const inboxPolicySchema = Schema.Struct({
  archiveScope: inboxArchiveScopeSchema,
  sendAutonomy: inboxSendAutonomySchema,
});
export type InboxPolicy = typeof inboxPolicySchema.Type;

export const inboxEventSchema = Schema.Literals([
  "host_authorize_batch",
  "silence",
  "unapproved_text",
]);
export type InboxEvent = typeof inboxEventSchema.Type;

export const inboxItemSchema = Schema.Struct({
  id: requiredId,
  protection: inboxProtectionSchema,
  userId: requiredId,
  workspaceId: requiredId,
});
export type InboxItem = typeof inboxItemSchema.Type;

export type RecipientResolution =
  | { readonly kind: "ambiguous" }
  | {
      readonly displayName: string;
      readonly handle: string;
      readonly kind: "participant";
    }
  | {
      readonly handle: string;
      readonly kind: "contact";
      readonly personId: string;
    }
  | { readonly kind: "unknown" };

export class MailRejected extends Schema.TaggedError<MailRejected>()(
  "MailRejected",
  {
    reason: Schema.Literals([
      "account_missing",
      "account_required",
      "account_unknown",
      "invalid_parameter",
      "invalid_scope",
    ]),
  }
) {}

interface StoredContact {
  readonly displayName: string;
  readonly handle: string;
  readonly id: string;
  readonly personId: string;
  readonly userId: string;
  readonly workspaceId: string;
}

interface StoredParticipant {
  readonly displayName: string;
  readonly handle: string;
  readonly userId: string;
  readonly workspaceId: string;
}

interface MailState {
  readonly contacts: Map<string, StoredContact>;
  readonly participants: Map<string, StoredParticipant>;
}

function reject(reason: MailRejected["reason"]) {
  return new MailRejected({ reason });
}

function scopeKey(scope: ActionHostBinding): string {
  return `${scope.workspaceId}\0${scope.userId}`;
}

function recordKey(scope: ActionHostBinding, id: string): string {
  return `${scopeKey(scope)}\0${id}`;
}

function normalizeHandle(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function looksLikeHandle(query: string): boolean {
  return query.includes("@");
}

const requireHost = Effect.fn("InMemoryMail.requireHost")(function* (
  scope: ActionHostBinding
) {
  return yield* decodeScope(scope).pipe(
    Effect.mapError(() => reject("invalid_scope"))
  );
});

export function mailOutcome(effect: MailEffect): MailReportedStatus {
  switch (effect.kind) {
    case "chat_send":
      return "chat_sent";
    case "local_draft":
    case "mailbox_draft":
      return "draft";
    case "provider_sent":
      return "sent";
    default: {
      const exhaustive: never = effect;
      return exhaustive;
    }
  }
}

export const selectConnectedAccount = Effect.fn("selectConnectedAccount")(
  function* (connectedAccountIds: readonly string[], requested: string) {
    const labels = connectedAccountIds
      .map((label) => label.trim())
      .filter((label) => label.length > 0);
    if (new Set(labels).size !== labels.length) {
      return yield* reject("invalid_parameter");
    }
    if (labels.length === 0) {
      return yield* reject("account_missing");
    }
    const explicit = requested.trim();
    if (explicit.length > 0) {
      if (!labels.includes(explicit)) {
        return yield* reject("account_unknown");
      }
      return explicit;
    }
    if (labels.length === 1) {
      const [only] = labels;
      if (only === undefined) {
        return yield* reject("account_missing");
      }
      return only;
    }
    return yield* reject("account_required");
  }
);

export function initialInboxPolicy(): InboxPolicy {
  return { archiveScope: "none", sendAutonomy: "none" };
}

export function applyInboxEvent(
  policy: InboxPolicy,
  event: InboxEvent
): InboxPolicy {
  switch (event) {
    case "host_authorize_batch":
      return { archiveScope: "authorized_batch", sendAutonomy: "none" };
    case "silence":
    case "unapproved_text":
      return policy;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

export const archiveInboxBatch = Effect.fn("archiveInboxBatch")(function* (
  scope: ActionHostBinding,
  items: readonly InboxItem[],
  authorizedIds: readonly string[]
) {
  const host = yield* requireHost(scope);
  if (
    authorizedIds.length === 0 ||
    authorizedIds.length > MAX_INBOX_ARCHIVE_BATCH
  ) {
    return yield* reject("invalid_parameter");
  }
  if (new Set(authorizedIds).size !== authorizedIds.length) {
    return yield* reject("invalid_parameter");
  }
  const authorized = new Set(authorizedIds);
  const archived: string[] = [];
  for (const item of items) {
    if (item.userId !== host.userId || item.workspaceId !== host.workspaceId) {
      continue;
    }
    if (!authorized.has(item.id)) {
      continue;
    }
    switch (item.protection) {
      case "none":
        archived.push(item.id);
        break;
      case "preview":
      case "safelist":
      case "urgent":
        break;
      default: {
        const exhaustive: never = item.protection;
        return exhaustive;
      }
    }
  }
  return archived;
});

const rememberContactImpl = Effect.fn("InMemoryMail.rememberContact")(
  function* (
    state: MailState,
    scope: ActionHostBinding,
    handle: string,
    displayName: string,
    personId: string
  ) {
    const host = yield* requireHost(scope);
    const normalizedHandle = normalizeHandle(handle);
    const name = displayName.trim();
    if (
      normalizedHandle.length === 0 ||
      name.length === 0 ||
      personId.trim() === ""
    ) {
      return yield* reject("invalid_parameter");
    }
    const recordedAt = yield* Clock.currentTimeMillis;
    const contact: StoredContact = {
      displayName: name,
      handle: normalizedHandle,
      id: generatePrefixedId("ctn", recordedAt),
      personId,
      userId: host.userId,
      workspaceId: host.workspaceId,
    };
    state.contacts.set(recordKey(host, contact.id), contact);
    return contact;
  }
);

const observeParticipantImpl = Effect.fn("InMemoryMail.observeParticipant")(
  function* (
    state: MailState,
    scope: ActionHostBinding,
    handle: string,
    displayName: string
  ) {
    const host = yield* requireHost(scope);
    const normalizedHandle = normalizeHandle(handle);
    const name = displayName.trim();
    if (normalizedHandle.length === 0 || name.length === 0) {
      return yield* reject("invalid_parameter");
    }
    const participant: StoredParticipant = {
      displayName: name,
      handle: normalizedHandle,
      userId: host.userId,
      workspaceId: host.workspaceId,
    };
    state.participants.set(
      `${recordKey(host, normalizedHandle)}\0${normalizeName(name)}`,
      participant
    );
    return participant;
  }
);

function hostContacts(
  state: MailState,
  host: ActionHostBinding
): readonly StoredContact[] {
  return [...state.contacts.values()].filter(
    (row) => row.userId === host.userId && row.workspaceId === host.workspaceId
  );
}

function hostParticipants(
  state: MailState,
  host: ActionHostBinding
): readonly StoredParticipant[] {
  return [...state.participants.values()].filter(
    (row) => row.userId === host.userId && row.workspaceId === host.workspaceId
  );
}

const resolveRecipientImpl = Effect.fn("InMemoryMail.resolveRecipient")(
  function* (state: MailState, scope: ActionHostBinding, query: string) {
    const host = yield* requireHost(scope);
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return yield* reject("invalid_parameter");
    }
    const contacts = hostContacts(state, host);
    const participants = hostParticipants(state, host);
    if (looksLikeHandle(trimmed)) {
      const handle = normalizeHandle(trimmed);
      const contact = contacts.find((row) => row.handle === handle);
      if (contact) {
        const resolved: RecipientResolution = {
          handle: contact.handle,
          kind: "contact",
          personId: contact.personId,
        };
        return resolved;
      }
      const participant = participants.find((row) => row.handle === handle);
      if (participant) {
        const resolved: RecipientResolution = {
          displayName: participant.displayName,
          handle: participant.handle,
          kind: "participant",
        };
        return resolved;
      }
      const unknown: RecipientResolution = { kind: "unknown" };
      return unknown;
    }
    const name = normalizeName(trimmed);
    const namedContacts = contacts.filter(
      (row) => normalizeName(row.displayName) === name
    );
    const namedParticipants = participants.filter(
      (row) => normalizeName(row.displayName) === name
    );
    if (namedContacts.length + namedParticipants.length > 1) {
      const ambiguous: RecipientResolution = { kind: "ambiguous" };
      return ambiguous;
    }
    const [onlyContact] = namedContacts;
    if (onlyContact) {
      const resolved: RecipientResolution = {
        handle: onlyContact.handle,
        kind: "contact",
        personId: onlyContact.personId,
      };
      return resolved;
    }
    const [onlyParticipant] = namedParticipants;
    if (onlyParticipant) {
      const resolved: RecipientResolution = {
        displayName: onlyParticipant.displayName,
        handle: onlyParticipant.handle,
        kind: "participant",
      };
      return resolved;
    }
    const unknown: RecipientResolution = { kind: "unknown" };
    return unknown;
  }
);

/**
 * Host-scoped mail contracts for the existing Google connector: contact vs
 * sender observation, draft vs sent, explicit account selection, and bounded
 * archive. This catalog does not fetch Gmail or write Mem0.
 */
export class InMemoryMail {
  readonly #state: MailState = {
    contacts: new Map(),
    participants: new Map(),
  };

  rememberContact(
    scope: ActionHostBinding,
    handle: string,
    displayName: string,
    personId: string
  ) {
    return rememberContactImpl(
      this.#state,
      scope,
      handle,
      displayName,
      personId
    );
  }

  observeParticipant(
    scope: ActionHostBinding,
    handle: string,
    displayName: string
  ) {
    return observeParticipantImpl(this.#state, scope, handle, displayName);
  }

  resolveRecipient(scope: ActionHostBinding, query: string) {
    return resolveRecipientImpl(this.#state, scope, query);
  }
}
