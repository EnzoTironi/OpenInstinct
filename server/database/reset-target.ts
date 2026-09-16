import { Effect, Schema } from "effect";

export class ResetRefused extends Schema.TaggedError<ResetRefused>()(
  "ResetRefused",
  { message: Schema.String }
) {}

export const disposableDatabaseNames = [
  "companion_runtime_test",
  "open_instinct",
  "open_instinct_local",
  "open_instinct_dev",
] as const;

const protectedDatabaseNames = ["open_instinct_prod"] as const;

const disposableNameSet = new Set<string>(disposableDatabaseNames);
const protectedNameSet = new Set<string>(protectedDatabaseNames);

const localResetHosts = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
  "[::1]",
  "postgres",
  "db",
]);

export interface AllowedResetTarget {
  readonly kind: "allowed";
  readonly databaseName: string;
  readonly hostname: string;
}

interface RefusedResetTarget {
  readonly kind: "refused";
  readonly reason: string;
}

export type ResetTargetDecision = AllowedResetTarget | RefusedResetTarget;

function databaseNameFromUrl(url: URL): string {
  return decodeURIComponent(url.pathname.replace(/^\/+/u, "")).replace(
    /\/+$/u,
    ""
  );
}

function isProtectedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host.includes("companion-pg") ||
    host.endsWith(".internal") ||
    host.endsWith(".flycast") ||
    host.endsWith(".fly.dev") ||
    host.endsWith(".tironi.xyz")
  );
}

/**
 * Classify a PostgreSQL URL for disposable reset. Fail closed. Does not
 * connect and never includes user or password in the reason.
 */
export function inspectResetTarget(input: {
  readonly connectionString: string;
  readonly confirm: string;
}): ResetTargetDecision {
  const confirm = input.confirm.trim();
  if (confirm.length === 0) {
    return {
      kind: "refused",
      reason:
        "Pass --confirm <database-name> matching the disposable DATABASE_URL target.",
    };
  }
  let url: URL;
  try {
    url = new URL(input.connectionString);
  } catch {
    return {
      kind: "refused",
      reason: "Connection string is not a PostgreSQL URL.",
    };
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    return {
      kind: "refused",
      reason: "Connection string is not a PostgreSQL URL.",
    };
  }
  const databaseName = databaseNameFromUrl(url);
  const hostname = url.hostname.toLowerCase();
  if (databaseName.length === 0) {
    return { kind: "refused", reason: "PostgreSQL URL has no database name." };
  }
  if (protectedNameSet.has(databaseName) || isProtectedHost(hostname)) {
    return {
      kind: "refused",
      reason: "Protected database and host combinations cannot be reset.",
    };
  }
  if (!disposableNameSet.has(databaseName)) {
    return {
      kind: "refused",
      reason: "Database name is not on the disposable reset allowlist.",
    };
  }
  if (!localResetHosts.has(hostname)) {
    return {
      kind: "refused",
      reason: "Disposable reset is limited to local development hosts.",
    };
  }
  if (confirm !== databaseName) {
    return {
      kind: "refused",
      reason: "Confirm value must match the database name in DATABASE_URL.",
    };
  }
  return { databaseName, hostname, kind: "allowed" };
}

export function confirmArgument(argv: readonly string[]): string | undefined {
  const index = argv.indexOf("--confirm");
  if (index < 0) {
    return undefined;
  }
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    return undefined;
  }
  return value;
}

export const authorizeDisposableReset = Effect.fn("authorizeDisposableReset")(
  function* (
    connectionString: string,
    confirm: string
  ): Effect.fn.Return<AllowedResetTarget, ResetRefused> {
    const decision = inspectResetTarget({ confirm, connectionString });
    if (decision.kind === "refused") {
      return yield* new ResetRefused({ message: decision.reason });
    }
    return decision;
  }
);
