import { sendMessageOutputSchema } from "@shared/chat/message-delivery";
import { Result, Schema } from "effect";
import type { EveEvalContext, EveEvalTurn } from "eve/evals";
import { equals, satisfies } from "eve/evals/expect";

export const agentEvalTags = ["agent", "behavior"] as const;

export async function requireDeliveredText(
  t: EveEvalContext,
  turn: EveEvalTurn
) {
  const delivery = turn.requireToolCall("send_message", {
    status: "completed",
  });

  const parsed = Schema.decodeUnknownResult(sendMessageOutputSchema)(
    delivery.input
  );

  const text =
    Result.isSuccess(parsed) && parsed.success.kind === "message"
      ? parsed.success.text
      : undefined;

  const parsedText = Schema.decodeUnknownResult(
    Schema.Trim.check(Schema.isMinLength(1))
  )(text);

  await t.require(Result.isSuccess(parsedText), equals(true));

  if (!Result.isSuccess(parsedText)) {
    throw new Error("send_message did not deliver non-empty text.");
  }

  return parsedText.success;
}

export function assertPlainTextDelivery(t: EveEvalContext, text: string) {
  t.check(
    text,
    satisfies<string>(
      (value) =>
        !/(?:^|\n)#{1,6}\s/u.test(value) &&
        !/(?:^|\n)\s*(?:[-*+] |\d+\. )/u.test(value) &&
        !/\*\*|```|\[[^\]]+\]\([^)]+\)/u.test(value),
      "delivery uses plain iMessage text instead of Markdown"
    )
  );
}
