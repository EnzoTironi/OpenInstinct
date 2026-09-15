/**
 * Host compile surface for `@zoen/operon`.
 *
 * Import types and the in-memory store from here in application code that is
 * not the Effect runtime. `server/runtime.ts` must not provide this package
 * until Mem0 is removed in the same change.
 */
export {
  ConcurrentModificationError,
  InMemoryObjectStore,
  ObjectInstanceSchema,
  actionDefSchema,
  claimSchema,
  definitionArtifactSchema,
  defineObjectType,
  defineProperty,
  objectTypeIdSchema,
} from "@zoen/operon";
export type { ActionDef, Claim, DefinitionArtifact } from "@zoen/operon";
