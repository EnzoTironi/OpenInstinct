import { Schema } from "effect";

const chatReturnPathSchema = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isPattern(/^\/chat\/(?!history$)[A-Za-z0-9_-]{1,256}$/u)
);

/** Connection callbacks return only to a concrete chat, never another origin. */
export function googleWorkspaceReturnTo(
  value: string | readonly string[] | undefined
) {
  return Schema.is(chatReturnPathSchema)(value) ? value : "/";
}

export const googleWorkspaceScopes = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/contacts.readonly",
] as const;
