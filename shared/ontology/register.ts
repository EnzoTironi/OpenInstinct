import { Effect, Layer } from "effect";
import {
  loadOntologyPack,
  OntologyPackInvalid,
  type LoadedOntologyPack,
} from "./load";
import { worldsPackV0Hooks, worldsPackV0Manifest } from "./pack-v0";

/**
 * In-process Worlds pack registration.
 * Intentionally does not touch messaging, channel ingress, Eve tools, or
 * private-chat defaults — Companion only learns that pack v0 is present.
 */
let registered: LoadedOntologyPack | null = null;

/** Test / ops helper: clear the in-process registry. */
export const resetOntologyPackRegistryForTests = (): void => {
  registered = null;
};

export const getRegisteredOntologyPack = (): LoadedOntologyPack | null =>
  registered;

/** Validate + register Worlds pack v0. Idempotent for the same id/version. */
export const registerWorldsPackV0: Effect.Effect<
  LoadedOntologyPack,
  OntologyPackInvalid
> = Effect.gen(function* () {
  if (
    registered &&
    registered.manifest.id === worldsPackV0Manifest.id &&
    registered.manifest.version === worldsPackV0Manifest.version
  ) {
    return registered;
  }
  const pack = yield* loadOntologyPack(worldsPackV0Manifest, worldsPackV0Hooks);
  registered = pack;
  return pack;
});

/**
 * Companion wiring layer: load pack v0 when the server runtime is constructed.
 * Invalid pack is a programmer error — fail closed at runtime boot.
 */
export const worldsPackRegistrationLayer: Layer.Layer<never> =
  Layer.effectDiscard(registerWorldsPackV0.pipe(Effect.orDie));
