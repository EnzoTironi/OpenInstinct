import { defineEvalConfig } from "eve/evals";
import { launchReporter } from "./launch/reporter";

export default defineEvalConfig({
  judge: { model: "openai/gpt-5.4-mini" },
  reporters: [launchReporter],
  maxConcurrency: 4,
  timeoutMs: 180_000,
});
