import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "server-only",
        replacement: fileURLToPath(
          new URL("tests/helpers/server-only.ts", import.meta.url)
        ),
      },
      {
        find: /^@db$/u,
        replacement: fileURLToPath(new URL("db/index.ts", import.meta.url)),
      },
      {
        find: /^@shared\/environment$/u,
        replacement: fileURLToPath(
          new URL("shared/environment/env.ts", import.meta.url)
        ),
      },
      ...["agent", "app", "db", "evals", "shared", "tests", "tools", "web"].map(
        (owner) => ({
          find: new RegExp(`^@${owner}/(.*)$`, "u"),
          replacement: fileURLToPath(new URL(`${owner}/$1`, import.meta.url)),
        })
      ),
    ],
  },
  test: {
    // Keep simultaneous PGlite initialization bounded while CI runs TS7 and lint.
    maxWorkers: 2,
    setupFiles: ["./tests/setup-env.ts"],
    // Upstream anti-slop RuleTester suites are not Vitest; exclude so test:app stays green.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
      "tools/oxlint/anti-slop/**",
    ],
  },
});
