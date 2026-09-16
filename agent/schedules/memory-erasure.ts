import { defineSchedule } from "eve/schedules";
import { serverRuntime } from "../../server/runtime";
import { drainMemoryErasures } from "../../server/memory/erasure";

export default defineSchedule({
  cron: "*/5 * * * *",
  run: async () => {
    await serverRuntime.runPromise(drainMemoryErasures());
  },
});
