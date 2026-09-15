/**
 * Host compile surface for `@zoen/operon`.
 *
 * Import types and the in-memory store from here in application code that is
 * not the Effect runtime. `server/runtime.ts` must not provide this package
 * until Mem0 is removed in the same change.
 */
export {
  ActionLifecycleRejected,
  ConcurrentModificationError,
  InMemoryActionLifecycle,
  InMemoryAuthority,
  InMemoryObjectStore,
  ObjectInstanceSchema,
  acceptActionInput,
  actionDefSchema,
  bindChatYes,
  claimSchema,
  definitionArtifactSchema,
  defineObjectType,
  defineProperty,
  evaluateEvidence,
  j1DefinitionArtifact,
  objectTypeIdSchema,
  projectActionSurfaces,
  projectScopedSection,
  refuseIncomingRequestAutoAccept,
} from "@zoen/operon";
export type {
  ActionDef,
  ActionHostBinding,
  Claim,
  DefinitionArtifact,
  ObjectSnapshot,
  SourceOccurrence,
} from "@zoen/operon";
