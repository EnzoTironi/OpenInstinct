import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    ...(ultracite.ignorePatterns ?? []),
    "tools/oxlint/anti-slop/**",
  ],
  // Keep lockfile/scripts churn low; Ultracite defaults to true.
  sortPackageJson: false,
  sortTailwindcss: {
    functions: ["clsx", "cva", "tw", "twMerge", "cn", "twJoin", "tv"],
    stylesheet: "./app/globals.css",
  },
  overrides: [
    {
      files: ["*.jsonc"],
      options: { trailingComma: "none" },
    },
  ],
});
