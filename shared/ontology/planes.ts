import { Schema } from "effect";

/**
 * Operational Ontology OS planes (Zoen constitution).
 * Worlds pack v0 declares hooks on all three; domain product packs may specialize later.
 * Not Foundry/Funnel/Zep — plane ids only.
 */
export const OntologyPlaneSchema = Schema.Literals([
  "language",
  "engine",
  "security",
]);
export type OntologyPlane = typeof OntologyPlaneSchema.Type;

export const ONTOLOGY_PLANES = [
  "language",
  "engine",
  "security",
] as const satisfies readonly OntologyPlane[];
