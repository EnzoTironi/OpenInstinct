import { Effect, ManagedRuntime, Schema } from "effect";
import { describe, expect, it, beforeEach } from "vitest";
import {
  loadOntologyPack,
  OntologyPackInvalid,
  validateOntologyPack,
} from "./load";
import {
  noopOntologyPackHooks,
  PackHookKindSchema,
  PACK_HOOK_KINDS,
} from "./hooks";
import { OntologyPackIdSchema } from "./manifest";
import {
  NounDefinitionSchema,
  OntologyDefinitionSchema,
  PackPlanesSchema,
  VerbDefinitionSchema,
  type NounDefinition,
  type OntologyDefinition,
  type PackPlanes,
  type VerbDefinition,
} from "./types";
import { OntologyPlaneSchema, type OntologyPlane } from "./planes";
import type { OntologyPackId } from "./manifest";
import {
  WORLDS_PACK_V0_ID,
  WORLDS_PACK_V0_VERSION,
  worldsPackV0Hooks,
  worldsPackV0Manifest,
} from "./pack-v0";
import {
  getRegisteredOntologyPack,
  registerWorldsPackV0,
  resetOntologyPackRegistryForTests,
  worldsPackRegistrationLayer,
} from "./register";

describe("W01 Worlds pack v0", () => {
  beforeEach(() => {
    resetOntologyPackRegistryForTests();
  });

  it("exposes Effect schemas for planes, nouns, verbs, and pack ids", () => {
    const noun = worldsPackV0Manifest.nouns[0]!;
    const verb = worldsPackV0Manifest.verbs[0]!;
    expect(Schema.is(OntologyPlaneSchema)("language")).toBe(true);
    expect(Schema.is(NounDefinitionSchema)(noun)).toBe(true);
    expect(Schema.is(VerbDefinitionSchema)(verb)).toBe(true);
    expect(Schema.is(OntologyDefinitionSchema)(noun)).toBe(true);
    expect(Schema.is(PackPlanesSchema)(worldsPackV0Manifest.planes)).toBe(true);
    expect(Schema.is(OntologyPackIdSchema)(WORLDS_PACK_V0_ID)).toBe(true);
    expect(Schema.is(PackHookKindSchema)("mcp")).toBe(true);
    expect(PACK_HOOK_KINDS).toEqual(["mcp", "receipts", "erasure"]);

    const plane: OntologyPlane = "security";
    const packId: OntologyPackId = WORLDS_PACK_V0_ID;
    const nounType: NounDefinition = noun;
    const verbType: VerbDefinition = verb;
    const def: OntologyDefinition = verb;
    const planes: PackPlanes = worldsPackV0Manifest.planes;
    expect(plane).toBe("security");
    expect(packId).toBe(WORLDS_PACK_V0_ID);
    expect(nounType.id).toBe("world");
    expect(verbType.id).toBe("inspect");
    expect(def.kind).toBe("verb");
    expect(planes.language).toBe(true);
  });

  it("validates the Worlds pack manifest (planes + hooks + nouns/verbs)", async () => {
    const manifest = await Effect.runPromise(
      validateOntologyPack(worldsPackV0Manifest)
    );
    expect(manifest.id).toBe(WORLDS_PACK_V0_ID);
    expect(manifest.version).toBe(WORLDS_PACK_V0_VERSION);
    expect(manifest.planes).toEqual({
      engine: true,
      language: true,
      security: true,
    });
    expect(manifest.hooks).toEqual({
      erasure: true,
      mcp: true,
      receipts: true,
    });
    expect(manifest.nouns.map((noun) => noun.id)).toEqual(["world"]);
    expect(manifest.verbs.map((verb) => verb.id)).toEqual(["inspect"]);
  });

  it("loads pack v0 with no-op MCP/receipts/erasure hooks", async () => {
    const pack = await Effect.runPromise(
      loadOntologyPack(worldsPackV0Manifest, worldsPackV0Hooks)
    );
    await expect(
      Effect.runPromise(pack.hooks.mcp.listToolDescriptors())
    ).resolves.toEqual([]);
    await expect(
      Effect.runPromise(pack.hooks.receipts.onReceipt())
    ).resolves.toBeUndefined();
    await expect(
      Effect.runPromise(pack.hooks.erasure.onErasureRequest())
    ).resolves.toBeUndefined();
  });

  it("rejects packs that drop a required plane or hook", async () => {
    const missingPlane = await Effect.runPromise(
      validateOntologyPack({
        ...worldsPackV0Manifest,
        planes: { language: true, engine: true, security: false },
      }).pipe(Effect.flip)
    );
    expect(missingPlane).toBeInstanceOf(OntologyPackInvalid);
    expect(missingPlane.reason).toBe("missing_plane");

    const missingHook = await Effect.runPromise(
      validateOntologyPack({
        ...worldsPackV0Manifest,
        hooks: { mcp: true, receipts: true, erasure: false },
      }).pipe(Effect.flip)
    );
    expect(missingHook.reason).toBe("missing_hook");
  });

  it("rejects verbs that reference unknown nouns", async () => {
    const denied = await Effect.runPromise(
      validateOntologyPack({
        ...worldsPackV0Manifest,
        verbs: [
          {
            id: "orphan",
            kind: "verb",
            label: "Orphan",
            nounIds: ["missing-noun"],
            plane: "language",
          },
        ],
      }).pipe(Effect.flip)
    );
    expect(denied.reason).toBe("unknown_noun_ref");
  });

  it("registers Worlds pack v0 idempotently without private-chat side effects", async () => {
    expect(getRegisteredOntologyPack()).toBeNull();
    const first = await Effect.runPromise(registerWorldsPackV0);
    const second = await Effect.runPromise(registerWorldsPackV0);
    expect(first).toBe(second);
    expect(getRegisteredOntologyPack()?.manifest.id).toBe(WORLDS_PACK_V0_ID);
    // Hook surface stays empty — Companion private chat tools unchanged.
    await expect(
      Effect.runPromise(
        getRegisteredOntologyPack()!.hooks.mcp.listToolDescriptors()
      )
    ).resolves.toEqual([]);
  });

  it("Companion registration layer loads pack v0 at runtime construction", async () => {
    const runtime = ManagedRuntime.make(worldsPackRegistrationLayer);
    await runtime.runPromise(Effect.void);
    expect(getRegisteredOntologyPack()?.manifest.version).toBe(
      WORLDS_PACK_V0_VERSION
    );
    await runtime.dispose();
  });

  it("noop hooks factory is Effect-safe", async () => {
    const hooks = noopOntologyPackHooks();
    await expect(
      Effect.runPromise(
        Effect.all([
          hooks.mcp.listToolDescriptors(),
          hooks.receipts.onReceipt(),
          hooks.erasure.onErasureRequest(),
        ])
      )
    ).resolves.toEqual([[], undefined, undefined]);
  });
});
