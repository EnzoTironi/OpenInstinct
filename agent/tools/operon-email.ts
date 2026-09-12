import { Effect } from "effect";
import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import { resolveModeValue } from "@agent/lib/mode";
import { EmailQcl } from "../../server/operon/qcl";
import { serverRuntime } from "../../server/runtime";

export const operonEmailQuarantine = defineTool({
  description:
    "Lê um arquivo mbox ou eml, coloca conversas em quarentena e classifica pessoas e organizações. Não manda e-mail. Não altera a agenda. Domínios de e-mail público nunca viram Organização. Gmail do gateway é só um adaptador nomeado, ainda não ligado.",
  inputSchema: z.object({
    format: z.enum(["mbox", "eml"]),
    text: z.string().min(1),
  }),
  execute(input, context) {
    return serverRuntime.runPromise(
      Effect.gen(function* () {
        const qcl = yield* EmailQcl;
        return yield* qcl.run({
          _tag: "MailboxUpload",
          bytes: new TextEncoder().encode(input.text),
          format: input.format,
        });
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
          "operon-email-quarantine": operonEmailQuarantine,
        },
      }),
  },
});
