import type { OntologyPackManifest } from "./manifest";
import { noopOntologyPackHooks, type OntologyPackHooks } from "./hooks";

/**
 * Worlds pack v0 — first ontology pack under Operational Ontology OS.
 * Declares Language / Engine / Security plane coverage and MCP/receipts/erasure
 * hook slots. Does not ship Foundry, Funnel, Zep, or domain product nouns.
 */
export const WORLDS_PACK_V0_ID = "worlds" as const;
export const WORLDS_PACK_V0_VERSION = "0" as const;

export const worldsPackV0Manifest = {
  hooks: {
    erasure: true,
    mcp: true,
    receipts: true,
  },
  id: WORLDS_PACK_V0_ID,
  nouns: [
    {
      description:
        "Tenancy cell for semantic state; pack skeleton only — no engine day-1.",
      id: "world",
      kind: "noun",
      label: "World",
      plane: "language",
    },
  ],
  planes: {
    engine: true,
    language: true,
    security: true,
  },
  title: "Worlds",
  verbs: [
    {
      description:
        "Read-only inspect placeholder; Companion private chat ignores it in v0.",
      id: "inspect",
      kind: "verb",
      label: "Inspect",
      nounIds: ["world"],
      plane: "language",
    },
  ],
  version: WORLDS_PACK_V0_VERSION,
} as const satisfies OntologyPackManifest;

export const worldsPackV0Hooks: OntologyPackHooks = noopOntologyPackHooks();
