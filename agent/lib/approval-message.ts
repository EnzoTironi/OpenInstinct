import { z } from "zod";

export const approvalMessageSchema = z
  .string()
  .min(1)
  .max(16_384)
  .refine(
    (message) => message.trim().length > 0 && message.isWellFormed(),
    "Write a complete, non-empty proposal."
  )
  .describe(
    "Write the proposal directly to the user in their language and the conversation's tone. Explain the exact action being proposed, including consequential recipients, dates, timezone and content. For an outgoing email, show its full subject and body. Ask for their decision naturally. The channel delivers this message when approval is pending: do not separately send the same proposal or claim the action already happened. Do not use commands, request codes or tool JSON. Never omit material details to fit the limit; use a smaller action if the complete proposal cannot fit."
  );
