import { describe, expect, it } from "vitest";
import {
  admitVaultRelease,
  generateTotpSeed,
  generateVaultPassword,
  modelVisibleVaultItem,
  totpCode,
} from "./vault-grant";

const grant = {
  expiresAtMs: 1_700_000_000_000,
  itemId: "item-login-1",
  origin: "https://checkout.example",
  remainingUses: 2,
  revoked: false,
  workspaceId: "ws-alice",
};

const allowed = {
  grant,
  itemId: grant.itemId,
  materializer: "ok" as const,
  nowMs: 1_699_000_000_000,
  pageOrigin: grant.origin,
  workspaceId: grant.workspaceId,
};

describe("vault grant and trusted TOTP", () => {
  it("does allow one origin-bound use and deny expiry, reuse, and cross-origin", () => {
    const first = admitVaultRelease(allowed);
    expect(first).toEqual({ kind: "allow", remainingUses: 1 });
    expect(
      admitVaultRelease({
        ...allowed,
        grant: {
          ...grant,
          remainingUses: first.kind === "allow" ? first.remainingUses : 0,
        },
      })
    ).toEqual({ kind: "allow", remainingUses: 0 });
    expect(
      admitVaultRelease({
        ...allowed,
        grant: { ...grant, remainingUses: 0 },
      })
    ).toEqual({ kind: "deny", reason: "exhausted" });
    expect(
      admitVaultRelease({
        ...allowed,
        pageOrigin: "https://attacker.example",
      })
    ).toEqual({ kind: "deny", reason: "origin_mismatch" });
    expect(
      admitVaultRelease({
        ...allowed,
        nowMs: grant.expiresAtMs,
      })
    ).toEqual({ kind: "deny", reason: "expired" });
    expect(
      admitVaultRelease({
        ...allowed,
        grant: { ...grant, revoked: true },
      })
    ).toEqual({ kind: "deny", reason: "revoked" });
    expect(
      admitVaultRelease({
        ...allowed,
        workspaceId: "ws-bob",
      })
    ).toEqual({ kind: "deny", reason: "workspace_mismatch" });
  });

  it("does fail closed when the isolated materializer fails and rejects a weaker fallback", () => {
    expect(
      admitVaultRelease({
        ...allowed,
        materializer: "failed",
      })
    ).toEqual({ kind: "deny", reason: "materializer_failed" });
    expect(() =>
      admitVaultRelease({
        ...allowed,
        fallbackSecret: "plaintext-workspace-secret",
        materializer: "failed",
      })
    ).toThrow(/excess|Unexpected|extra/i);
  });

  it("does keep generated passwords and TOTP seeds off the model-visible surface", () => {
    const password = generateVaultPassword();
    const seed = generateTotpSeed();
    const canary = "canary-totp-JBSWY3DPEHPK3PXP";
    const visible = modelVisibleVaultItem({
      account: "checkout.example · a•••@example.com",
      handle: grant.itemId,
      kind: "login",
      label: "Checkout",
    });
    const fillReceipt = {
      filledClaims: 2,
      kind: "login",
      origin: grant.origin,
      success: true,
    };
    const surfaces = [
      JSON.stringify(visible),
      JSON.stringify(fillReceipt),
      JSON.stringify({ message: "Preencha o formulário com o item salvo." }),
    ];
    expect(password.length).toBeGreaterThan(16);
    expect(seed).toMatch(/^[A-Z2-7]+$/u);
    expect(totpCode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000)).toBe("287082");
    expect(
      totpCode(
        "otpauth://totp/Example:ada?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
        59_000
      )
    ).toBe("287082");
    for (const surface of surfaces) {
      expect(surface).not.toContain(password);
      expect(surface).not.toContain(seed);
      expect(surface).not.toContain(canary);
      expect(surface).not.toContain("otpauth://");
    }
    expect(() =>
      modelVisibleVaultItem({
        ...visible,
        totp: canary,
      })
    ).toThrow(/excess|Unexpected|extra/i);
    expect(() =>
      modelVisibleVaultItem({
        ...visible,
        secret: password,
      })
    ).toThrow(/excess|Unexpected|extra/i);
  });
});
