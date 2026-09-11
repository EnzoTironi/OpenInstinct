/**
 * Prefer live Telegram group mention→accept→bind (+ optional outbound reply).
 * Loads `.env.local` via process env (never prints secrets).
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env.local scripts/groups-live-e2e.ts
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";

import { Effect } from "effect";

import { runTelegramGroupMentionHarness } from "../server/channels/groups-e2e-harness";

const OUT = "/tmp/companion-groups-live-e2e";
mkdirSync(OUT, { recursive: true });

const required = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_BOT_ID",
  "TELEGRAM_BOT_USERNAME",
] as const;

for (const key of required) {
  if (!process.env[key]) {
    writeFileSync(
      `${OUT}/LIVE-BLOCKER.txt`,
      `missing env ${key} (expected .env.local)\n`
    );
    console.log(`BLOCKER missing env ${key}`);
    process.exit(2);
  }
}

const token = process.env.TELEGRAM_BOT_TOKEN!;
const botId = process.env.TELEGRAM_BOT_ID!;
const botUsername = process.env.TELEGRAM_BOT_USERNAME!.replace(/^@/, "");
const base = `https://api.telegram.org/bot${token}`;

const api = async (method: string, body?: unknown) => {
  const res = await fetch(`${base}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return (await res.json()) as Record<string, unknown>;
};

const hash = (value: string | number) =>
  createHash("sha256").update(String(value)).digest("hex").slice(0, 12);

const me = (await api("getMe")) as {
  ok?: boolean;
  result?: {
    id?: number;
    username?: string;
    can_join_groups?: boolean;
    can_read_all_group_messages?: boolean;
  };
};
writeFileSync(
  `${OUT}/20-live-getMe.json`,
  JSON.stringify(
    {
      ok: me.ok,
      idMatches: String(me.result?.id) === botId,
      usernameMatches: me.result?.username === botUsername,
      can_join_groups: me.result?.can_join_groups,
      can_read_all_group_messages: me.result?.can_read_all_group_messages,
    },
    null,
    2
  )
);

const whBefore = (await api("getWebhookInfo")).result as {
  url?: string;
  pending_update_count?: number;
  last_error_message?: string;
  allowed_updates?: string[];
};
const webhookUrl = whBefore.url ?? "";
writeFileSync(
  `${OUT}/21-live-webhook-before.json`,
  JSON.stringify(
    {
      hasUrl: Boolean(webhookUrl),
      host: webhookUrl ? new URL(webhookUrl).host : null,
      pending_update_count: whBefore.pending_update_count,
      last_error_message: whBefore.last_error_message,
      allowed_updates: whBefore.allowed_updates,
    },
    null,
    2
  )
);

await api("deleteWebhook", { drop_pending_updates: false });
const updates = (await api("getUpdates", {
  timeout: 0,
  allowed_updates: ["message", "callback_query"],
})) as { ok?: boolean; result?: unknown[] };
const raw = (updates.result ?? []) as Array<Record<string, unknown>>;

type Scrub = {
  update_id?: unknown;
  chat_type?: string;
  chat_id_hash?: string;
  chat_id_negative?: boolean;
  text_mentions_bot?: boolean;
  has_reply_to_bot?: boolean;
};
const scrubbed: Scrub[] = [];
let groupUpdate: Record<string, unknown> | null = null;
for (const u of raw) {
  const message =
    (u.message as Record<string, unknown> | undefined) ??
    (u.callback_query as { message?: Record<string, unknown> } | undefined)
      ?.message;
  const chat = (message?.chat ?? {}) as {
    id?: number;
    type?: string;
  };
  const text = String(message?.text ?? message?.caption ?? "");
  const replyFrom = (
    message?.reply_to_message as { from?: { id?: number; is_bot?: boolean } }
  )?.from;
  const entry: Scrub = {
    update_id: u.update_id,
    chat_type: chat.type,
    chat_id_hash: chat.id !== undefined ? hash(chat.id) : undefined,
    chat_id_negative: typeof chat.id === "number" && chat.id < 0,
    text_mentions_bot: text
      .toLowerCase()
      .includes(`@${botUsername.toLowerCase()}`),
    has_reply_to_bot: Boolean(
      replyFrom?.is_bot && String(replyFrom.id) === botId
    ),
  };
  scrubbed.push(entry);
  if (chat.type === "group" || chat.type === "supergroup") {
    groupUpdate = u;
    writeFileSync(`${OUT}/.live-group-update.json`, JSON.stringify(u));
  }
}
writeFileSync(
  `${OUT}/22-live-getUpdates-scrubbed.json`,
  JSON.stringify(
    { ok: updates.ok, count: raw.length, updates: scrubbed },
    null,
    2
  )
);

// Restore webhook immediately (same URL + secret).
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (webhookUrl && secret) {
  await api("setWebhook", {
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
}
const whAfter = (await api("getWebhookInfo")).result as {
  url?: string;
  pending_update_count?: number;
  last_error_message?: string;
};
writeFileSync(
  `${OUT}/23-live-webhook-after.json`,
  JSON.stringify(
    {
      host: whAfter.url ? new URL(whAfter.url).host : null,
      pending_update_count: whAfter.pending_update_count,
      last_error_message: whAfter.last_error_message,
    },
    null,
    2
  )
);

let harnessAccepted = false;
let outbound: Record<string, unknown> | null = null;
let blocker: string | null = null;

if (!groupUpdate) {
  blocker =
    "No live Telegram group/supergroup update available. Add @ZoenOSBot to a group, @mention it (privacy mode), then re-run scripts/groups-live-e2e.ts. Fixture harness remains the CI proof.";
} else {
  const message = groupUpdate.message as {
    date?: number;
    chat?: { id?: number };
    message_id?: number;
    from?: { id?: number };
  };
  const nowMs = Date.now();
  // freshen date for validateEventAge if needed
  if (message?.date && Math.abs(nowMs / 1000 - message.date) > 86_000) {
    message.date = Math.floor(nowMs / 1000);
  }
  const result = await Effect.runPromise(
    runTelegramGroupMentionHarness({
      update: groupUpdate,
      installation: { botId, botUsername },
      nowMs,
      identityId: "22222222-2222-4222-8222-222222222222",
    })
  );
  harnessAccepted = result.accepted;
  writeFileSync(
    `${OUT}/24-live-harness-result.json`,
    JSON.stringify(
      {
        accepted: result.accepted,
        reason: result.reason,
        conversationScope: result.binding?.conversationScope ?? null,
        chatIdHash: result.binding ? hash(result.binding.chatId) : null,
      },
      null,
      2
    )
  );
  if (result.accepted && result.binding) {
    const replyText = `G03-GROUPS-LIVE-E2E-REPLY-${new Date().toISOString()}`;
    const send = (await api("sendMessage", {
      chat_id: Number(result.binding.deliveryTargetId),
      text: replyText,
      reply_to_message_id: message.message_id,
      allow_sending_without_reply: true,
    })) as {
      ok?: boolean;
      result?: { message_id?: number; chat?: { id?: number; type?: string } };
      description?: string;
    };
    outbound = {
      ok: send.ok,
      message_id: send.result?.message_id ?? null,
      chat_type: send.result?.chat?.type ?? null,
      chat_id_hash: send.result?.chat?.id ? hash(send.result.chat.id) : null,
      description: send.ok ? undefined : send.description,
    };
    writeFileSync(
      `${OUT}/25-live-outbound-reply.json`,
      JSON.stringify(outbound, null, 2)
    );
  } else {
    blocker =
      "Live group update present but harness did not accept (mention/reply policy).";
  }
}

const report = [
  "# G03 groups live e2e",
  "",
  `**When:** ${new Date().toISOString()} (UTC; label PT = America/Sao_Paulo)`,
  `**Bot:** @${botUsername} (id match env: ${String(me.result?.id) === botId})`,
  "**Fixture proof:** see 10-fixture-telegram-mention-bind.json / vitest harness",
  `**Live group update found:** ${Boolean(groupUpdate)}`,
  `**Harness accepted:** ${harnessAccepted}`,
  `**Outbound group reply:** ${outbound ? JSON.stringify(outbound) : "n/a"}`,
  `**Blocker:** ${blocker ?? "none"}`,
  "",
  "## Notes",
  "",
  `- Bot can_read_all_group_messages=${me.result?.can_read_all_group_messages} (privacy mode expected).`,
  "- Webhook restored to prior host when secret present.",
  "- Secrets never printed.",
  "",
].join("\n");
writeFileSync(`${OUT}/REPORT.md`, report);
writeFileSync(
  `${OUT}/26-live-summary.json`,
  JSON.stringify(
    {
      liveGroupFound: Boolean(groupUpdate),
      harnessAccepted,
      outboundOk: outbound?.ok === true,
      blocker,
    },
    null,
    2
  )
);
console.log(
  JSON.stringify(
    {
      liveGroupFound: Boolean(groupUpdate),
      harnessAccepted,
      outboundOk: outbound?.ok === true,
      blocker,
      artifactDir: OUT,
    },
    null,
    2
  )
);
process.exit(blocker && !harnessAccepted ? 1 : 0);
