import { createHmac, randomBytes } from "node:crypto";
import { Schema } from "effect";

const parseOptions = { onExcessProperty: "error" } as const;
const requiredId = Schema.String.check(Schema.isMinLength(1));
const originSchema = Schema.String.check(
  Schema.makeFilter((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "https:" || url.protocol === "http:") &&
        url.origin === value
      );
    } catch {
      return false;
    }
  })
);

const grantSchema = Schema.Struct({
  expiresAtMs: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  itemId: requiredId,
  origin: originSchema,
  remainingUses: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  revoked: Schema.Boolean,
  workspaceId: requiredId,
});

const admissionSchema = Schema.Struct({
  grant: grantSchema,
  itemId: requiredId,
  materializer: Schema.Literals(["failed", "ok"]),
  nowMs: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  pageOrigin: originSchema,
  workspaceId: requiredId,
});

const visibleItemSchema = Schema.Struct({
  account: Schema.String,
  handle: requiredId,
  kind: requiredId,
  label: requiredId,
});

/**
 * Host grant check for vault fill. The isolated materializer is required.
 * A failed unwrap does not fall back to plaintext workspace secrets.
 * This is not an Eve tool and never returns the secret.
 */
export function admitVaultRelease(encoded: Schema.Json) {
  const admission = Schema.decodeUnknownSync(
    admissionSchema,
    parseOptions
  )(encoded);
  if (admission.grant.workspaceId !== admission.workspaceId) {
    return deny("workspace_mismatch");
  }
  if (admission.grant.itemId !== admission.itemId) {
    return deny("item_mismatch");
  }
  if (admission.grant.revoked) {
    return deny("revoked");
  }
  if (admission.nowMs >= admission.grant.expiresAtMs) {
    return deny("expired");
  }
  if (admission.grant.origin !== admission.pageOrigin) {
    return deny("origin_mismatch");
  }
  if (admission.grant.remainingUses < 1) {
    return deny("exhausted");
  }
  switch (admission.materializer) {
    case "failed":
      return deny("materializer_failed");
    case "ok":
      return {
        kind: "allow" as const,
        remainingUses: admission.grant.remainingUses - 1,
      };
    default: {
      const exhaustive: never = admission.materializer;
      return exhaustive;
    }
  }
}

/**
 * Opaque model-visible vault row. Extra keys such as secret or totp fail.
 */
export function modelVisibleVaultItem(encoded: Schema.Json) {
  const item = Schema.decodeUnknownSync(
    visibleItemSchema,
    parseOptions
  )(encoded);
  return {
    account: item.account,
    available: true as const,
    handle: item.handle,
    kind: item.kind,
    label: item.label,
  };
}

export function generateVaultPassword() {
  return randomBytes(24).toString("base64url");
}

export function generateTotpSeed() {
  return encodeBase32(randomBytes(20));
}

/**
 * RFC 6238 SHA-1 six-digit TOTP. Accepts Base32 or an otpauth URI.
 * Trusted fill only; never a model-visible tool result.
 */
export function totpCode(secret: string, atMs: number) {
  return hotp(decodeTotpSecret(secret), Math.floor(atMs / 30_000));
}

function deny(
  reason:
    | "exhausted"
    | "expired"
    | "item_mismatch"
    | "materializer_failed"
    | "origin_mismatch"
    | "revoked"
    | "workspace_mismatch"
) {
  return { kind: "deny" as const, reason };
}

function hotp(key: Buffer, counter: number) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(message).digest();
  const offset = hmacByte(hmac, hmac.length - 1) & 0x0f;
  const binary =
    ((hmacByte(hmac, offset) & 0x7f) << 24) |
    (hmacByte(hmac, offset + 1) << 16) |
    (hmacByte(hmac, offset + 2) << 8) |
    hmacByte(hmac, offset + 3);
  return String(binary % 1_000_000).padStart(6, "0");
}

function hmacByte(hmac: Buffer, index: number) {
  const value = hmac[index];
  if (value === undefined) {
    throw new Error("TOTP HMAC is truncated.");
  }
  return value;
}

function decodeTotpSecret(secret: string) {
  if (secret.startsWith("otpauth://")) {
    const parsed = new URL(secret);
    const value = parsed.searchParams.get("secret");
    if (!value) {
      throw new Error("otpauth URI is missing a secret.");
    }
    return decodeBase32(value);
  }
  return decodeBase32(secret);
}

function encodeBase32(bytes: Buffer) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let buffer = 0;
  let output = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += base32Char(alphabet, (buffer >> bits) & 31);
    }
  }
  if (bits > 0) {
    output += base32Char(alphabet, (buffer << (5 - bits)) & 31);
  }
  return output;
}

function base32Char(alphabet: string, index: number) {
  const character = alphabet[index];
  if (character === undefined) {
    throw new Error("TOTP alphabet index is out of range.");
  }
  return character;
}

function decodeBase32(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = value.toUpperCase().replaceAll(/=+$/gu, "");
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const character of clean) {
    const index = alphabet.indexOf(character);
    if (index < 0) {
      throw new Error("TOTP secret is not valid Base32.");
    }
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}
