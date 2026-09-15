import { createHash } from "node:crypto";

import { Predicate, type Schema } from "effect";

function isJsonArray(value: Schema.Json): value is Schema.Json[] {
  return Array.isArray(value);
}

function isJsonObject(
  value: Schema.Json
): value is Record<string, Schema.Json> {
  return Predicate.isObject(value) && !Array.isArray(value);
}

export function canonicalJson(value: Schema.Json): string {
  if (isJsonArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (isJsonObject(value)) {
    const keys = Object.keys(value).toSorted();
    const pairs: string[] = [];
    for (const key of keys) {
      const item = value[key];
      if (item === undefined) {
        continue;
      }
      pairs.push(`${JSON.stringify(key)}:${canonicalJson(item)}`);
    }
    return `{${pairs.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function computeCanonicalDigest(value: Schema.Json): string {
  return createHash("sha256")
    .update(Buffer.from(canonicalJson(value), "utf8"))
    .digest("hex");
}
