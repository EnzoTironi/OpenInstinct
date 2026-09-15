/**
 * Host compile surface for `@zoen/operon`.
 *
 * Import types and the in-memory store from here in application code that is
 * not the Effect runtime. `server/runtime.ts` must not provide this package
 * until Mem0 is removed in the same change.
 */
export {
  ConcurrentModificationError,
  InMemoryAuthority,
  InMemoryObjectStore,
  ObjectInstanceSchema,
  acceptActionInput,
  actionDefSchema,
  claimSchema,
  definitionArtifactSchema,
  defineObjectType,
  defineProperty,
  j1DefinitionArtifact,
  objectTypeIdSchema,
  projectActionSurfaces,
  projectScopedSection,
} from "@zoen/operon";
export type {
  ActionDef,
  ActionHostBinding,
  Claim,
  DefinitionArtifact,
  ObjectSnapshot,
  SourceOccurrence,
} from "@zoen/operon";
