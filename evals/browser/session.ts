import type { EveEvalContext, EveEvalTurn } from "eve/evals";
import { z } from "zod";

export function requireStreamIndex(session: {
  readonly state?: { readonly streamIndex?: number };
}) {
  const streamIndex = session.state?.streamIndex;
  if (streamIndex === undefined) {
    throw new Error("Browser benchmark session has no stream index.");
  }
  return streamIndex;
}

const workerCalledSchema = z.object({
  data: z.object({
    childSessionId: z.string(),
    name: z.literal("browser-agent"),
  }),
  type: z.literal("subagent.called"),
});

export async function requireWorkerSessionId(
  context: EveEvalContext,
  turn: EveEvalTurn
) {
  for (const event of turn.events) {
    if (
      event.type === "subagent.called" &&
      event.data.name === "browser-agent"
    ) {
      return event.data.childSessionId;
    }
  }

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

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    for (;;) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- the child-session binding arrives on this ordered stream
      const chunk = await reader.read();
      pending += decoder.decode(chunk.value, { stream: !chunk.done });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          continue;
        }
        const parsed = workerCalledSchema.safeParse(value);
        if (parsed.success) return parsed.data.data.childSessionId;
      }
      if (chunk.done) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  throw new Error("Worker child session was not recorded.");
}
