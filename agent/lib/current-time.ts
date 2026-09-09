import { defineInstructions } from "eve/instructions";

export function currentTimeInstructions(now: Date = new Date()) {
  return defineInstructions({
    role: "system",
    content: `Current server time at the start of this turn: ${now.toISOString()} (UTC).
Use this fresh timestamp as the reference for now, today, relative dates and future availability. Older timestamps in conversation history, memory, or web results are not the current time. Do not use web_search or web_fetch to obtain the clock.
Convert this instant to the user's known IANA timezone before interpreting local dates or presenting local times; UTC does not establish the user's timezone. If the timezone is unknown and affects the answer, clarify it.
For a request for the next free slot, query availability from this turn's current instant or later and never offer a slot that starts before it as a future slot. A free/busy result establishes availability, not the current time.`,
  });
}
