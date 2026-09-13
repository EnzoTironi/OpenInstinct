import { Effect } from "effect";
import { defineSchedule } from "eve/schedules";
import { serverRuntime } from "../../server/runtime";
import { drainMemoryErasures } from "../../server/memory/erasure";
import { Mem0 } from "../../server/memory/mem0";

export default defineSchedule({
  cron: "*/5 * * * *",
  run: async () => {
    await serverRuntime.runPromise(
      drainMemoryErasures().pipe(Effect.provide(Mem0.layer))
    );
  },
});
