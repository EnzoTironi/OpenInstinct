import type { KnipConfig } from "knip";

export default {
  ignoreIssues: {
    // Eve AI Elements and shadcn registry primitives intentionally expose
    // a reusable component surface wider than this minimal chat consumes.
    "web/components/ai-elements/**/*.tsx": ["exports", "files", "types"],
    "web/components/ui/**/*.tsx": ["exports", "files", "types"],
  },
  workspaces: {
    ".": {
      vitest: {
        config: ["vitest.config.ts", "vitest.runtime.config.ts"],
      },
      entry: [
        "agent/channels/**/*.ts",
        "agent/hooks/**/*.ts",
        "agent/instructions/**/*.ts",
        "agent/memory/**/*.ts",
        "agent/subagents/**/*.ts",
        "agent/schedules/**/*.ts",
        "agent/tools/**/*.ts",
        "db/drizzle.config.ts",
        // Drizzle consumes every table and relation exported by this schema barrel.
        "db/schema/index.ts",
        "evals/**/*.eval.ts",
        "evals/evals.config.ts",
        "taze.config.ts",
      ],
      ignoreDependencies: [
        // Type owners referenced by the Eve declaration patch, which Knip does not parse.
        "@linqapp/chat-sdk-adapter",
        "chat",
        // Imported through the owning Tailwind stylesheet rather than TypeScript.
        "shadcn",
        "tailwindcss",
        // Loaded as jsPlugins from .oxlintrc.jsonc rather than TypeScript.
        "eslint-plugin-react-hooks",
        "eslint-plugin-turbo",
        "oxlint-tailwindcss",
        // Invoked as a CLI.
        "vercel",
      ],
      project: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}", "!infrastructure/**"],
    },
    infrastructure: {
      entry: ["alchemy.run.ts"],
      // POSIX shell builtin used to protect local Alchemy state.
      ignoreBinaries: ["umask"],
    },
  },
} satisfies KnipConfig;
