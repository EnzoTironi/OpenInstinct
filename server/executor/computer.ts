import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { Effect, Schema } from "effect";
import {
  ComputerRejected,
  InMemoryComputer,
  computerScopeKey,
  guestEnvironment,
  type ComputerScope,
} from "../operon-kernel";

const metaName = ".zoen-meta.json";
const metaSchema = Schema.Struct({
  consumedPrivate: Schema.Boolean,
});

function reject(reason: ComputerRejected["reason"]) {
  return new ComputerRejected({ reason });
}

function scopeDirectory(root: string, scope: ComputerScope) {
  const digest = createHash("sha256")
    .update(computerScopeKey(scope))
    .digest("hex");
  return join(resolve(root), digest);
}

function scopedPath(root: string, relativePath: string) {
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, relativePath);
  const rel = relative(resolvedRoot, target);
  if (rel.startsWith(`..${sep}`) || rel === ".." || rel.includes("\0")) {
    return undefined;
  }
  return target;
}

const ioError = () => reject("invalid_parameter");

/**
 * Executor-owned working tree. Identity comes from Operon computer scope;
 * bytes live on host disk keyed by that scope, never in a shared `/home`.
 * Eve just-bash remains the guest. This is not a second public shell.
 */
export class HostComputer {
  readonly #memory = new InMemoryComputer();

  constructor(readonly root: string) {}

  environment(host: Readonly<Record<string, string | undefined>>) {
    return guestEnvironment(host);
  }

  open(scope: ComputerScope, encoded: Schema.Json) {
    return openImpl(this.#memory, this.root, scope, encoded);
  }

  write(scope: ComputerScope, path: string, content: string) {
    return writeImpl(this.#memory, this.root, scope, path, content);
  }

  read(scope: ComputerScope, path: string) {
    return this.#memory.read(scope, path);
  }

  stop(scope: ComputerScope) {
    return this.#memory.stop(scope);
  }

  reopen(scope: ComputerScope) {
    return this.#memory.reopen(scope);
  }

  reuse(from: ComputerScope, to: ComputerScope) {
    return this.#memory.reuse(from, to);
  }

  dispose(scope: ComputerScope) {
    return disposeImpl(this.#memory, this.root, scope);
  }
}

const readMeta = Effect.fn("HostComputer.readMeta")(function* (
  directory: string
) {
  const raw = yield* Effect.tryPromise({
    try: async () => {
      try {
        return await readFile(join(directory, metaName), "utf8");
      } catch {
        return undefined;
      }
    },
    catch: ioError,
  });
  if (raw === undefined) {
    return { consumedPrivate: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return yield* ioError();
  }
  return yield* Schema.decodeUnknownEffect(metaSchema)(parsed).pipe(
    Effect.mapError(ioError)
  );
});

const writeMeta = Effect.fn("HostComputer.writeMeta")(function* (
  directory: string,
  consumedPrivate: boolean
) {
  yield* atomicWrite(directory, metaName, JSON.stringify({ consumedPrivate }));
});

const listFiles = Effect.fn("HostComputer.listFiles")(function* (
  directory: string
) {
  return yield* Effect.tryPromise({
    try: async () => {
      try {
        return await walkFiles(directory);
      } catch {
        return [];
      }
    },
    catch: ioError,
  });
});

async function walkFiles(
  directory: string,
  prefix = ""
): Promise<readonly { content: string; path: string }[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: { content: string; path: string }[] = [];
  /* oxlint-disable eslint/no-await-in-loop */
  for (const entry of entries) {
    if (entry.name === metaName) {
      continue;
    }
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await walkFiles(full, relativePath);
      for (const file of nested) {
        files.push(file);
      }
      continue;
    }
    files.push({
      content: await readFile(full, "utf8"),
      path: relativePath,
    });
  }
  /* oxlint-enable eslint/no-await-in-loop */
  return files;
}

const atomicWrite = Effect.fn("HostComputer.atomicWrite")(function* (
  root: string,
  relativePath: string,
  content: string
) {
  const destination = scopedPath(root, relativePath);
  if (destination === undefined) {
    return yield* ioError();
  }
  const temporary = `${destination}.${randomUUID()}.tmp`;
  yield* Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(temporary, content, "utf8");
      await rename(temporary, destination);
    },
    catch: ioError,
  });
  return destination;
});

const openImpl = Effect.fn("HostComputer.open")(function* (
  memory: InMemoryComputer,
  root: string,
  scope: ComputerScope,
  encoded: Schema.Json
) {
  const directory = scopeDirectory(root, scope);
  const meta = yield* readMeta(directory);
  const admission = yield* Schema.decodeUnknownEffect(
    Schema.Struct({
      privateMaterial: Schema.optionalKey(Schema.Boolean),
    }),
    { onExcessProperty: "error" }
  )(encoded).pipe(Effect.mapError(() => reject("invalid_parameter")));
  const opened = yield* memory.open(scope, {
    privateMaterial: meta.consumedPrivate || Boolean(admission.privateMaterial),
  });
  if (!opened.reused) {
    const stored = yield* listFiles(directory);
    yield* Effect.forEach(stored, (file) =>
      memory.write(scope, file.path, file.content)
    );
  }
  yield* writeMeta(
    directory,
    meta.consumedPrivate || Boolean(admission.privateMaterial)
  );
  return opened;
});

const writeImpl = Effect.fn("HostComputer.write")(function* (
  memory: InMemoryComputer,
  root: string,
  scope: ComputerScope,
  path: string,
  content: string
) {
  const written = yield* memory.write(scope, path, content);
  yield* atomicWrite(scopeDirectory(root, scope), written.path, content);
  return written;
});

const disposeImpl = Effect.fn("HostComputer.dispose")(function* (
  memory: InMemoryComputer,
  root: string,
  scope: ComputerScope
) {
  const directory = scopeDirectory(root, scope);
  const disposed = yield* memory.dispose(scope);
  yield* Effect.tryPromise({
    try: () => rm(directory, { force: true, recursive: true }),
    catch: ioError,
  });
  return disposed;
});
