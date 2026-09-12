import { approvalMessageSchema } from "@agent/lib/approval-message";
import { authorizeApprovalResponse } from "@agent/lib/approval-response";
import { resolveModeValue } from "@agent/lib/mode";
import { Effect } from "effect";
import { defineDynamic, defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";

import { EmailFlow } from "../../server/operon/email-flow";
import { OperonBuilderStdio } from "../../server/operon/mcp-client";
import {
  encodeSessionToken,
  PrincipalIssuer,
} from "../../server/operon/principal";
import { MailboxUpload } from "../../server/operon/source-connection";
import { serverRuntime } from "../../server/runtime";

function consumerToken(sessionId: string, principalId: string) {
  const userId = principalId.startsWith("better-auth:")
    ? principalId.slice("better-auth:".length)
    : principalId;
  return encodeSessionToken({
    audience: "companion",
    grants: ["consumer"],
    orgId: "companion-cell",
    sessionId,
    userId,
  });
}

export const emailConnect = defineTool({
  description:
    "Explain that Companion will read the mailbox to show who the user talks to. Does not send email or change the calendar.",
  inputSchema: z.strictObject({}),
  execute(_input, context) {
    return serverRuntime.runPromise(
      Effect.gen(function* () {
        const flow = yield* EmailFlow;
        return { message: yield* flow.connect() };
      }),
      { signal: context.abortSignal }
    );
  },
});

export const emailSync = defineTool({
  description:
    "Read the attached mailbox and show the quarantine card plus the single register offer. Does not send email or change the calendar.",
  inputSchema: z.strictObject({
    format: z.enum(["mbox", "eml"]),
    mailbox: z.string().min(1).max(1_000_000),
  }),
  execute(input, context) {
    return serverRuntime.runPromise(
      Effect.gen(function* () {
        const flow = yield* EmailFlow;
        yield* flow.attach(
          MailboxUpload.make({
            bytes: new Uint8Array(Buffer.from(input.mailbox)),
            format: input.format,
          })
        );
        return yield* flow.sync().pipe(Effect.provide(OperonBuilderStdio));
      }),
      { signal: context.abortSignal }
    );
  },
});

export const emailSearch = defineTool({
  description:
    "Search people who arrived from email. Hits are not admitted address-book names.",
  inputSchema: z.strictObject({
    name: z.string().min(1).max(200),
  }),
  execute(input, context) {
    return serverRuntime.runPromise(
      Effect.gen(function* () {
        const flow = yield* EmailFlow;
        return { hits: yield* flow.search(input.name) };
      }),
      { signal: context.abortSignal }
    );
  },
});

export const emailRegister = defineTool({
  approval: { request: always(), response: authorizeApprovalResponse },
  description:
    "Register the people from the last 30 days after the user confirms the exact digest already shown.",
  inputSchema: z.strictObject({
    approvalMessage: approvalMessageSchema,
    viewedDigest: z.string().length(64),
  }),
  execute(input, context) {
    return serverRuntime.runPromise(
      Effect.gen(function* () {
        const flow = yield* EmailFlow;
        const issuer = yield* PrincipalIssuer;
        const principal = yield* issuer.fromSessionToken(
          consumerToken(
            context.session.id,
            context.session.auth.current?.principalId ?? "anonymous"
          )
        );
        return yield* flow
          .confirm(principal, input.viewedDigest)
          .pipe(Effect.provide(OperonBuilderStdio));
      }),
      { signal: context.abortSignal }
    );
  },
});

export default defineDynamic({
  events: {
    "turn.started": (_event, context) =>
      resolveModeValue(context, {
        interactive: {
          "email-connect": emailConnect,
          "email-register": emailRegister,
          "email-search": emailSearch,
          "email-sync": emailSync,
        },
      }),
  },
});
