import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("browser configuration boundary", () => {
  it.each([undefined, "", " "])(
    "imports without a usable browser key and rejects browser access for %j",
    async (value) => {
      vi.stubEnv("KERNEL_API_KEY", value);
      const { getKernel } = await import("../kernel");
      expect(() => getKernel()).toThrow("Browser execution is not configured");
    }
  );

  it("does not disclose an invalid credential in its failure", async () => {
    const secret = " private-browser-credential ";
    vi.stubEnv("KERNEL_API_KEY", secret);
    const { getKernel } = await import("../kernel");
    expect(() => getKernel()).toThrow("Set KERNEL_API_KEY");
    expect(() => getKernel()).not.toThrow(secret);
  });
});
