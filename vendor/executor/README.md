# Owned Executor kernel

Upstream: https://github.com/UsefulSoftwareCo/executor

Pinned revision: `f1d95f2b657316180992d5a67c24b7b76dc2b0f1`.
MIT; full license in `LICENSE`. Imported from the previously audited vendor at
`EnzoTironi/operon` revision `ec7f26386171d2eec24cf49eb425e22fa9b82fcf`.

This deliberately carries only the QuickJS runtime, code recovery, TypeScript
stripping and their original tests. It does not depend on Operon, its SDK, its
database, its MCP process or its authorization model. Import aliases are local.
The small core barrel exports only the runtime's dependencies.
Two host-side hardenings bound logs to 64 × 1,024 characters and redact dispatch
exceptions instead of logging their causes. WASM memory limits do not cover
host-side log arrays.

Zoen owns the invocation gate in `server/executor`: an explicit catalog, live
workspace authorization, bounded input/output/calls and no ambient filesystem,
network or credentials inside QuickJS. Unknown tool paths are denied; names are
never guessed to be GET/read-only. Native application actions keep their typed
Eve tools and approval contracts.

Vendor changes are kept separate from application changes. Do not upgrade this
pin incidentally. The inherited upstream tests run with the application's
Effect 4 / Vitest 4 versions.
