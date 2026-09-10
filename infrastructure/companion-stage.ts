import { Stack } from "alchemy/Stack";
import { Context, Effect, Layer } from "effect";

/**
 * Documented Companion application stages for Release-2 ops.
 * Alchemy also accepts other `--stage` names; prefer these for promotion.
 */
const DOCUMENTED_COMPANION_STAGES = [
  "local",
  "dev",
  "staging",
  "prod",
] as const;

type DocumentedCompanionStage = (typeof DOCUMENTED_COMPANION_STAGES)[number];

export type CompanionStageTier = "ephemeral" | "shared-preprod" | "production";

function companionDatabaseName(stage: string): string {
  return `open_instinct_${stage.replaceAll("-", "_")}`;
}

function companionStageTier(stage: string): CompanionStageTier {
  if (stage === "prod") {
    return "production";
  }
  if (stage === "staging") {
    return "shared-preprod";
  }
  return "ephemeral";
}

function companionEnvFileHint(stage: string): string {
  switch (stage) {
    case "prod":
      return ".env.prod";
    case "staging":
      return ".env.staging";
    case "dev":
      return ".env.dev";
    default:
      return ".env.local";
  }
}

function isDocumentedCompanionStage(
  stage: string
): stage is DocumentedCompanionStage {
  return DOCUMENTED_COMPANION_STAGES.some((documented) => documented === stage);
}

/** Retain the Postgres data volume on destroy only for production. */
function retainPostgresDataOnDestroy(stage: string): boolean {
  return stage === "prod";
}

/**
 * Effect layer: stage-derived policy for Companion Alchemy composition.
 * Staging and prod share the same Docker program; they differ by tier,
 * env-file hint, and whether destroy retains the data volume.
 */
export class CompanionStagePolicy extends Context.Service<
  CompanionStagePolicy,
  {
    readonly stage: string;
    readonly documented: boolean;
    readonly tier: CompanionStageTier;
    readonly database: string;
    readonly envFileHint: string;
    readonly retainPostgresData: boolean;
  }
>()("companion/CompanionStagePolicy") {
  static readonly layer = Layer.effect(
    CompanionStagePolicy,
    Effect.gen(function* () {
      const stack = yield* Stack;
      const stage = stack.stage;
      return CompanionStagePolicy.of({
        stage,
        documented: isDocumentedCompanionStage(stage),
        tier: companionStageTier(stage),
        database: companionDatabaseName(stage),
        envFileHint: companionEnvFileHint(stage),
        retainPostgresData: retainPostgresDataOnDestroy(stage),
      });
    })
  );
}
