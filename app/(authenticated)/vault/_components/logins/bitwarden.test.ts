import { Effect, Option, Redacted, Result } from "effect";
import { expect, test } from "vitest";
import { parseLoginVaultPayload } from "@shared/vault/schema";
import pbkdf2 from "./fixtures/bitwarden-pbkdf2.json";
import argon2 from "./fixtures/bitwarden-argon2.json";
import { openBitwardenExport, VaultImportFailed } from "./bitwarden";

test.each([pbkdf2, argon2])(
  "opens independently generated password exports: $source",
  async (fixture) => {
    const result = await Effect.runPromise(
      openBitwardenExport(
        JSON.stringify(fixture.export),
        Redacted.make(fixture.password)
      )
    );
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.skipped).toBe(0);
    expect(
      result.items.every(
        (item) =>
          parseLoginVaultPayload(item.secret)?.authentication.type ===
          "password"
      )
    ).toBe(true);
  }
);

test("preserves the delegated site's TOTP without exposing it as metadata", async () => {
  const result = await Effect.runPromise(
    openBitwardenExport(
      JSON.stringify(pbkdf2.export),
      Redacted.make(pbkdf2.password)
    )
  );
  const login = result.items.find(
    (item) => item.label === "Zoen delegated proof"
  );
  expect(login).toBeDefined();
  const payload = parseLoginVaultPayload(login?.secret ?? "");
  expect(payload?.authentication).toMatchObject({
    type: "password",
    totp: "JBSWY3DPEHPK3PXP",
  });
  expect(login?.account).toBe("");
});

test.each([
  { ...pbkdf2.export, passwordProtected: false },
  { ...pbkdf2.export, encrypted: false },
  { ...pbkdf2.export, data: pbkdf2.export.data.replace(/^2\../, "2.X") },
  { ...pbkdf2.export, kdfIterations: 2_000_001 },
  { ...argon2.export, kdfMemory: 129 },
  { ...pbkdf2.export, kdfType: 99 },
])(
  "rejects tampering, account-restricted exports and expensive KDF metadata",
  async (envelope) => {
    const result = await Effect.runPromise(
      openBitwardenExport(
        JSON.stringify(envelope),
        Redacted.make(pbkdf2.password)
      ).pipe(Effect.result)
    );
    expect(Result.isFailure(result)).toBe(true);
    expect(Result.getFailure(result).pipe(Option.getOrThrow)).toBeInstanceOf(
      VaultImportFailed
    );
  }
);

test("wrong password has a fixed error with no decrypted or encrypted content", async () => {
  const result = await Effect.runPromise(
    openBitwardenExport(
      JSON.stringify(pbkdf2.export),
      Redacted.make("incorrect-export-password")
    ).pipe(Effect.result)
  );
  expect(Result.isFailure(result)).toBe(true);
  expect(JSON.stringify(result)).not.toContain(pbkdf2.export.data);
  expect(JSON.stringify(result)).not.toContain("incorrect-export-password");
});
