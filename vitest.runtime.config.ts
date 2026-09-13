import { defineConfig } from "vitest/config";
import appConfig from "./vitest.config.ts";

export default defineConfig({
  resolve: appConfig.resolve,
  test: {
    include: ["tests/runtime/*.integration.ts"],
    // The retired bridge requires a separate Operon installation.
    exclude: ["tests/runtime/operon-bridge.integration.ts"],
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
