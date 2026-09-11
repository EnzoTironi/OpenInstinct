import { createHash } from "node:crypto";

import { gmail, type gmail_v1 } from "@googleapis/gmail";
import type { ToolContext } from "eve/tools";
import { z } from "zod";

import { googleApiErrorStatus, withGoogleAuth } from "./client";

type GmailMessage = gmail_v1.Schema$Message;

type GmailPart = gmail_v1.Schema$MessagePart;

export const GMAIL_UPDATE_ACTIONS = [
  "archive",
  "move_to_inbox",
  "mark_read",
  "mark_unread",
  "star",
  "unstar",
] as const;

export type GmailUpdateAction = (typeof GMAIL_UPDATE_ACTIONS)[number];

export const gmailSendSchema = z.object({
  bcc: z.array(z.email()).max(20).default([]),
  body: z.string().min(1).max(100_000),
  cc: z.array(z.email()).max(20).default([]),
  inReplyTo: z.string().max(998).optional(),
  subject: z.string().min(1).max(998),
  threadId: z.string().max(200).optional(),
  to: z.array(z.email()).min(1).max(20),
});

export async function searchGmail(
  ctx: ToolContext,
  query: string,
  maxResults: number
) {
  return withGmail(ctx, async (client) => {
    const listed = await client.users.messages.list(
      { maxResults, q: query, userId: "me" },
      { signal: ctx.abortSignal }
    );

    const messages = await Promise.all(
      (listed.data.messages ?? []).flatMap(({ id }) =>
        id
          ? [
              client.users.messages.get(
                {
                  format: "metadata",
                  id,
                  metadataHeaders: [
                    "From",
                    "To",
                    "Subject",
                    "Date",
                    "Message-ID",
                  ],
                  userId: "me",
                },
                { signal: ctx.abortSignal }
              ),
            ]
          : []
      )
    );

    return messages.map(({ data }) => minimizeMessage(data));
  });
}

export async function readGmailThread(ctx: ToolContext, threadId: string) {
  return withGmail(ctx, async (client) => {
    const { data: thread } = await client.users.threads.get(
      { format: "full", id: threadId, userId: "me" },
      { signal: ctx.abortSignal }
    );

    return {
      id: thread.id ?? threadId,
      messages: (thread.messages ?? []).slice(-20).map((message) =>
        Object.assign({}, minimizeMessage(message), {
          attachments: collectAttachments(message.payload),
          body: redactGoogleText(plainText(message.payload)),
        })
      ),
    };
  });
}

export async function updateGmail(
  ctx: ToolContext,
  messageIds: string[],
  action: GmailUpdateAction
) {
  const ids = [...new Set(messageIds)];
  await withGmail(ctx, async (client) =>
    client.users.messages.batchModify(
      {
        requestBody: { ids, ...gmailUpdateLabels(action) },
        userId: "me",
      },
      { signal: ctx.abortSignal }
    )
  );

  return { action, updatedCount: ids.length };
}

/**
 * Stable send idempotency key for one Eve tool call (session + callId).
 * Live Gmail `users.messages.send` rewrites RFC822 Message-ID, so reconciliation
 * uses this searchable custom header value instead of rfc822msgid.
 */
export function gmailSendIdempotencyKey(ctx: {
  callId: string;
  session: { id: string };
}) {
  const stableId = createHash("sha256")
    .update(`${ctx.session.id}:${ctx.callId}`)
    .digest("hex")
    .slice(0, 40);

  return `openinstinct-send-${stableId}`;
}

/** Quoted Gmail search for the exact idempotency key token. */
export function gmailSendIdempotencyQuery(key: string) {
  return `"${key}"`;
}

/** Correlation Message-ID (Gmail rewrites on send; not used for reconcile). */
export function gmailSendMessageId(ctx: {
  callId: string;
  session: { id: string };
}) {
  return `<${gmailSendIdempotencyKey(ctx)}@local>`;
}

/** rfc822msgid query helper (insufficient alone on live Gmail send). */
export function gmailSendMessageIdQuery(messageId: string) {
  const bare = messageId.replace(/^<|>$/gu, "");

  return `rfc822msgid:${bare}`;
}

/**
 * Send with outbox-style idempotency. Live Gmail replaces client Message-ID on
 * send, so we stamp `X-OpenInstinct-Idempotency-Key` (preserved + indexed) and
 * reconcile via quoted key search before send and after uncertain failures.
 */
export async function sendGmail(
  ctx: ToolContext,
  payload: z.infer<typeof gmailSendSchema>
) {
  const idempotencyKey = gmailSendIdempotencyKey(ctx);
  const messageId = gmailSendMessageId(ctx);

  const headers = [
    `To: ${payload.to.map(safeHeader).join(", ")}`,
    ...(payload.cc.length
      ? [`Cc: ${payload.cc.map(safeHeader).join(", ")}`]
      : []),
    ...(payload.bcc.length
      ? [`Bcc: ${payload.bcc.map(safeHeader).join(", ")}`]
      : []),
    `Subject: ${safeHeader(payload.subject)}`,
    `Message-ID: ${messageId}`,
    `X-OpenInstinct-Idempotency-Key: ${idempotencyKey}`,
    ...(payload.inReplyTo
      ? [
          `In-Reply-To: ${safeHeader(payload.inReplyTo)}`,
          `References: ${safeHeader(payload.inReplyTo)}`,
        ]
      : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ];

  const raw = Buffer.from(
    `${headers.join("\r\n")}\r\n\r\n${payload.body}`,
    "utf8"
  ).toString("base64url");

  return withGmail(ctx, (client) =>
    sendGmailIdempotent(
      client,
      {
        raw,
        threadId: payload.threadId,
      },
      idempotencyKey,
      ctx.abortSignal
    )
  );
}

async function sendGmailIdempotent(
  client: ReturnType<typeof gmail>,
  requestBody: { raw: string; threadId?: string },
  idempotencyKey: string,
  signal: AbortSignal
) {
  const existing = await findSentGmailByIdempotencyKey(
    client,
    idempotencyKey,
    signal
  );

  if (existing) return existing;

  return sendOrRecoverGmailMessage(
    client,
    requestBody.threadId
      ? { raw: requestBody.raw, threadId: requestBody.threadId }
      : { raw: requestBody.raw },
    idempotencyKey,
    signal
  );
}

function isUncertainGmailSendError(error: unknown): error is object {
  const status = googleApiErrorStatus(error);

  return status === undefined || status >= 500 || status === 429;
}

async function sendOrRecoverGmailMessage(
  client: ReturnType<typeof gmail>,
  requestBody: { raw: string; threadId?: string },
  idempotencyKey: string,
  signal: AbortSignal
) {
  try {
    const { data } = await client.users.messages.send(
      {
        requestBody,
        userId: "me",
      },
      { signal }
    );

    return data;
  } catch (error) {
    // Uncertain outcomes (timeout / transport / 5xx) must not blind-resend.
    // Client 4xx failures other than rate limits stay fail-closed unless the
    // idempotency key already landed (provider accepted before the error surfaced).
    if (!isUncertainGmailSendError(error)) throw error;

    const recovered = await findSentGmailByIdempotencyKey(
      client,
      idempotencyKey,
      signal
    );

    if (recovered) return recovered;
    throw error;
  }
}

async function findSentGmailByIdempotencyKey(
  client: ReturnType<typeof gmail>,
  idempotencyKey: string,
  signal: AbortSignal
) {
  const listed = await client.users.messages.list(
    {
      maxResults: 1,
      q: gmailSendIdempotencyQuery(idempotencyKey),
      userId: "me",
    },
    { signal }
  );

  const id = listed.data.messages?.[0]?.id;

  if (!id) return null;

  const { data } = await client.users.messages.get(
    {
      format: "minimal",
      id,
      userId: "me",
    },
    { signal }
  );

  return data;
}

export function gmailUpdateLabels(action: GmailUpdateAction) {
  switch (action) {
    case "archive":
      return { addLabelIds: [], removeLabelIds: ["INBOX"] };
    case "move_to_inbox":
      return { addLabelIds: ["INBOX"], removeLabelIds: [] };
    case "mark_read":
      return { addLabelIds: [], removeLabelIds: ["UNREAD"] };
    case "mark_unread":
      return { addLabelIds: ["UNREAD"], removeLabelIds: [] };
    case "star":
      return { addLabelIds: ["STARRED"], removeLabelIds: [] };
    case "unstar":
      return { addLabelIds: [], removeLabelIds: ["STARRED"] };
  }

  throw new Error("Unsupported Gmail update action.");
}

function header(part: GmailPart | undefined, name: string) {
  return (
    part?.headers?.find(
      (item) => item.name?.toLowerCase() === name.toLowerCase()
    )?.value ?? null
  );
}

function directPlainText(part: GmailPart) {
  if (part.mimeType === "text/plain" && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }

  return undefined;
}

function htmlAsPlainText(part: GmailPart) {
  if (part.mimeType === "text/html" && part.body?.data) {
    return decodeBase64Url(part.body.data)
      .replace(/<[^>]+>/gu, " ")
      .replace(/\s+/gu, " ");
  }

  return undefined;
}

function firstChildPlainText(part: GmailPart) {
  for (const child of part.parts ?? []) {
    const text = plainText(child);

    if (text) return text;
  }

  return undefined;
}

function plainText(part: GmailPart | undefined): string {
  if (!part) return "";

  return (
    directPlainText(part) ??
    firstChildPlainText(part) ??
    htmlAsPlainText(part) ??
    ""
  );
}

function minimizeMessage(message: GmailMessage) {
  return {
    date: header(message.payload, "Date"),
    from: header(message.payload, "From"),
    id: message.id ?? null,
    labels: message.labelIds ?? [],
    messageId: header(message.payload, "Message-ID"),
    snippet: redactGoogleText(message.snippet ?? "", 500),
    subject: header(message.payload, "Subject"),
    threadId: message.threadId ?? null,
    to: header(message.payload, "To"),
  };
}

function collectAttachments(part: GmailPart | undefined): {
  attachmentId: string;
  filename: string;
  size: number;
}[] {
  if (!part) return [];

  const own =
    part.filename && part.body?.attachmentId
      ? [
          {
            attachmentId: part.body.attachmentId,
            filename: part.filename,
            size: part.body.size ?? 0,
          },
        ]
      : [];

  const nested = (part.parts ?? []).flatMap((child) => {
    return collectAttachments(child);
  });

  return [...own, ...nested];
}

function safeHeader(value: string) {
  return value.replace(/[\r\n]+/gu, " ").trim();
}

function withGmail<T>(
  ctx: ToolContext,
  execute: (client: ReturnType<typeof gmail>) => Promise<T>
) {
  return withGoogleAuth(ctx, (auth) => execute(gmail({ auth, version: "v1" })));
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

const secretPatterns: readonly (readonly [RegExp, string])[] = [
  [/\b\d{6}\b/gu, "[six-digit code redacted]"],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/gu, "[api key redacted]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu, "[github token redacted]"],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu, "[aws key redacted]"],
  [/\bAIza[A-Za-z0-9_-]{30,}\b/gu, "[google api key redacted]"],
  [/\b(?:bearer\s+)[A-Za-z0-9._~+/-]+=*\b/giu, "Bearer [token redacted]"],
  [
    /\b(password|passcode|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
    "$1=[credential redacted]",
  ],
  [/\b(?:\d[ -]*?){13,19}\b/gu, "[payment number redacted]"],
];

function redactGoogleText(value: string, maxLength = 12_000) {
  let redacted = value.slice(0, maxLength);

  for (const [pattern, replacement] of secretPatterns) {
    redacted = redacted.replace(pattern, replacement);
  }

  return redacted;
}
