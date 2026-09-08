import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/channel-auth/*.integration.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
