import { defineConfig } from "vitest/config";
import runtimeConfig from "./vitest.runtime.config.ts";

export default defineConfig({
  ...runtimeConfig,
  test: {
    ...runtimeConfig.test,
    include: ["tests/runtime/operon-bridge.integration.ts"],
    exclude: [],
  },
});
