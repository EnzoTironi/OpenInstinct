import { vi } from "vitest";

vi.mock("@web/i18n/server", async () => {
  const { createTranslator } = await import("@web/i18n/translate");
  const { default: messages } = await import("@web/i18n/messages/pt-br.json");
  return {
    getI18n: async () => ({
      locale: "pt-BR",
      messages,
      t: createTranslator(messages),
    }),
  };
});

const testEnvironment = {
  BETTER_AUTH_SECRET: "test-auth-secret-0123456789abcdefghijklmnop",
  BETTER_AUTH_URL: "https://example.com",
  BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test",
  DATABASE_URL: "postgresql://user:password@example.com/database",
  KERNEL_API_KEY: "test-kernel-key",
  SECRET_ENCRYPTION_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
};

for (const [name, value] of Object.entries(testEnvironment)) {
  vi.stubEnv(name, value);
}
