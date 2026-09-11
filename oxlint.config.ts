import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import { jsPluginSettings, selectJsPlugins } from "ultracite/oxlint/js-plugins";
import next from "ultracite/oxlint/next";
import nextJsPlugins from "ultracite/oxlint/next/js-plugins";
import react from "ultracite/oxlint/react";

/** React Doctor only — do not enable Ultracite github/sonarjs JS plugins. */
const reactDoctorJsPlugins = selectJsPlugins(["react-doctor"]);

/**
 * Ultracite Oxlint presets (core/react/next) plus repository-owned JS plugins.
 * Vendored `tools/oxlint/anti-slop` (generic + Effect) is the anti-slop source
 * of truth — do not also extend `ultracite/oxlint/anti-slop`.
 *
 * React Doctor is enabled via Ultracite `selectJsPlugins(["react-doctor"])` and
 * `ultracite/oxlint/next/js-plugins` (github/sonarjs intentionally omitted).
 * Root `settings` must include `jsPluginSettings` so curated ported-rule mode
 * skips Next route-segment export false positives.
 *
 * The Ultracite `vitest` preset is intentionally not extended: its pedantic
 * suite (max-expects, prefer-strict-equal, require-top-level-describe, …)
 * fights this repo's existing suites. High-signal vitest rules are enabled
 * locally below. Style-heavy Ultracite core rules that collide with Effect/TS
 * conventions are opted out (Ultracite's documented opt-out model).
 */
export default defineConfig({
  extends: [core, react, next, reactDoctorJsPlugins, nextJsPlugins],
  plugins: [
    "eslint",
    "typescript",
    "unicorn",
    "oxc",
    "import",
    "jsdoc",
    "node",
    "promise",
    "react",
    "react-perf",
    "jsx-a11y",
    "nextjs",
    "vitest",
  ],
  options: {
    denyWarnings: true,
    typeAware: true,
    reportUnusedDisableDirectives: "error",
  },
  categories: {
    correctness: "error",
    suspicious: "error",
    perf: "error",
  },
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    "tools/oxlint/anti-slop/**",
    // Manual live TG Bot API probe; fixture harness is the CI proof.
    "scripts/groups-live-e2e.ts",
  ],
  jsPlugins: [
    "./tools/oxlint/architecture/index.ts",
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    {
      name: "anti-slop-effect",
      specifier: "./tools/oxlint/anti-slop/effect/index.ts",
    },
    "./tools/oxlint/next/index.ts",
    "eslint-plugin-turbo",
    {
      name: "hooks",
      specifier: "eslint-plugin-react-hooks",
    },
    "oxlint-tailwindcss",
    // Cognitive complexity gate (user limit 6). Built-in `complexity` is cyclomatic-only.
    "oxlint-plugin-complexity",
    // Declared on the root for Knip/analyzers (Ultracite #784); also loaded via
    // `reactDoctorJsPlugins` / `nextJsPlugins` extends.
    ...(reactDoctorJsPlugins.jsPlugins ?? []),
  ],
  settings: {
    ...jsPluginSettings,
    tailwindcss: {
      entryPoint: "app/globals.css",
    },
  },
  rules: {
    // ── Ultracite style opt-outs (keep correctness; avoid mass renames) ─
    "func-style": "off",
    "func-names": "off",
    "sort-keys": "off",
    "no-use-before-define": "off",
    "promise/avoid-new": "off",
    "react/function-component-definition": "off",
    "react/todo": "off",
    "react/hook-use-state": "off",
    "react/jsx-handler-names": "off",
    "react/no-react-children": "off",
    "react/button-has-type": "off",
    "unicorn/filename-case": "off",
    curly: "off",
    "arrow-body-style": "off",
    "one-var": "off",
    "no-plusplus": "off",
    "no-negated-condition": "off",
    "unicorn/no-negated-condition": "off",
    "unicorn/switch-case-braces": "off",
    "unicorn/numeric-separators-style": "off",
    "unicorn/text-encoding-identifier-case": "off",
    "unicorn/no-useless-undefined": "off",
    "unicorn/prefer-ternary": "off",
    "unicorn/prefer-string-replace-all": "off",
    "unicorn/catch-error-name": "off",
    "unicorn/import-style": "off",
    "unicorn/no-array-reduce": "off",
    "unicorn/throw-new-error": "off",
    "unicorn/no-await-expression-member": "off",
    "unicorn/no-array-method-this-argument": "off",
    "unicorn/no-useless-promise-resolve-reject": "off",
    "unicorn/prefer-spread": "off",
    "unicorn/prefer-code-point": "off",
    "unicorn/relative-url-style": "off",
    "unicorn/prefer-number-coercion": "off",
    "unicorn/consistent-assert": "off",
    "unicorn/custom-error-definition": "off",
    "unicorn/consistent-existence-index-check": "off",
    "unicorn/no-hex-escape": "off",
    "unicorn/no-object-as-default-parameter": "off",
    "unicorn/prefer-single-call": "off",
    "unicorn/no-unreadable-array-destructuring": "off",
    "unicorn/prefer-native-coercion-functions": "off",
    "unicorn/no-lonely-if": "off",
    "unicorn/no-document-cookie": "off",
    "unicorn/escape-case": "off",
    "unicorn/prefer-response-static-json": "off",
    "unicorn/prefer-export-from": "off",
    "prefer-destructuring": "off",
    "prefer-named-capture-group": "off",
    "prefer-template": "off",
    "prefer-object-spread": "off",
    "require-unicode-regexp": "off",
    // Built-in cyclomatic `complexity` stays off — oxlint-plugin-complexity
    // owns both cyclomatic (20) and cognitive (6) below.
    complexity: "off",
    // Cognitive complexity — user-facing limit is 6 (agent-doctor stays at default 15).
    "complexity/complexity": [
      "error",
      {
        cyclomatic: 20,
        cognitive: 6,
        // Default minLines (10): skip tiny getters/one-liners; still enforce ≤6 on
        // substantial functions (≥10 lines). Matches Ultracite plugin docs pattern.
      },
    ],
    "max-classes-per-file": "off",
    "default-case": "off",
    "no-nested-ternary": "off",
    "no-promise-executor-return": "off",
    "no-void": "off",
    "no-inline-comments": "off",
    "no-loop-func": "off",
    "no-script-url": "off",
    eqeqeq: "off",
    "no-eq-null": "off",
    "class-methods-use-this": "off",
    "no-shadow": "off",
    "no-useless-return": "off",
    "no-empty-function": "off",
    "no-duplicate-imports": "off",
    "import/first": "off",
    "import/consistent-type-specifier-style": "off",
    "import/no-duplicates": "off",
    "import/newline-after-import": "off",
    "promise/prefer-await-to-then": "off",
    "promise/prefer-await-to-callbacks": "off",
    "promise/param-names": "off",
    "promise/no-return-wrap": "off",
    "oxc/no-barrel-file": "off",
    "typescript/strict-boolean-expressions": "off",
    "typescript/strict-void-return": "off",
    "typescript/switch-exhaustiveness-check": "off",
    "typescript/method-signature-style": "off",
    "typescript/parameter-properties": "off",
    "typescript/promise-function-async": "off",
    "require-await": "off",
    "typescript/return-await": ["error", "error-handling-correctness-only"],

    // ── Local architecture / Next route ownership ─────────────────────
    "local-architecture/no-forbidden-layer-imports": "error",
    "local-next/no-route-private-imports": "error",
    "local-next/prefer-nearest-route-private-owner": "error",
    "local-next/require-generated-route-props": "error",
    "local-next/require-page-route-group": "error",

    // ── Vendored anti-slop (generic) ──────────────────────────────────
    "oxc/no-accumulating-spread": "error",
    "anti-slop/no-array-filter-map": "error",
    "anti-slop/no-reduce-accumulator-copy": "error",
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-runtime-typeof": ["error", { allowInTypeGuards: true }],
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-readable-spacing": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error",
    "typescript/consistent-indexed-object-style": "off",
    "unicorn/no-immediate-mutation": "off",
    "unicorn/prefer-reflect-apply": "off",

    // ── Vendored anti-slop Effect ─────────────────────────────────────
    "anti-slop-effect/no-manual-effect-error-tag": "error",
    "anti-slop-effect/no-manual-tag-comparison": "error",
    "anti-slop-effect/no-manual-tagged-construction": "error",
    "anti-slop-effect/no-service-constructor-imports": "error",
    "anti-slop-effect/prefer-effect-match": "error",

    // ── eslint-plugin-react-hooks (Compiler-aware) ────────────────────
    "hooks/config": "error",
    "hooks/error-boundaries": "error",
    "hooks/gating": "error",
    "hooks/globals": "error",
    "hooks/immutability": "error",
    "hooks/incompatible-library": "warn",
    "hooks/preserve-manual-memoization": "error",
    "hooks/purity": "error",
    "hooks/refs": "error",
    "hooks/set-state-in-effect": "error",
    "hooks/set-state-in-render": "error",
    "hooks/static-components": "error",
    "hooks/unsupported-syntax": "warn",
    "hooks/use-memo": "error",

    // ── React Doctor opt-outs (Ultracite selectJsPlugins preset) ───────
    // Keep Next/React anti-patterns; drop rules that conflict with this repo's
    // Compiler-aware hooks plugin, shadcn/cva export style, or intentional I/O.
    "react-doctor/react-compiler-no-manual-memoization": "off", // conflicts with hooks/preserve-manual-memoization
    "react-doctor/only-export-components": "off", // shadcn/cva + helper co-exports are intentional
    "react-doctor/no-giant-component": "off",
    "react-doctor/prefer-useReducer": "off",
    "react-doctor/js-combine-iterations": "off",
    "react-doctor/js-flatmap-filter": "off",
    "react-doctor/js-cache-property-access": "off",
    "react-doctor/js-set-map-lookups": "off",
    "react-doctor/async-await-in-loop": "off", // sequential autofill/channel I/O is intentional
    "react-doctor/server-hoist-static-io": "off", // eval dashboards re-read inputs by design

    // ── Env boundary ──────────────────────────────────────────────────
    "no-restricted-properties": [
      "error",
      {
        object: "process",
        property: "env",
        message:
          "Read environment variables through an env.ts or env/ module validated with @t3-oss/env-nextjs for Next.js or @t3-oss/env-core for other runtimes.",
      },
    ],
    "import/no-unassigned-import": [
      "error",
      {
        allow: ["**/*.css"],
      },
    ],

    // ── Tailwind ──────────────────────────────────────────────────────
    "tailwindcss/enforce-consistent-important-position": "warn",
    "tailwindcss/enforce-negative-arbitrary-values": "warn",
    "tailwindcss/enforce-shorthand": "warn",
    "tailwindcss/no-conflicting-classes": "error",
    "tailwindcss/no-contradicting-variants": "off",
    "tailwindcss/no-deprecated-classes": "warn",
    "tailwindcss/no-duplicate-classes": "error",
    "tailwindcss/no-unknown-classes": [
      "warn",
      {
        ignorePrefixes: ["type-"],
      },
    ],
    "tailwindcss/no-unnecessary-arbitrary-value": "warn",
    "turbo/no-undeclared-env-vars": "warn",

    "unicorn/no-instanceof-builtins": [
      "error",
      {
        exclude: ["Function"],
      },
    ],
  },
  overrides: [
    {
      files: ["tests/runtime/**/*.ts"],
      rules: {
        "typescript/consistent-return": "off", // Effect.gen fixture guards use `return yield* Effect.fail`
      },
    },

    {
      files: [
        "**/env.{js,cjs,mjs,ts,cts,mts}",
        "**/env/**/*.{js,cjs,mjs,ts,cts,mts}",
      ],
      rules: {
        "no-restricted-properties": "off",
      },
    },
    {
      files: [
        "**/*.{test,spec,test-d,spec-d}.{ts,tsx,js,jsx,mts,cts}",
        "**/__tests__/**/*.{ts,tsx,js,jsx}",
        "**/tests/**/*.{ts,tsx,mts,cts}",
      ],
      rules: {
        "anti-slop/no-module-mocking": "off",
        "anti-slop-effect/no-service-constructor-imports": "off",
        "vitest/consistent-test-filename": [
          "error",
          {
            allTestPattern:
              ".*\\.(?:test|spec)\\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$",
            pattern: ".*\\.test\\.(?:ts|tsx|mts|cts)$",
          },
        ],
        "vitest/no-disabled-tests": "warn",
        "vitest/no-identical-title": "error",
        "vitest/no-import-node-test": "error",
        "vitest/no-interpolation-in-snapshots": "error",
        "vitest/no-mocks-import": "error",
        "vitest/no-unneeded-async-expect-function": "error",
        "vitest/prefer-called-exactly-once-with": "error",
      },
    },
    {
      files: ["web/components/ui/**/*.tsx"],
      rules: {
        "tailwindcss/no-unknown-classes": "off",
      },
    },
    {
      files: [
        "web/components/ui/**/*.{ts,tsx}",
        "web/components/ai-elements/**/*.{ts,tsx}",
      ],
      rules: {
        // Registry / Eve AI Elements surfaces — not app-owned React.
        "react-doctor/no-adjust-state-on-prop-change": "off",
        "react-doctor/no-chain-state-updates": "off",
        "react-doctor/no-usememo-simple-expression": "off",
        "react-doctor/nextjs-no-img-element": "off",
        "react-doctor/rerender-state-only-in-handlers": "off",
      },
    },
    {
      files: ["evals/**/*.{ts,tsx}"],
      rules: {
        "react-doctor/server-sequential-independent-await": "off",
        "react-doctor/js-hoist-intl": "off",
      },
    },
    {
      files: [
        "web/components/ai-elements/message.tsx",
        "web/components/ai-elements/reasoning.tsx",
        "web/components/ai-elements/tool.tsx",
      ],
      rules: {
        "tailwindcss/no-unknown-classes": "off",
      },
    },
  ],
});
