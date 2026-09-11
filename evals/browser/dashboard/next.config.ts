import { resolve } from "node:path";

import type { NextConfig } from "next";

export default {
  agentRules: false,
  devIndicators: false,
  turbopack: { root: resolve(import.meta.dirname, "../../..") },
} satisfies NextConfig;
