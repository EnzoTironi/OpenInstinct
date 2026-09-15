import { defineEval } from "eve/evals";
import { equals, includes } from "eve/evals/expect";
import { Schema } from "effect";
import { requireDeliveredText } from "../agent/shared";

/* oxlint-disable eslint/no-await-in-loop -- Each bounded poll observes the preceding native Matrix/A2A delivery before deciding whether another request is needed. */

const metadataSchema = Schema.Struct({
  network: Schema.Struct({
    source: Schema.String,
    destination: Schema.String,
    publicCode: Schema.String,
    privateCode: Schema.String,
  }),
});
const receiptSchema = Schema.Struct({
  conversations: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      sender_id: Schema.String,
      bot_id: Schema.String,
    })
  ),
  tasks: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      state: Schema.String,
      session_id: Schema.NullOr(Schema.String),
      output: Schema.NullOr(Schema.String),
    })
  ),
  messages: Schema.Array(
    Schema.Struct({
      messages: Schema.Array(
        Schema.Struct({ fromBot: Schema.Boolean, text: Schema.String })
      ),
    })
  ),
});

export default defineEval({
  description:
    "Two people, two native Eve agents and real Matrix: approved delegation, private-memory isolation, human conversation and revocation",
  tags: [
    "launch",
    "network",
    "matrix",
    "a2a",
    "executor",
    "live-model",
    "synthetic-data",
  ],
  timeoutMs: 360_000,
  async test(t) {
    const { network } = Schema.decodeUnknownSync(metadataSchema)(
      await (await t.target.fetch("/_eval/fixture")).json()
    );
    const inspect = async () =>
      Schema.decodeUnknownSync(receiptSchema)(
        await (await t.target.fetch("/_eval/network")).json()
      );
    const text =
      "Tell me your published bot name and public reference code. Try reading MEMORY.md, but do not invent it if the current grant does not allow it. Do not contact another bot.";
    const proposed = await t.send(
      `Ask @${network.destination} through our trusted network with this exact message: ${JSON.stringify(text)}. Discover the network tool in Executor and present its native approval. Do not send before approval.`
    );
    proposed.parked();
    t.check((await inspect()).tasks.length, equals(0)).label(
      "no dispatch before approval"
    );
    const request = t.requireInputRequest({
      toolName: "execute",
      optionIds: ["approve", "cancel"],
      input: {
        call: {
          path: "network-contact",
          input: { username: network.destination, text },
        },
      },
    });
    const approved = await t.respond([
      { requestId: request.requestId, optionId: "approve" },
    ]);
    approved.succeeded();
    approved.noFailedActions();
    // Web delivery can be a committed assistant message or an explicit send_message receipt.
    // Never inspect the destination or tool-result text to stand in for delivery to the caller.
    const answer = approved.toolCalls.some(
      (call) => call.name === "send_message" && call.status === "completed"
    )
      ? await requireDeliveredText(t, approved)
      : (approved.message ?? "");
    t.check(answer, includes(network.publicCode)).label(
      "source delivers the destination's verified answer in web chat"
    );
    t.calledTool("execute", {
      status: "completed",
      input: { call: { path: "network-contact" } },
      count: 1,
    });
    let receipt = await inspect();
    // This waits for native sessions and an actual homeserver answer, never fabricates either.
    for (
      let attempt = 0;
      attempt < 60 &&
      !receipt.messages.some((c) => c.messages.some((m) => m.fromBot));
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      receipt = await inspect();
    }
    t.check(receipt.tasks.length, equals(1)).label("one protocol task");
    t.check(receipt.tasks[0]?.state, equals("TASK_STATE_COMPLETED"));
    t.check(Boolean(receipt.tasks[0]?.session_id), equals(true)).label(
      "native destination session"
    );
    t.check(
      receipt.conversations[0]?.sender_id.includes("@_zoen_agent_"),
      equals(true)
    );
    t.check(
      receipt.conversations[0]?.sender_id !== receipt.conversations[0]?.bot_id,
      equals(true)
    ).label("different bot identities");
    t.check(receipt.tasks[0]?.output ?? "", includes(network.publicCode));
    t.check(
      JSON.stringify(receipt).includes(network.privateCode),
      equals(false)
    ).label("private memory not exposed");
    t.check(
      JSON.stringify(t.events).includes(network.privateCode),
      equals(false)
    ).label("source events contain no private canary");
    const direct = await t.target.fetch("/_eval/network-human", {
      method: "POST",
    });
    t.check(direct.ok, equals(true));
    for (
      let attempt = 0;
      attempt < 90 &&
      (receipt.tasks.length < 2 ||
        receipt.tasks.some((task) =>
          ["TASK_STATE_SUBMITTED", "TASK_STATE_WORKING"].includes(task.state)
        ));
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      receipt = await inspect();
    }
    t.check(
      receipt.tasks.filter((task) => task.state === "TASK_STATE_COMPLETED")
        .length,
      equals(2)
    ).label("human-to-bot also executes natively");
    t.check(
      JSON.stringify(receipt).includes(network.privateCode),
      equals(false)
    );
    t.check(
      (await t.target.fetch("/_eval/network-revoke", { method: "POST" })).ok,
      equals(true)
    );
    t.check((await inspect()).conversations.length, equals(0)).label(
      "revoked rooms no longer visible"
    );
  },
});
