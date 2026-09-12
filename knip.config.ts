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
        // Standalone real PostgreSQL check invoked by test:google-membership.
        "server/google-workspace/membership.integration.ts",
        // Standalone real account/channel controls check invoked by test:account-channels.
        "server/accounts/controls.integration.ts",
        // Live TG group mention e2e (manual /env.local); fixture harness is CI proof.
        "scripts/groups-live-e2e.ts",
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
      entry: ["alchemy.run.ts", "alchemy.fly-postgres.run.ts"],
      // POSIX shell builtin used to protect local Alchemy state.
      ignoreBinaries: ["umask"],
    },
  },
} satisfies KnipConfig;
