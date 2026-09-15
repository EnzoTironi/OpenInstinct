import { createEnv } from "@t3-oss/env-nextjs";
import { Effect, Schema } from "effect";
import { z } from "zod";
import { isE164PhoneNumber } from "@shared/identity/phone-number";
import { databaseUrlSchema } from "@shared/environment/database-url";
import {
  browserModelProviderSchema,
  browserModelSchema,
  codexModelSchema,
  installationModelProviderSchema,
} from "@shared/environment/model-provider";

export const betterAuthSecretSchema = z
  .string()
  .refine(
    (value) => value.trim().length >= 32,
    "BETTER_AUTH_SECRET must contain at least 32 characters."
  );

export const secretEncryptionKeySchema = z
  .string()
  .refine(
    (value) => Buffer.from(value, "base64").length === 32,
    "SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key."
  );

const localDevelopment =
  process.env.NODE_ENV === "development" &&
  process.env.VERCEL_ENV === undefined;
const explicitBetterAuthSecret = hasValue(process.env.BETTER_AUTH_SECRET);
const explicitSecretEncryptionKey = hasValue(process.env.SECRET_ENCRYPTION_KEY);

if (
  localDevelopment &&
  explicitBetterAuthSecret !== explicitSecretEncryptionKey
) {
  throw new Error(
    "Set both BETTER_AUTH_SECRET and SECRET_ENCRYPTION_KEY, or leave both unset for local defaults."
  );
}

const useLocalInstallationDefaults =
  localDevelopment && !explicitBetterAuthSecret && !explicitSecretEncryptionKey;

const requiredValue = z
  .string()
  .refine((value) => value.trim().length > 0, "Required");

const betterAuthUrlSchema = requiredValue.refine(
  (value) => URL.canParse(value),
  "BETTER_AUTH_URL must be an absolute URL"
);

function optionalValueWithLocalDefault<T extends z.ZodType<string, string>>(
  schema: T,
  localDefault: z.util.NoUndefined<z.output<T>>
) {
  return localDevelopment ? schema.default(localDefault) : schema.optional();
}

function installationSecretWithLocalDefault<
  T extends z.ZodType<string, string>,
>(schema: T, localDefault: z.util.NoUndefined<z.output<T>>) {
  return useLocalInstallationDefaults
    ? schema.default(localDefault)
    : schema.optional();
}

export const env = createEnv({
  server: {
    // Required
    DATABASE_URL: databaseUrlSchema,
    KERNEL_API_KEY: requiredValue.optional(),
    COMPANION_MODEL_PROVIDER: Schema.toStandardSchemaV1(
      Schema.optional(installationModelProviderSchema)
    ),
    COMPANION_CODEX_MODEL: Schema.toStandardSchemaV1(
      Schema.optional(codexModelSchema)
    ),
    COMPANION_BROWSER_MODEL_PROVIDER: Schema.toStandardSchemaV1(
      Schema.optional(browserModelProviderSchema)
    ),
    COMPANION_BROWSER_MODEL: Schema.toStandardSchemaV1(
      Schema.optional(browserModelSchema)
    ),
    MARKETING_WHATSAPP_NUMBER: requiredValue.optional(),
    MARKETING_TELEGRAM_USERNAME: requiredValue.optional(),
    MARKETING_IMESSAGE_NUMBER: requiredValue.optional(),

    // Optional overrides with local defaults. Vercel deployments provision
    // installation secrets in their connected private Blob store.
    BETTER_AUTH_SECRET: installationSecretWithLocalDefault(
      betterAuthSecretSchema,
      "openinstinct-local-auth-development-secret"
    ),
    BETTER_AUTH_URL: optionalValueWithLocalDefault(
      betterAuthUrlSchema,
      "http://localhost:3000"
    ),
    SECRET_ENCRYPTION_KEY: installationSecretWithLocalDefault(
      secretEncryptionKeySchema,
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    ),

    // Optional
    BLOB_READ_WRITE_TOKEN: requiredValue.optional(),
    BLOB_STORE_ID: requiredValue.optional(),
    ZOEN_MEM0_URL: z.url().optional(),
    ZOEN_ERASURE_JOURNAL_BUCKET: requiredValue.optional(),
    ZOEN_ERASURE_JOURNAL_ENDPOINT: z
      .url()
      .default("https://fly.storage.tigris.dev"),
    ZOEN_ERASURE_JOURNAL_ACCESS_KEY: Schema.toStandardSchemaV1(
      Schema.optional(
        Schema.RedactedFromValue(Schema.NonEmptyString, {
          disallowEncode: true,
        })
      )
    ),
    ZOEN_ERASURE_JOURNAL_SECRET_KEY: Schema.toStandardSchemaV1(
      Schema.optional(
        Schema.RedactedFromValue(Schema.NonEmptyString, {
          disallowEncode: true,
        })
      )
    ),
    ZOEN_MATRIX_URL: z.url().optional(),
    ZOEN_VAULTWARDEN_URL: z
      .url()
      .refine((value) => {
        const url = new URL(value);
        return url.protocol === "https:" && url.origin === value;
      }, "Vaultwarden requires an HTTPS origin.")
      .optional(),
    ZOEN_VAULTWARDEN_CLIENT_SECRET: Schema.toStandardSchemaV1(
      Schema.optional(
        Schema.RedactedFromValue(Schema.String.check(Schema.isMinLength(32)), {
          disallowEncode: true,
        })
      )
    ),
    ZOEN_MATRIX_SERVER_NAME: z
      .string()
      .regex(/^[a-z0-9.-]+$/)
      .optional(),
    ZOEN_MATRIX_AS_TOKEN: Schema.toStandardSchemaV1(
      Schema.optional(
        Schema.RedactedFromValue(Schema.String.check(Schema.isMinLength(32)), {
          disallowEncode: true,
        })
      )
    ),
    ZOEN_MATRIX_HS_TOKEN: Schema.toStandardSchemaV1(
      Schema.optional(
        Schema.RedactedFromValue(Schema.String.check(Schema.isMinLength(32)), {
          disallowEncode: true,
        })
      )
    ),
    ZOEN_WHATSAPP_BRIDGE_URL: z.url().optional(),
    ZOEN_WHATSAPP_PROVISIONING_SECRET: Schema.toStandardSchemaV1(
      Schema.optional(
        Schema.RedactedFromValue(Schema.String.check(Schema.isMinLength(32)), {
          disallowEncode: true,
        })
      )
    ),
    ZOEN_WHATSAPP_AS_TOKEN: Schema.toStandardSchemaV1(
      Schema.optional(
        Schema.RedactedFromValue(Schema.String.check(Schema.isMinLength(32)), {
          disallowEncode: true,
        })
      )
    ),
    ZOEN_WHATSAPP_HS_TOKEN: Schema.toStandardSchemaV1(
      Schema.optional(
        Schema.RedactedFromValue(Schema.String.check(Schema.isMinLength(32)), {
          disallowEncode: true,
        })
      )
    ),
    ZOEN_MEM0_API_KEY: Schema.toStandardSchemaV1(
      Schema.optional(
        Schema.RedactedFromValue(Schema.String.check(Schema.isMinLength(32)), {
          disallowEncode: true,
        })
      )
    ),
    GOOGLE_CLIENT_ID: Schema.toStandardSchemaV1(
      Schema.optional(Schema.NonEmptyString.check(Schema.isTrimmed()))
    ),
    GOOGLE_CLIENT_SECRET: Schema.toStandardSchemaV1(
      Schema.optional(
        Schema.RedactedFromValue(Schema.NonEmptyString, {
          disallowEncode: true,
        })
      )
    ),

    ZOEN_REGISTRATION_MODE: z.enum(["open", "closed"]).default("open"),
    ZOEN_BETA_FULL_TELEMETRY: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    ZOEN_OPERATOR_EMAILS: z
      .string()
      .default("")
      .transform((value) =>
        value
          .split(",")
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean)
      ),
    ZOEN_BETA_IDENTITIES: z
      .string()
      .default("")
      .transform((value) =>
        value
          .split(",")
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean)
      )
      .refine(
        (identities) =>
          identities.every(
            (item) =>
              /^(telegram|kapso):[+0-9]+$/u.test(item) ||
              (item.startsWith("google:") &&
                z.email().safeParse(item.slice(7)).success)
          ),
        "Use comma-separated telegram:ID, kapso:NUMBER or google:EMAIL identities"
      ),
    ZOEN_BILLING_MODE: Schema.toStandardSchemaV1(
      Schema.Literals(["free-beta", "paid"]).pipe(
        Schema.withDecodingDefault(Effect.succeed("free-beta" as const))
      )
    ),
    // Paid billing requires an explicit mode change as well as credentials.
    STRIPE_SECRET_KEY: Schema.toStandardSchemaV1(
      Schema.optional(
        Schema.RedactedFromValue(Schema.NonEmptyString, {
          disallowEncode: true,
        })
      )
    ),
    STRIPE_WEBHOOK_SECRET: Schema.toStandardSchemaV1(
      Schema.optional(
        Schema.RedactedFromValue(Schema.NonEmptyString, {
          disallowEncode: true,
        })
      )
    ),
    STRIPE_PRICE_PRO: Schema.toStandardSchemaV1(
      Schema.optional(Schema.NonEmptyString.check(Schema.isTrimmed()))
    ),
    STRIPE_PRICE_ORG_SEAT: Schema.toStandardSchemaV1(
      Schema.optional(Schema.NonEmptyString.check(Schema.isTrimmed()))
    ),
    OPERON_HOME: requiredValue.optional(),
    OPERON_DATABASE_URL: requiredValue.optional(),
    OPERON_BUILDER_ENABLED: z.enum(["true", "false"]).optional(),
    LINQ_CONNECTOR: requiredValue.optional(),
    LINQ_PHONE_NUMBER: requiredValue
      .refine(
        (value) => isE164PhoneNumber(value),
        "LINQ_PHONE_NUMBER must use E.164 format"
      )
      .optional(),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("production"),
    VERCEL_BRANCH_URL: requiredValue.optional(),
    VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
    VERCEL_PROJECT_ID: requiredValue.optional(),
    VERCEL_PROJECT_PRODUCTION_URL: requiredValue.optional(),
    VERCEL_URL: requiredValue.optional(),
  },
  experimental__runtimeEnv: {},
  emptyStringAsUndefined: true,
});

function hasValue(value: string | undefined) {
  return value !== undefined && value.trim().length > 0;
}
