import { Effect, Schema } from "effect";

/**
 * Extension hooks kept on every ontology pack so Companion can grow MCP,
 * receipts, and erasure without inventing a second authority surface.
 * v0 implementations are intentional no-ops — they must not alter private chat.
 */

export const PackHookKindSchema = Schema.Literals([
  "mcp",
  "receipts",
  "erasure",
]);
export type PackHookKind = typeof PackHookKindSchema.Type;

export interface OntologyPackHooks {
  readonly erasure: {
    /** Reserved for C02 / World erasure policy; no-op in pack v0. */
    readonly onErasureRequest: () => Effect.Effect<void>;
  };
  readonly mcp: {
    /** Reserved for scoped MCP tool discovery; empty in pack v0. */
    readonly listToolDescriptors: () => Effect.Effect<readonly never[]>;
  };
  readonly receipts: {
    /** Reserved for ontology-scoped receipt projection; no-op in pack v0. */
    readonly onReceipt: () => Effect.Effect<void>;
  };
}

export const noopOntologyPackHooks = (): OntologyPackHooks => ({
  erasure: {
    onErasureRequest: () => Effect.void,
  },
  mcp: {
    listToolDescriptors: () => Effect.succeed([]),
  },
  receipts: {
    onReceipt: () => Effect.void,
  },
});

/** Stable hook kind list for manifests / ADR inventory. */
export const PACK_HOOK_KINDS = [
  "mcp",
  "receipts",
  "erasure",
] as const satisfies readonly PackHookKind[];
