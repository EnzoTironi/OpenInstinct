import { defineSchedule } from "eve/schedules";
import { serverRuntime } from "../../server/runtime";
import { pruneTelemetry } from "../../server/observability/events";

export default defineSchedule({
  cron: "17 * * * *",
  run: () => serverRuntime.runPromise(pruneTelemetry()),
});
