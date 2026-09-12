import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const applicationEnvironment = [
  "BETTER_AUTH_*",
  "BLOB_*",
  "DATABASE_URL",
  "*_CONNECTOR_UID",
  "KERNEL_*",
  "LINQ_*",
  "NODE_ENV",
  "OPERON_*",
  "SECRET_ENCRYPTION_KEY",
  "VERCEL_*",
];
const runtimeEnvironment = [
  "AI_GATEWAY_API_KEY",
  ...applicationEnvironment,
  "WORKFLOW_*",
];

describe("Turbo configuration", () => {
  it("scopes application environment variables to their owning tasks", async () => {
    const turbo = z
      .object({
        tasks: z.object({
          "build:app": z.object({ env: z.array(z.string()) }),
          "build:vercel": z.object({ env: z.array(z.string()) }),
          "dev:app": z.object({ passThroughEnv: z.array(z.string()) }),
          "start:app": z.object({ passThroughEnv: z.array(z.string()) }),
        }),
      })
      .loose()
      .parse(
        JSON.parse(
          await readFile(new URL("../turbo.json", import.meta.url), "utf8")
        )
      );

    expect(turbo).not.toHaveProperty("globalEnv");
    expect(turbo.tasks["build:app"].env).toEqual(
      expect.arrayContaining([
        ...applicationEnvironment,
        "EVE_NEXT_*",
        "OPEN_INSTINCT_LOW_MEM_BUILD",
      ])
    );
    expect(turbo.tasks["build:app"].env).toHaveLength(
      applicationEnvironment.length + 2
    );
    expect(turbo.tasks["build:vercel"].env).toEqual(applicationEnvironment);
    expect(turbo.tasks["dev:app"].passThroughEnv).toEqual(runtimeEnvironment);
    expect(turbo.tasks["start:app"].passThroughEnv).toEqual(runtimeEnvironment);
  });
});
