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
  HostScopedRecallCache,
  InMemoryActionLifecycle,
  InMemoryAuthority,
  InMemoryObjectStore,
  ObjectInstanceSchema,
  acceptActionInput,
  actionDefSchema,
  bindChatYes,
  claimSchema,
  corroboratingProviderIds,
  definitionArtifactSchema,
  defineObjectType,
  defineProperty,
  evaluateEvidence,
  evidenceObservationsFromRecall,
  j1DefinitionArtifact,
  objectTypeIdSchema,
  projectActionSurfaces,
  projectObjectSection,
  projectScopedSection,
  refuseIncomingRequestAutoAccept,
  selectHostScopedContext,
  selectRelevantContext,
} from "@zoen/operon";
export type {
  ActionDef,
  ActionHostBinding,
  Claim,
  DefinitionArtifact,
  ObjectSnapshot,
  SourceOccurrence,
} from "@zoen/operon";
