# Companion patches

This Companion branch uses the upstream Merit-Systems `pkg.eve.dev`
`0.52.2+main.59ec96cc99f65a80` Eve pin with a **single** Effect-safe Companion
Eve patch (not a second queue engine).

## Root pin table (fencing cohort)

| Pin                                      | Source of truth                                                            | Active artifact                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Eve `0.52.2+main.59ec96cc99f65a80`       | `package.json` → `eve` URL `https://pkg.eve.dev/59ec96cc99f65a80…/eve.tgz` | `patches/eve@0.52.2+main.59ec96cc99f65a80.patch` (wired as `eve` in `pnpm-workspace.yaml`) |
| `@workflow/world@5.0.0-beta.32`          | lockfile + patchedDependencies                                             | `patches/@workflow__world@5.0.0-beta.32.patch`                                             |
| `@workflow/world-postgres@5.0.0-beta.39` | `package.json` + patchedDependencies                                       | `patches/@workflow__world-postgres@5.0.0-beta.39.patch` (lease fencing)                    |
| `@linqapp/chat-sdk-adapter@0.5.1`        | `package.json` + patchedDependencies                                       | `patches/@linqapp__chat-sdk-adapter@0.5.1.patch`                                           |

Lockfile `patchedDependencies` hashes must match `sha256` of those patch files. App migrations run before workflow world setup: `pnpm db:migrate` then `pnpm workflow:migrate`.

## No manual Graphile unlock

After Eve 0.52 + Graphile fencing, the qualified SIGKILL path reclaims orphaned jobs via renewable worker leases / generation fencing. **Do not** call Graphile `forceUnlockWorkers` / manual unlock in the qualified recovery path; proofs record `manualUnlock: false`. See `docs/local-runtime-setup.md` (Graphile worker lease fencing).

## Active patchedDependencies (see `pnpm-workspace.yaml`)

- `@linqapp/chat-sdk-adapter@0.5.1` — native `replyToMessageId` delivery.
- `eve` (URL pin `https://pkg.eve.dev/59ec96cc99f65a80f7a2daf4ca5e2a0ad95455f2/eve.tgz`,
  identity `0.52.2+main.59ec96cc99f65a80`) —
  `patches/eve@0.52.2+main.59ec96cc99f65a80.patch`. This is one patch that
  combines:
  1. The parked upstream 0.52 Linq compiled re-export / `reply_to` mapping.
  2. Companion native-runtime recovery ported from `eve@0.49.0` via Eve source
     rebase onto `59ec96cc99f65a80f7a2daf4ca5e2a0ad95455f2`, rebuilt against the
     Companion workflow recovery tarballs (`@workflow/core@5.0.0-beta.47` with
     `recoverHookResume`). Public contracts kept:
     `recoverInputAcceptance`, keyed `inputId` acceptance, `SessionInputReceipt`,
     payload-free `recoverSessionInputReceipt` / `recoverHookResume`.
  3. P06 unstructured-forget mid-turn recall refresh: after `save_memory` /
     `remove_memory`, enqueue `PendingMemoryToolRefresh` and apply it in the tool
     loop before the next model step (`requireRefresh` fail-closed).
  4. Compiler alignment restored from Companion 0.49: `request-input` tools
     (e.g. `ask_question`) mark `runtimeEntry` so resolve-tool can load authored
     schemas after SIGKILL/cold start. Upstream 0.52 only required runtimeEntry
     when `hasExecute`.

- `@workflow/world@5.0.0-beta.32` — workflow recovery / acceptance cohort.
- `@workflow/world-postgres@5.0.0-beta.39` — PGWorld renewable worker leases,
  generation fencing, and owner-aware Graphile completion (SIGKILL reclaim).

Application Zod remains `4.5.4`. Native-runtime rebuild notes live under
`patches/native-runtime/`.

## Historical / superseded

- `eve@0.49.0.patch` — previous Companion Eve recovery patch against registry
  `eve@0.49.0`. Kept for archaeology; **not** wired while the app is on the
  0.52 URL pin.

Companion-side 0.52 public-shape notes (this branch):

- `experimental.tasks` is no longer a public compiler key (0.52 allows
  `instrumentationProviders` + `workflow` only). Native task tools remain
  framework-default; session `taskReport` / `cohortId` stay in the overlay.
- Public `eve/tools/ask_question` re-exports `ASK_QUESTION_INPUT_SCHEMA`.
- `defineDynamic({ rebindMissingCallbacks: true })` is restored on the overlay
  (0.52 stock uses `markDynamicCallbackRebind` only).
- Two `eve-cold-tool-rebind` unit fixtures are skipped: 0.52 fail-closed
  rebind requires transformed durable descriptors this helper surface does not
  stamp. Recovery APIs (`recoverInputAcceptance`, restore-turn) remain present.
