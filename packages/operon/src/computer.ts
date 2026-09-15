import { Effect, Schema } from "effect";

const requiredId = Schema.String.check(Schema.isMinLength(1));
const parseOptions = { onExcessProperty: "error" } as const;

export const computerScopeSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("private"),
    userId: requiredId,
    workspaceId: requiredId,
  }),
  Schema.Struct({
    kind: Schema.Literal("shared"),
    audienceId: requiredId,
    workspaceId: requiredId,
  }),
]);
export type ComputerScope = typeof computerScopeSchema.Type;

const decodeScope = Schema.decodeUnknownEffect(
  computerScopeSchema,
  parseOptions
);

const guestEnvironmentAllowlist = [
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "PWD",
  "TERM",
  "TMPDIR",
] as const;

const hostSecretName =
  /(?:SECRET|TOKEN|PASSWORD|DATABASE|CREDENTIAL|PRIVATE|API_KEY|ENCRYPTION|AUTH)/iu;

export const embeddedRuntimeDecision = {
  agentOs: "no-go",
  secondAgentLoop: false,
  selected: "eve-just-bash",
} as const;

export class ComputerRejected extends Schema.TaggedError<ComputerRejected>()(
  "ComputerRejected",
  {
    reason: Schema.Literals([
      "disposed",
      "invalid_parameter",
      "invalid_scope",
      "private_material",
      "scope_mismatch",
    ]),
  }
) {}

interface StoredComputer {
  consumedPrivate: boolean;
  files: Map<string, string>;
  running: boolean;
  scope: ComputerScope;
}

interface ComputerState {
  readonly sessions: Map<string, StoredComputer>;
}

function reject(reason: ComputerRejected["reason"]) {
  return new ComputerRejected({ reason });
}

/**
 * Stable guest identity for one private user or one shared audience.
 * A company workspace id alone is not a computer key.
 */
export function computerScopeKey(scope: ComputerScope): string {
  switch (scope.kind) {
    case "private":
      return `private\0${scope.workspaceId}\0${scope.userId}`;
    case "shared":
      return `shared\0${scope.workspaceId}\0${scope.audienceId}`;
    default: {
      const exhaustive: never = scope;
      return exhaustive;
    }
  }
}

/**
 * Guest process environment. Only the allowlist is copied; host secrets stay
 * on the trusted runtime.
 */
export function guestEnvironment(
  host: Readonly<Record<string, string | undefined>>
) {
  return Object.fromEntries(
    guestEnvironmentAllowlist.flatMap((key) => {
      if (hostSecretName.test(key)) {
        return [];
      }
      const value = host[key];
      if (value === undefined || value.length === 0) {
        return [];
      }
      return [[key, value]];
    })
  );
}

function guestPath(path: string) {
  const trimmed = path.trim();
  if (
    trimmed.length === 0 ||
    trimmed.includes("\0") ||
    trimmed.split("/").includes("..")
  ) {
    return undefined;
  }
  return trimmed;
}

const requireHost = Effect.fn("InMemoryComputer.requireHost")(function* (
  scope: ComputerScope
) {
  return yield* decodeScope(scope).pipe(
    Effect.mapError(() => reject("invalid_scope"))
  );
});

const requireSession = Effect.fn("InMemoryComputer.requireSession")(function* (
  state: ComputerState,
  scope: ComputerScope
) {
  const host = yield* requireHost(scope);
  const session = state.sessions.get(computerScopeKey(host));
  if (!session) {
    return yield* reject("disposed");
  }
  return { host, session };
});

const openImpl = Effect.fn("InMemoryComputer.open")(function* (
  state: ComputerState,
  scope: ComputerScope,
  encoded: Schema.Json
) {
  const host = yield* requireHost(scope);
  const admission = yield* Schema.decodeUnknownEffect(
    Schema.Struct({
      privateMaterial: Schema.optionalKey(Schema.Boolean),
    }),
    parseOptions
  )(encoded).pipe(Effect.mapError(() => reject("invalid_parameter")));
  const key = computerScopeKey(host);
  const existing = state.sessions.get(key);
  if (existing) {
    existing.running = true;
    existing.consumedPrivate =
      existing.consumedPrivate || admission.privateMaterial === true;
    existing.scope = host;
    return { key, reused: true };
  }
  state.sessions.set(key, {
    consumedPrivate: admission.privateMaterial === true,
    files: new Map(),
    running: true,
    scope: host,
  });
  return { key, reused: false };
});

const writeImpl = Effect.fn("InMemoryComputer.write")(function* (
  state: ComputerState,
  scope: ComputerScope,
  path: string,
  content: string
) {
  const { session } = yield* requireSession(state, scope);
  const storedPath = guestPath(path);
  if (storedPath === undefined) {
    return yield* reject("invalid_parameter");
  }
  session.files.set(storedPath, content);
  return { path: storedPath };
});

const readImpl = Effect.fn("InMemoryComputer.read")(function* (
  state: ComputerState,
  scope: ComputerScope,
  path: string
) {
  const { session } = yield* requireSession(state, scope);
  const storedPath = guestPath(path);
  if (storedPath === undefined) {
    return yield* reject("invalid_parameter");
  }
  const content = session.files.get(storedPath);
  if (content === undefined) {
    return yield* reject("invalid_parameter");
  }
  return { content, path: storedPath };
});

const stopImpl = Effect.fn("InMemoryComputer.stop")(function* (
  state: ComputerState,
  scope: ComputerScope
) {
  const { host, session } = yield* requireSession(state, scope);
  session.running = false;
  return { key: computerScopeKey(host), running: false };
});

const disposeImpl = Effect.fn("InMemoryComputer.dispose")(function* (
  state: ComputerState,
  scope: ComputerScope
) {
  const host = yield* requireHost(scope);
  const key = computerScopeKey(host);
  if (!state.sessions.delete(key)) {
    return yield* reject("disposed");
  }
  return { key };
});

const reopenImpl = Effect.fn("InMemoryComputer.reopen")(function* (
  state: ComputerState,
  scope: ComputerScope
) {
  const { host, session } = yield* requireSession(state, scope);
  session.running = true;
  return {
    key: computerScopeKey(host),
    paths: [...session.files.keys()],
    running: true,
  };
});

const reuseImpl = Effect.fn("InMemoryComputer.reuse")(function* (
  state: ComputerState,
  from: ComputerScope,
  to: ComputerScope
) {
  const sourceHost = yield* requireHost(from);
  const targetHost = yield* requireHost(to);
  const session = state.sessions.get(computerScopeKey(sourceHost));
  if (!session) {
    return yield* reject("disposed");
  }
  if (computerScopeKey(sourceHost) === computerScopeKey(targetHost)) {
    return { key: computerScopeKey(targetHost) };
  }
  if (session.consumedPrivate && targetHost.kind === "shared") {
    return yield* reject("private_material");
  }
  return yield* reject("scope_mismatch");
});

/**
 * Host-scoped guest sessions. Persistence is the selected Eve just-bash
 * backend; this catalog only enforces identity, reuse and isolation.
 */
export class InMemoryComputer {
  readonly #state: ComputerState = { sessions: new Map() };

  open(scope: ComputerScope, encoded: Schema.Json) {
    return openImpl(this.#state, scope, encoded);
  }

  write(scope: ComputerScope, path: string, content: string) {
    return writeImpl(this.#state, scope, path, content);
  }

  read(scope: ComputerScope, path: string) {
    return readImpl(this.#state, scope, path);
  }

  stop(scope: ComputerScope) {
    return stopImpl(this.#state, scope);
  }

  dispose(scope: ComputerScope) {
    return disposeImpl(this.#state, scope);
  }

  reopen(scope: ComputerScope) {
    return reopenImpl(this.#state, scope);
  }

  reuse(from: ComputerScope, to: ComputerScope) {
    return reuseImpl(this.#state, from, to);
  }
}
