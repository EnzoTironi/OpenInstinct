import { Schema } from "effect";

export class ChannelAccountError extends Schema.TaggedError<ChannelAccountError>()(
  "ChannelAccountError",
  {
    reason: Schema.Literals([
      "invalid_input",
      "identity_inactive",
      "invalid_challenge",
      "account_conflict",
      "session_invalid",
      "last_access",
      "sender_unlinked",
      "archive_requires_review",
      "account_busy",
    ]),
  }
) {}
