import { createHash } from "node:crypto";

import { Predicate, Schema } from "effect";

function isJsonObject(
  value: Schema.Json
): value is { readonly [key: string]: Schema.Json | undefined } {
  return Predicate.isObject(value);
}

export function canonicalJson(value: Schema.Json): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (isJsonObject(value)) {
    const keys = Object.keys(value).toSorted();
    const pairs: string[] = [];
    for (const key of keys) {
      const item = value[key];
      if (
        item === undefined ||
        Predicate.isFunction(item) ||
        Predicate.isSymbol(item)
      ) {
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
