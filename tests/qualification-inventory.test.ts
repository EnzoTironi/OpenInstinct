import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDiagnostic } from "../shared/observability/redaction";
import { scanSecretCanaries } from "../server/qualification/canary";
import {
  advertisedToolPaths,
  closedBetaEnvelope,
  livePassedRows,
  qualificationEvidence,
  qualifyCapacity,
  toolsMissingEvidence,
} from "../server/qualification/inventory";

describe("qualification inventory", () => {
  it("gives every advertised tool a unique row and never marks live journeys passed", () => {
    const ids = qualificationEvidence.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(advertisedToolPaths).size).toBe(advertisedToolPaths.length);
    expect(advertisedToolPaths).toEqual(
      expect.arrayContaining([
        "search",
        "whatsapp-send",
        "fill_from_vault",
        "workspace.files.list",
      ])
    );
    expect(livePassedRows()).toEqual([]);
    expect(
      qualificationEvidence.filter((row) => row.live.result === "passed")
    ).toEqual([]);
    expect(toolsMissingEvidence(["brand-new-undocumented-tool"])).toEqual([
      "brand-new-undocumented-tool",
    ]);
    expect(toolsMissingEvidence(advertisedToolPaths)).toEqual([]);
  });

  it("lists every launch eval file without treating listing as a live pass", () => {
    const files = readdirSync("evals/launch").filter((name) =>
      name.endsWith(".eval.ts")
    );
    const inventory = new Set(
      qualificationEvidence
        .filter((row) => row.family === "eval" && row.path.startsWith("evals/"))
        .map((row) => row.path.replace("evals/launch/", ""))
    );
    expect(files.toSorted()).toEqual([...inventory].toSorted());
    for (const entry of qualificationEvidence.filter(
      (row) => row.path.startsWith("evals/") || row.id.startsWith("OP0")
    ))
      expect(entry.live.result).toBe("blocked");
  });

  it("keeps the closed-beta envelope unmeasured and refuses quota exhaustion as success", () => {
    expect(closedBetaEnvelope.measured).toBe(false);
    expect(qualifyCapacity({ measured: false }).result).toBe("blocked");
    expect(
      qualifyCapacity({ measured: true, quotaInsufficient: true }).result
    ).toBe("blocked");
    expect(qualifyCapacity({ measured: true, scopeLeaks: 1 }).result).toBe(
      "failed"
    );
    for (const id of ["OP01", "OP02", "OP03", "OP08"]) {
      const row = qualificationEvidence.find((entry) => entry.id === id);
      expect(row?.fixture.result).toBe("blocked");
      expect(row?.live.result).toBe("blocked");
    }
  });

  it("keeps release rows on documentation and never marks publication passed", () => {
    const rel01 = qualificationEvidence.find((entry) => entry.id === "REL01");
    const rel02 = qualificationEvidence.find((entry) => entry.id === "REL02");
    const rel03 = qualificationEvidence.find((entry) => entry.id === "REL03");
    expect(rel01?.family).toBe("release");
    expect(rel01?.fixture.result).toBe("passed");
    expect(rel01?.live.result).toBe("blocked");
    expect(rel02?.fixture.result).toBe("blocked");
    expect(rel02?.live.result).toBe("blocked");
    expect(rel03?.fixture.result).toBe("passed");
    expect(rel03?.live.result).toBe("blocked");
  });

  it("scans planted secret canaries after diagnostic redaction", () => {
    const planted = [
      "canary-password-value",
      "canary-totp-seed",
      "canary-cookie",
    ];
    expect(
      scanSecretCanaries(
        JSON.stringify({ password: "canary-password-value" }),
        planted
      )
    ).toEqual(["canary-password-value"]);
    const redacted = JSON.stringify(
      parseDiagnostic(
        JSON.stringify({
          password: "canary-password-value",
          totp: "canary-totp-seed",
          cookie: "canary-cookie",
          message: "safe operational context",
        })
      )
    );
    expect(scanSecretCanaries(redacted, planted)).toEqual([]);
    expect(redacted).toContain("safe operational context");
  });
});
