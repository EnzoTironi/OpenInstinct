import { defineConfig } from "vitest/config";

import appConfig from "./vitest.config.ts";

// Report-only: same include/exclude as the NASA gate, without failing on <100%.
export default defineConfig({
  resolve: appConfig.resolve,
  test: {
    ...appConfig.test,
    coverage: {
      ...appConfig.test?.coverage,
      thresholds: undefined,
    },
  },
});
