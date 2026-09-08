import type { ConnectTokenParams, ConnectTokenSubject } from "@vercel/connect";
import { Schema } from "effect";

const chatReturnPathSchema = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isPattern(/^\/chat\/(?!history$)[A-Za-z0-9_-]{1,256}$/u)
);

/** Connection callbacks return only to a concrete chat, never another origin. */
export function googleWorkspaceReturnTo(value: string | undefined) {
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

export function googleWorkspaceSubject(userId: string): ConnectTokenSubject {
  return { id: userId, issuer: "openinstinct", type: "user" };
}

export function googleWorkspaceTokenParams(userId: string): ConnectTokenParams {
  return {
    scopes: [...googleWorkspaceScopes],
    subject: googleWorkspaceSubject(userId),
  };
}
