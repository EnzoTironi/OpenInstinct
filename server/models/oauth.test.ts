import { afterEach, describe, expect, it, vi } from "vitest";
import { Effect, Schema } from "effect";
import { beginModelOAuth, pollModelOAuth, refreshModelOAuth } from "./oauth";

afterEach(() => vi.unstubAllGlobals());
const jwt = `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-account" } })).toString("base64url")}.signature`;

describe("workspace provider device authorization", () => {
  it("uses a fixed Codex device page and exchanges a one-time code with its verifier", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          device_auth_id: "device-proof",
          user_code: "SAFE-123",
          interval: "5",
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          authorization_code: "one-time",
          code_verifier: "pkce-proof",
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          access_token: jwt,
          refresh_token: "synthetic-refresh",
          expires_in: 3600,
        })
      );
    vi.stubGlobal("fetch", fetcher);
    const start = await Effect.runPromise(beginModelOAuth("chatgpt"));
    expect(start.verificationUri).toBe("https://auth.openai.com/codex/device");
    const result = await Effect.runPromise(
      pollModelOAuth("chatgpt", {
        deviceCode: start.deviceCode,
        userCode: start.userCode,
      })
    );
    expect(result).toMatchObject({
      status: "connected",
      tokens: { accountId: "synthetic-account" },
    });
    expect(fetcher.mock.calls[2]?.[0]).toBe(
      "https://auth.openai.com/oauth/token"
    );
    const form = Schema.decodeUnknownSync(Schema.instanceOf(URLSearchParams))(
      fetcher.mock.calls[2]?.[1]?.body
    );
    expect(form.get("code_verifier")).toBe("pkce-proof");
  });

  it.each([403, 404])(
    "treats Codex %s as pending without accepting a grant",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, { status }))
      );
      expect(
        await Effect.runPromise(
          pollModelOAuth("chatgpt", { deviceCode: "device", userCode: "code" })
        )
      ).toEqual({ status: "pending" });
    }
  );

  it.each([
    "http://auth.x.ai/activate",
    "https://evil.invalid/activate",
    "https://auth.x.ai.evil.invalid/activate",
    "https://user:pass@auth.x.ai/activate",
  ])(
    "rejects an untrusted provider verification address: %s",
    async (verification_uri) => {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>().mockResolvedValue(
          Response.json({
            device_code: "device",
            user_code: "code",
            verification_uri,
            expires_in: 600,
          })
        )
      );
      await expect(
        Effect.runPromise(beginModelOAuth("grok"))
      ).rejects.toMatchObject({
        _tag: "ModelConnectionError",
        reason: "invalid_response",
      });
    }
  );

  it("honors Grok slow_down and never interprets denial as success", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({ error: "slow_down" }, { status: 400 })
        )
        .mockResolvedValueOnce(
          Response.json({ error: "access_denied" }, { status: 400 })
        )
    );
    const request = { deviceCode: "device", userCode: "code" };
    expect(await Effect.runPromise(pollModelOAuth("grok", request))).toEqual({
      status: "slow_down",
    });
    await expect(
      Effect.runPromise(pollModelOAuth("grok", request))
    ).rejects.toMatchObject({ reason: "denied" });
  });

  it("preserves the previous refresh token when xAI does not rotate it", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ access_token: "new-access", expires_in: 3600 })
        )
    );
    const tokens = await Effect.runPromise(
      refreshModelOAuth("grok", {
        accessToken: "old",
        refreshToken: "old-refresh",
        expiresAt: 0,
      })
    );
    expect(tokens.refreshToken).toBe("old-refresh");
    expect(tokens.accessToken).toBe("new-access");
  });
});
