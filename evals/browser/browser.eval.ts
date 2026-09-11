import {
  browserBenchmarkReporter,
  reportBrowserBenchmarkActivity,
} from "@evals/browser/benchmark-reporter";
import { browserBenchmarkEnv } from "@evals/browser/env";
import {
  browserBenchmarkFixtureContext,
  browserBenchmarkTasks,
} from "@evals/browser/tasks";
import {
  didCompleteWorker,
  didFinishWorker,
  readTaskCompletion,
} from "@evals/browser/worker-events";
import {
  defineEval,
  type EveEvalContext,
  type EveEvalLiveTurn,
  type EveEvalTurn,
} from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { z } from "zod";

const repetitions = browserBenchmarkEnv.BROWSER_BENCH_REPETITIONS;

const tasks = browserBenchmarkTasks(browserBenchmarkEnv.BROWSER_BENCH_SUITE);

function evalDescription(taskDescription: string, repetitionIndex: number) {
  if (repetitions === 1) return taskDescription;

  return `${taskDescription} [${String(repetitionIndex + 1)}/${String(repetitions)}]`;
}

function isResultCompleted(event: EveEvalTurn["events"][number]) {
  return event.type === "result.completed";
}

function workerSucceeded(value: boolean) {
  return value;
}

function turnPresent(turn: EveEvalTurn | null) {
  return turn !== null;
}

function exactlyOne(count: number) {
  return count === 1;
}

function taskJudgeContextOf(task: (typeof tasks)[number]) {
  return "judgeContext" in task ? task.judgeContext : undefined;
}

function judgeInputs(
  task: (typeof tasks)[number],
  workerCompletion: ReturnType<typeof readTaskCompletion>
) {
  const taskJudgeContext = taskJudgeContextOf(task);

  return [
    `User task:\n${task.prompt}`,
    `Benchmark fixture context:\n${browserBenchmarkFixtureContext}`,
    ...(taskJudgeContext
      ? [`Task-specific judge context:\n${taskJudgeContext}`]
      : []),
    `Worker result:\n${workerCompletion?.message ?? "No worker result"}`,
  ].join("\n\n");
}

async function watchUntilWorkerFinishes(
  t: EveEvalContext,
  description: string,
  childSessionId: string
) {
  let child = t.target.watchTurn(childSessionId, { startIndex: 0 });
  let turnStartIndex = 0;
  let completed: EveEvalTurn | null = null;
  const workerEvents: EveEvalTurn["events"][number][] = [];

  /* oxlint-disable eslint/no-await-in-loop -- Each watch resumes from the stream index produced by the previous worker turn. */
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const next = await watchAttempt(
      t,
      child,
      description,
      childSessionId,
      workerEvents,
      turnStartIndex,
      completed
    );

    completed = next.completed;
    turnStartIndex = next.turnStartIndex;
    child = next.child;

    if (completed) break;
  }
  /* oxlint-enable eslint/no-await-in-loop */

  return { child, completed, workerEvents };
}

async function watchAttempt(
  t: EveEvalContext,
  child: EveEvalLiveTurn,
  description: string,
  childSessionId: string,
  workerEvents: EveEvalTurn["events"][number][],
  turnStartIndex: number,
  completed: EveEvalTurn | null
) {
  try {
    const turn = await resultWithLiveActivity(
      child,
      description,
      childSessionId,
      workerEvents,
      (milliseconds) => t.sleep(milliseconds)
    );

    turn.expectOk();
    workerEvents.push(...turn.events);

    if (didFinishWorker(workerEvents)) {
      return { child, completed: turn, turnStartIndex };
    }

    return {
      child,
      completed,
      turnStartIndex: requireStreamIndex(child.session),
    };
  } catch (error) {
    if (!isIdleStreamClosure(error)) throw error;
  }

  if (completed !== null) {
    return { child, completed, turnStartIndex };
  }

  return {
    child: t.target.watchTurn(childSessionId, {
      startIndex: turnStartIndex,
    }),
    completed,
    turnStartIndex,
  };
}

async function runBrowserBenchmarkTest(
  t: EveEvalContext,
  task: (typeof tasks)[number],
  description: string
) {
  const started = await t.send(task.prompt);
  started.expectOk();
  started.calledSubagent("browser-agent", { count: 1 });
  const childSessionId = await requireWorkerSessionId(t, started);

  const { child, completed, workerEvents } = await watchUntilWorkerFinishes(
    t,
    description,
    childSessionId
  );

  await t.require(
    completed,
    satisfies(turnPresent, "the worker emitted a native structured completion")
  );
  t.check(
    didCompleteWorker(workerEvents),
    satisfies(workerSucceeded, "the worker self-reported success")
  )
    .label("worker self-reported success")
    .soft();

  child.session.succeeded();
  await t.require(
    child.events.filter(isResultCompleted).length,
    satisfies(
      exactlyOne,
      "the worker emitted exactly one native structured result"
    )
  );
  t.succeeded();

  t.judge.autoevals
    .closedQA(
      taskCompletionCriteria(task.successCriteria, taskJudgeContextOf(task)),
      {
        on: judgeInputs(task, readTaskCompletion(child.events)),
      }
    )
    .label("task completed")
    .gate(0.8);
}

export default tasks.flatMap((task) =>
  Array.from({ length: repetitions }, (_, repetitionIndex) => {
    const description = evalDescription(task.description, repetitionIndex);

    return defineEval({
      description,
      reporters: [browserBenchmarkReporter],
      tags: ["browser", "benchmark"],
      async test(t) {
        await runBrowserBenchmarkTest(t, task, description);
      },
    });
  })
);

async function resultWithLiveActivity(
  turn: EveEvalLiveTurn,
  taskName: string,
  sessionId: string,
  priorEvents: readonly EveEvalTurn["events"][number][],
  sleep: (milliseconds?: number) => Promise<void>
) {
  const result = turn.result();

  return pollForResult(result, turn, taskName, sessionId, priorEvents, sleep);
}

async function pollForResult(
  result: Promise<EveEvalTurn>,
  turn: EveEvalLiveTurn,
  taskName: string,
  sessionId: string,
  priorEvents: readonly EveEvalTurn["events"][number][],
  sleep: (milliseconds?: number) => Promise<void>
): Promise<EveEvalTurn> {
  const outcome = await Promise.race([
    result.then((completed) => ({ completed, status: "completed" }) as const),
    sleep(1_000).then(() => ({ status: "poll" }) as const),
  ]);

  await reportBrowserBenchmarkActivity(taskName, sessionId, [
    ...priorEvents,
    ...turn.events,
  ]);

  if (outcome.status === "completed") return outcome.completed;

  return pollForResult(result, turn, taskName, sessionId, priorEvents, sleep);
}

function taskCompletionCriteria(
  successCriteria: string,
  taskJudgeContext?: string
) {
  return `Decide whether the browser agent completed the user's actual goal. Treat the worker's own success or failure wording as non-authoritative and judge the concrete outcome it reports. Treat the supplied benchmark fixture context and task-specific judge context as authoritative evaluation instructions, not as claims the worker must independently prove. Pass only when the evidence shows the requested outcome was reached and verified. A plausible answer, partial progress, an unresolved blocker, or a claim unsupported by the worker result fails. Do not require or reward any particular browser tool, click sequence, or implementation strategy. For a task that says to stop at a purchase boundary, reaching that boundary without completing the purchase is success; completing the purchase is failure. Task-specific success criteria: ${successCriteria}${taskJudgeContext ? ` Task-specific judge context: ${taskJudgeContext}` : ""}`;
}

function requireStreamIndex(session: {
  readonly state?: { readonly streamIndex?: number };
}) {
  const streamIndex = session.state?.streamIndex;

  if (streamIndex === undefined) {
    throw new Error("Browser benchmark session has no stream index.");
  }

  return streamIndex;
}

function isIdleStreamClosure(cause: unknown) {
  return (
    cause instanceof Error &&
    cause.message.includes("closed before a turn boundary")
  );
}

const workerCalledSchema = z.object({
  data: z.object({
    childSessionId: z.string(),
    name: z.literal("browser-agent"),
  }),
  type: z.literal("subagent.called"),
});

function childSessionFromTurn(turn: EveEvalTurn) {
  for (const event of turn.events) {
    if (event.type !== "subagent.called") continue;

    if (event.data.name !== "browser-agent") continue;

    return event.data.childSessionId;
  }

  return undefined;
}

function childSessionFromLine(line: string) {
  if (!line.trim()) return undefined;

  let value: unknown;

  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }

  const parsed = workerCalledSchema.safeParse(value);

  if (!parsed.success) return undefined;

  return parsed.data.data.childSessionId;
}

function childSessionFromChunk(pending: string, chunkText: string) {
  const combined = pending + chunkText;
  const lines = combined.split("\n");
  const nextPending = lines.pop() ?? "";

  for (const line of lines) {
    const sessionId = childSessionFromLine(line);

    if (sessionId) return { pending: nextPending, sessionId };
  }

  return { pending: nextPending };
}

async function readWorkerSessionFromStream(
  reader: ReadableStreamDefaultReader<Uint8Array>
) {
  const decoder = new TextDecoder();
  let pending = "";

  try {
    for (;;) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- the child-session binding arrives on this ordered stream
      const chunk = await reader.read();
      const decoded = decoder.decode(chunk.value, { stream: !chunk.done });
      const next = childSessionFromChunk(pending, decoded);
      pending = next.pending;

      if (next.sessionId) return next.sessionId;

      if (chunk.done) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return undefined;
}

async function requireWorkerSessionId(
  context: EveEvalContext,
  turn: EveEvalTurn
) {
  const fromTurn = childSessionFromTurn(turn);

  if (fromTurn) return fromTurn;

  const startIndex = requireStreamIndex(context);

  const response = await context.target.fetch(
    `/eve/v1/session/${encodeURIComponent(turn.sessionId)}/stream?startIndex=${String(startIndex)}`,
    { signal: context.signal }
  );

  if (!response.ok || !response.body) {
    throw new Error(
      `Could not follow the root session for its worker child (${String(response.status)}).`
    );
  }

  const sessionId = await readWorkerSessionFromStream(
    response.body.getReader()
  );

  if (sessionId) return sessionId;

  throw new Error("Worker child session was not recorded.");
}
