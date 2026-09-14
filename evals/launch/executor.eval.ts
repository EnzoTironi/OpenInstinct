import { defineEval } from "eve/evals";
import { equals, includes } from "eve/evals/expect";
import { Option, Schema } from "effect";
import { sendMessageOutputSchema } from "../../shared/chat/message-delivery";
import { executorAttemptFailures } from "../agent/executor";
import {
  ExecutorReceiptSchema,
  executorActionName,
} from "../../shared/chat/executor";

const fixtureSchema = Schema.Struct({
  variants: Schema.Array(
    Schema.Struct({
      language: Schema.String,
      canary: Schema.String,
      skill: Schema.String,
      source: Schema.String,
      destination: Schema.String,
    })
  ),
  privateCanary: Schema.String,
});
const fileSchema = Schema.Struct({
  revision: Schema.String,
  content: Schema.String,
});
const receiptSchema = Schema.Struct({
  calls: Schema.Array(ExecutorReceiptSchema),
});
const prompts = [
  (skill: string) =>
    `Follow the published ${skill} procedure in this workspace. Verify the saved result and tell me its exact release code and saved Git revision. Do not send external messages.`,
  (skill: string) =>
    `Siga a skill publicada ${skill} neste espaço. Confira o arquivo salvo e me diga o código exato da versão e a revisão salva no Git. Não envie mensagens externas.`,
  (skill: string) =>
    `Sigue el procedimiento publicado ${skill} en este espacio. Verifica el archivo guardado e indica su código exacto y la revisión guardada en Git. No envíes mensajes externos.`,
];

export default prompts.map((prompt, index) =>
  defineEval({
    description: `Discover a versioned skill, persist its result and verify it (variant ${String(index + 1)})`,
    tags: ["launch", "executor", "git", "live-model", "synthetic-data"],
    timeoutMs: 180_000,
    async test(t) {
      const metadata = await t.target.fetch("/_eval/fixture");
      const fixture = Schema.decodeUnknownSync(fixtureSchema)(
        await metadata.json()
      );
      const variant = fixture.variants[index];
      if (!variant) throw new Error("The isolated launch fixture is required.");
      const turn = await t.send(prompt(variant.skill));
      turn.succeeded();
      // Definitive preflight denials are safe to correct. An execution failure
      // with an uncertain write outcome remains a release-blocking error.
      const attempts = executorAttemptFailures(turn.toolCalls);
      t.check(attempts.native + attempts.code + attempts.host, equals(0))
        .soft()
        .label("scenario without failed tool attempts");
      turn
        .calledTool("execute", {
          status: "failed",
          input: { call: { path: "workspace-save" } },
          output: (output) =>
            !Schema.is(
              Schema.Struct({ code: Schema.Literal("TOOL_EXECUTION_DENIED") })
            )(output),
          count: 0,
        })
        .label("no uncertain write failure");
      turn.maxToolCalls(24);
      const saved = await t.target.fetch(
        `/_eval/file?path=${encodeURIComponent(variant.destination)}`
      );
      await t.require(saved.ok, equals(true));
      const file = Schema.decodeUnknownSync(fileSchema)(await saved.json());
      const delivered =
        turn.toolCalls
          .flatMap((call) => {
            if (call.name !== "send_message" || call.status !== "completed")
              return [];
            const message = Schema.decodeUnknownOption(sendMessageOutputSchema)(
              call.output
            );
            return Option.isSome(message) && message.value.kind === "message"
              ? [message.value.text]
              : [];
          })
          .join("\n") || turn.message;
      t.check(file.content, includes(variant.canary));
      t.check(delivered, includes(variant.canary));
      t.check(delivered, includes(file.revision));
      const calls = turn.toolCalls.flatMap((call) => {
        if (call.name !== "execute" || call.status !== "completed") return [];
        const receipt = Schema.decodeUnknownOption(receiptSchema)(call.output);
        return Option.isSome(receipt) ? receipt.value.calls : [];
      });
      t.check(
        calls.some(
          (call) => call.path === "search" && call.status === "completed"
        ),
        equals(true)
      ).label("catalog discovery");
      t.check(
        calls.some(
          (call) =>
            call.status === "completed" && call.resource?.path === variant.skill
        ),
        equals(true)
      ).label("versioned procedure loaded through Executor");
      t.check(
        turn.toolCalls.filter(
          (call) =>
            call.status === "completed" &&
            executorActionName(call.name, call.input) === "workspace-save"
        ).length,
        equals(1)
      ).label("one durable save");
      t.check(
        JSON.stringify(turn.events).includes(fixture.privateCanary),
        equals(false)
      ).label("personal data isolated");
    },
  })
);
