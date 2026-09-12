import { Clock, Effect, Option, Schema } from "effect";

import {
  deriveEmailIdentityKeys,
  normalizeEmailAddress,
  type EmailAddress,
} from "./public-mail";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const Address = Schema.Struct({
  email: Schema.NonEmptyString,
  displayName: Schema.String,
});

const MailMessageSchema = Schema.Struct({
  from: Address,
  to: Schema.Array(Address),
  cc: Schema.Array(Address),
  threadId: Schema.NonEmptyString,
  dateMs: Schema.Number,
  messageId: Schema.NonEmptyString,
});

export type MailMessage = typeof MailMessageSchema.Type;

const MailboxSnapshotSchema = Schema.Struct({
  ownerEmail: Schema.optionalKey(Schema.String),
  messages: Schema.Array(MailMessageSchema),
});

export type MailboxSnapshot = typeof MailboxSnapshotSchema.Type;

export class MailboxError extends Schema.TaggedError<MailboxError>()(
  "MailboxError",
  {
    reason: Schema.Literals(["empty", "invalid"]),
  }
) {}

const headerLine =
  /^(From|To|Cc|Date|Message-ID|In-Reply-To|References):\s*(.*)$/iu;

export function parseMailbox(
  format: "mbox" | "eml",
  text: string,
  ownerEmail?: string
): Effect.Effect<MailboxSnapshot, MailboxError> {
  return Effect.gen(function* () {
    const raw = splitMessages(format, text);
    if (raw.length === 0) return yield* new MailboxError({ reason: "empty" });
    const messages = raw.flatMap((block) => parseOne(block));
    if (messages.length === 0)
      return yield* new MailboxError({ reason: "invalid" });
    const owner = ownerEmail ?? inferOwner(messages);
    return owner === undefined ? { messages } : { messages, ownerEmail: owner };
  });
}

export const recentMessages = Effect.fn("Mailbox.recentMessages")(function* (
  snapshot: MailboxSnapshot
) {
  const now = yield* Clock.currentTimeMillis;
  const start = now - THIRTY_DAYS_MS;
  return snapshot.messages.filter(
    (message) => message.dateMs >= start && message.dateMs <= now
  );
});

export function ingestItems(
  messages: readonly MailMessage[],
  ownerEmail?: string
) {
  return uniquePeople(messages, ownerEmail).map((person) => ({
    displayName: person.displayName,
    email: person.email,
    messages: messages
      .filter((message) =>
        participants(message, ownerEmail).some(
          (address) => address.email.toLowerCase() === person.email
        )
      )
      .map((message) => ({
        messageId: message.messageId,
        threadId: message.threadId,
        date: message.dateMs,
      })),
  }));
}

export function cardCounts(
  messages: readonly MailMessage[],
  ownerEmail?: string
) {
  const people = uniquePeople(messages, ownerEmail);
  return {
    companies: companyCount(people),
    conflicts: conflictCount(people),
    conversations: new Set(messages.map((message) => message.threadId)).size,
    people: people.length,
  };
}

function uniquePeople(
  messages: readonly MailMessage[],
  ownerEmail?: string
): readonly { displayName: string; email: EmailAddress }[] {
  const byEmail = new Map<
    string,
    { displayName: string; email: EmailAddress }
  >();
  for (const message of messages) {
    for (const address of participants(message, ownerEmail)) {
      addPerson(byEmail, address);
    }
  }
  return [...byEmail.values()];
}

function addPerson(
  byEmail: Map<string, { displayName: string; email: EmailAddress }>,
  address: { displayName: string; email: string }
) {
  const email = normalizeEmailAddress(address.email);
  if (Option.isNone(email)) return;
  if (byEmail.has(email.value)) return;
  byEmail.set(email.value, {
    displayName: address.displayName || email.value,
    email: email.value,
  });
}

function companyCount(people: readonly { email: EmailAddress }[]) {
  const domains = new Set<string>();
  for (const person of people) {
    const keys = deriveEmailIdentityKeys(person.email);
    if (Option.isNone(keys)) continue;
    if (keys.value.organization.status !== "derived") continue;
    domains.add(keys.value.organization.key.value);
  }
  return domains.size;
}

function conflictCount(
  people: readonly { displayName: string; email: EmailAddress }[]
) {
  const names = new Map<string, Set<string>>();
  for (const person of people) {
    const key = person.displayName.trim().toLowerCase();
    const emails = names.get(key) ?? new Set<string>();
    emails.add(person.email);
    names.set(key, emails);
  }
  return [...names.values()].filter((emails) => emails.size > 1).length;
}

function participants(message: MailMessage, ownerEmail?: string) {
  const owner = ownerEmail?.trim().toLowerCase();
  return [message.from, ...message.to, ...message.cc].filter((address) =>
    isCounterpart(address.email, owner)
  );
}

function isCounterpart(raw: string, owner: string | undefined) {
  const email = normalizeEmailAddress(raw);
  if (Option.isNone(email)) return false;
  return owner !== email.value;
}

function inferOwner(messages: readonly MailMessage[]) {
  const froms = new Set(messages.map((message) => message.from.email));
  return majority(
    messages.flatMap((message) =>
      message.to
        .map((address) => address.email)
        .filter((email) => !froms.has(email))
    )
  );
}

function majority(emails: readonly string[]) {
  if (emails.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const email of emails) {
    counts.set(email, (counts.get(email) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].toSorted(
    (left, right) => right[1] - left[1]
  );
  return ranked[0]?.[0];
}

function splitMessages(format: "mbox" | "eml", text: string) {
  if (format === "eml") return [text.trim()].filter(Boolean);
  return text
    .split(/^From .*\n/mu)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseOne(block: string): readonly MailMessage[] {
  const headers = headerMap(block);
  const from = parseAddress(headers.get("from") ?? "");
  if (!from) return [];
  const messageId = headers.get("message-id") ?? `<generated-${from.email}>`;
  return [
    {
      cc: parseAddressList(headers.get("cc") ?? ""),
      dateMs: Date.parse(headers.get("date") ?? "") || 0,
      from,
      messageId,
      threadId: threadIdOf(headers, messageId),
      to: parseAddressList(headers.get("to") ?? ""),
    },
  ];
}

function threadIdOf(headers: Map<string, string>, messageId: string) {
  return (
    lastReference(headers.get("references")) ??
    headers.get("in-reply-to") ??
    messageId
  );
}

function headerMap(block: string) {
  const folded = block.replaceAll(/\n[ \t]+/gu, " ");
  const [headerText] = folded.split(/\n\n/u);
  const headers = new Map<string, string>();
  for (const line of (headerText ?? "").split("\n")) {
    const match = headerLine.exec(line);
    if (!match?.[1] || match[2] === undefined) continue;
    headers.set(match[1].toLowerCase(), match[2].trim());
  }
  return headers;
}

function parseAddressList(value: string) {
  return value
    .split(",")
    .map((part) => parseAddress(part.trim()))
    .filter((address) => address !== undefined);
}

function parseAddress(value: string) {
  const angled = /^(.*?)<([^>]+)>\s*$/u.exec(value);
  const raw = angled?.[2] ?? value;
  const email = normalizeEmailAddress(raw);
  if (Option.isNone(email)) return undefined;
  return {
    displayName: (angled?.[1] ?? "").replaceAll(/["']/gu, "").trim(),
    email: email.value,
  };
}

function lastReference(references: string | undefined) {
  if (references === undefined) return undefined;
  const tokens = references.split(/\s+/u).filter(Boolean);
  return tokens.at(-1);
}
