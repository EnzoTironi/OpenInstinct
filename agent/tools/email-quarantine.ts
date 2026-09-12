import { approvalMessageSchema } from "@agent/lib/approval-message";
import { authorizeApprovalResponse } from "@agent/lib/approval-response";
import { readGmailMailbox } from "@agent/lib/google-workspace/gmail";
import { resolveModeValue } from "@agent/lib/mode";
import { Effect } from "effect";
import { defineState } from "eve/context";
import { defineDynamic, defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { connectCopy } from "../../server/operon/copy";
import {
  confirmEmail,
  EmailFlowError,
  searchEmail,
  syncEmail,
  viewedProposalMatches,
  type PendingEmailProposal,
} from "../../server/operon/email-flow";
import { parseMailbox } from "../../server/operon/mailbox";
import { operonClientLayer } from "../../server/operon/mcp-client";
import {
  assertOperonConfirm,
  readCompanionSessionToken,
} from "../../server/operon/principal";
import { serverRuntime } from "../../server/runtime";

const pendingEmail = defineState<PendingEmailProposal | null>(
  "zoen.email.pending-proposal",
  () => null
);

export const emailConnect = defineTool({
  description:
    "Explain how Zoen imports people from the connected Gmail account. Does not send email or change the calendar.",
  inputSchema: z.strictObject({}),
  execute() {
    return { message: connectCopy };
  },
});

export const emailSync = defineTool({
  description:
    "Read Gmail metadata from the last 30 days, or import an attached mailbox. Show the returned card and partial-import notice before offering to register people. Reading does not admit records or send messages.",
  inputSchema: z.discriminatedUnion("source", [
    z.strictObject({ source: z.literal("gmail") }),
    z.strictObject({
      source: z.literal("upload"),
      format: z.enum(["mbox", "eml"]),
      mailbox: z.string().min(1).max(1_000_000),
    }),
  ]),
  async execute(input, context) {
    const bound = await serverRuntime.runPromise(
      readCompanionSessionToken(context),
      { signal: context.abortSignal }
    );
    pendingEmail.update(() => null);
    const mailbox =
      input.source === "gmail"
        ? await readGmailMailbox(context)
        : { text: input.mailbox, format: input.format, partial: false };
    const snapshot = await serverRuntime.runPromise(
      parseMailbox(
        mailbox.format,
        mailbox.text,
        "ownerEmail" in mailbox ? mailbox.ownerEmail : undefined
      ),
      { signal: context.abortSignal }
    );
    const result = await serverRuntime.runPromise(
      syncEmail(snapshot).pipe(
        Effect.provide(
          operonClientLayer({
            scope: bound.scope,
            role: "consumer",
            sessionToken: bound.sessionToken,
          })
        )
      ),
      { signal: context.abortSignal }
    );
    pendingEmail.update(() => ({
      workspaceId: bound.scope.workspaceId,
      sessionId: context.session.id,
      proposalId: result.proposalId,
      digest: result.digest,
      card: result.card,
    }));
    return {
      ...result,
      partial: mailbox.partial,
      notice: mailbox.partial
        ? "Importei as primeiras 1.000 mensagens dos últimos 30 dias. Ainda há mensagens para importar."
        : null,
    };
  },
});

export const emailSearch = defineTool({
  description:
    "Search the user's people. Results distinguish unregistered email evidence from contacts actually admitted to Zoen.",
  inputSchema: z.strictObject({ name: z.string().min(1).max(200) }),
  execute(input, context) {
    return serverRuntime.runPromise(
      Effect.gen(function* () {
        const bound = yield* readCompanionSessionToken(context);
        return {
          hits: yield* searchEmail(input.name).pipe(
            Effect.provide(
              operonClientLayer({
                scope: bound.scope,
                role: "consumer",
                sessionToken: bound.sessionToken,
              })
            )
          ),
        };
      }),
      { signal: context.abortSignal }
    );
  },
});

export const emailRegister = defineTool({
  approval: { request: always(), response: authorizeApprovalResponse },
  description:
    "Copy card and viewedDigest from the last email-sync. The host shows that card; approvalMessage is not the confirm bind. Register only that conversation's pending proposal after the human confirms. An agent cannot supply a reviewer identity.",
  inputSchema: z.strictObject({
    approvalMessage: approvalMessageSchema,
    viewedDigest: z.string().length(64),
    card: z.string().min(1),
  }),
  async execute(input, context) {
    const pending = pendingEmail.get();
    if (
      !viewedProposalMatches(pending, {
        digest: input.viewedDigest,
        card: input.card,
      })
    )
      throw new EmailFlowError({ reason: "stale_digest" });
    const bound = await serverRuntime.runPromise(
      assertOperonConfirm(context, pending, input.viewedDigest),
      { signal: context.abortSignal }
    );
    return serverRuntime.runPromise(
      confirmEmail(pending, input.viewedDigest).pipe(
        Effect.provide(
          operonClientLayer({
            scope: bound.scope,
            role: "builder",
            sessionToken: bound.sessionToken,
            confirm: true,
          })
        )
      ),
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
