import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const transportSource = readFileSync(
  fileURLToPath(new URL("./transport.ts", import.meta.url)),
  "utf8"
);

describe("outbox transport 429 contract", () => {
  it("schedules ProviderRetryable through scheduleOutboxRetry, not markOutboxFailed", () => {
    expect(transportSource).toMatch(
      /ProviderRetryable:\s*\(error\)\s*=>\s*messaging\s*\.scheduleOutboxRetry/
    );
    expect(transportSource).toMatch(
      /ProviderRejected:\s*\(\)\s*=>\s*messaging\s*\.markOutboxFailed/
    );
    const retryableHandler =
      /ProviderRetryable:[\s\S]*?(?=ProviderUncertain:|ProviderInputError:)/u.exec(
        transportSource
      )?.[0];
    expect(retryableHandler).toBeDefined();
    expect(retryableHandler).not.toContain("markOutboxFailed");
    expect(retryableHandler).toContain("scheduleOutboxRetry");
    expect(retryableHandler).toContain("retryAfterSeconds");
  });
});
