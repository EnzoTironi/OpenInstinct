import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/runtime/*.integration.ts"],
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
