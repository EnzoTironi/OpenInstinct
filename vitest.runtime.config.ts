import { defineConfig } from "vitest/config";

import appConfig from "./vitest.config.ts";

export default defineConfig({
  resolve: appConfig.resolve,
  test: {
    include: ["tests/runtime/*.integration.ts"],
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
