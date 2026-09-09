import { Schema } from "effect";

export const scheduledConversationChannelSchema = Schema.Literals([
  "eve",
  "linq",
  "telegram",
  "kapso",
]);
