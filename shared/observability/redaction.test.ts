import { describe, expect, it } from "vitest";
import { parseDiagnostic } from "./redaction";

describe("beta diagnostics", () => {
  it("preserves useful conversations and tool results while removing nested credentials", () => {
    const result = parseDiagnostic(
      JSON.stringify({
        message: "The calendar action failed",
        result: {
          status: 403,
          refresh_token: "canary-private",
          Authorization: "Bearer private-canary",
        },
        url: "https://t.me/bot?start=login-canary",
        source: "api_key=secret-canary",
        error: JSON.stringify({ refreshToken: "embedded-canary" }),
        image: "data:image/png;base64,abcd1234=",
      })
    );
    expect(JSON.stringify(result)).not.toContain("canary");
    expect(JSON.stringify(result)).toContain("calendar action failed");
    expect(result).toMatchObject({
      result: { status: 403 },
      image: "[binary attachment]",
    });
  });
  it("redacts TOTP seeds the same way as other credentials", () => {
    expect(
      JSON.stringify(
        parseDiagnostic(
          JSON.stringify({
            totp: "canary-totp-seed",
            otp_secret: "canary-otp-secret",
            message: "setup continued",
          })
        )
      )
    ).not.toContain("canary");
  });
  it("removes recognizable tokens embedded in arbitrary text", () => {
    expect(
      JSON.stringify(
        parseDiagnostic(
          JSON.stringify({
            message:
              "sk-12345678901234567890 eyJhbGciOiJIUzI1NiJ9.abcdef.abcdef",
          })
        )
      )
    ).not.toContain("123456789");
  });
  it("bounds oversized payloads without persisting partial invalid JSON", () => {
    expect(
      parseDiagnostic(
        JSON.stringify(Array.from({ length: 30 }, () => "x".repeat(64_000)))
      )
    ).toMatchObject({ truncated: true });
  });
});
