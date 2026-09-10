import { Effect, Schema } from "effect";
import {
  OntologyPackManifestSchema,
  type OntologyPackManifest,
} from "./manifest";
import type { OntologyPackHooks } from "./hooks";
import { PACK_HOOK_KINDS } from "./hooks";
import { ONTOLOGY_PLANES } from "./planes";

export class OntologyPackInvalid extends Schema.TaggedError<OntologyPackInvalid>()(
  "OntologyPackInvalid",
  {
    message: Schema.String,
    packId: Schema.optionalKey(Schema.String),
    reason: Schema.Literals([
      "schema",
      "missing_plane",
      "missing_hook",
      "duplicate_noun",
      "duplicate_verb",
      "unknown_noun_ref",
    ]),
  }
) {}

export interface LoadedOntologyPack {
  readonly hooks: OntologyPackHooks;
  readonly manifest: OntologyPackManifest;
}

const uniqueIds = (ids: readonly string[]): boolean =>
  new Set(ids).size === ids.length;

/**
 * Validate pack manifest invariants (Effect-safe, no I/O).
 * Worlds and future packs share this gate before Companion registration.
 */
export const validateOntologyPack = (
  manifest: unknown
): Effect.Effect<OntologyPackManifest, OntologyPackInvalid> =>
  Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(
      OntologyPackManifestSchema
    )(manifest).pipe(
      Effect.mapError(
        (error) =>
          new OntologyPackInvalid({
            message: `Ontology pack schema failed: ${String(error)}`,
            reason: "schema",
          })
      )
    );

    for (const plane of ONTOLOGY_PLANES) {
      if (!decoded.planes[plane]) {
        return yield* Effect.fail(
          new OntologyPackInvalid({
            message: `Pack must declare the ${plane} plane.`,
            packId: decoded.id,
            reason: "missing_plane",
          })
        );
      }
    }

    for (const hook of PACK_HOOK_KINDS) {
      if (!decoded.hooks[hook]) {
        return yield* Effect.fail(
          new OntologyPackInvalid({
            message: `Pack must keep the ${hook} extension hook.`,
            packId: decoded.id,
            reason: "missing_hook",
          })
        );
      }
    }

    const nounIds = decoded.nouns.map((noun) => noun.id);
    if (!uniqueIds(nounIds)) {
      return yield* Effect.fail(
        new OntologyPackInvalid({
          message: "Duplicate noun ids in pack.",
          packId: decoded.id,
          reason: "duplicate_noun",
        })
      );
    }

    const verbIds = decoded.verbs.map((verb) => verb.id);
    if (!uniqueIds(verbIds)) {
      return yield* Effect.fail(
        new OntologyPackInvalid({
          message: "Duplicate verb ids in pack.",
          packId: decoded.id,
          reason: "duplicate_verb",
        })
      );
    }

    const nounSet = new Set(nounIds);
    for (const verb of decoded.verbs) {
      for (const nounId of verb.nounIds ?? []) {
        if (!nounSet.has(nounId)) {
          return yield* Effect.fail(
            new OntologyPackInvalid({
              message: `Verb ${verb.id} references unknown noun ${nounId}.`,
              packId: decoded.id,
              reason: "unknown_noun_ref",
            })
          );
        }
      }
    }

    return decoded;
  });

export const loadOntologyPack = (
  manifest: unknown,
  hooks: OntologyPackHooks
): Effect.Effect<LoadedOntologyPack, OntologyPackInvalid> =>
  Effect.gen(function* () {
    const validated = yield* validateOntologyPack(manifest);
    return { hooks, manifest: validated };
  });
