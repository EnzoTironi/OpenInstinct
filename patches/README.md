# Companion patches

This Companion branch keeps Effect-native runtime patches and does **not** yet
switch Eve to the upstream `pkg.eve.dev` `0.52.2+main.59ec96cc99f65a80` pin.

## Active patchedDependencies (see `pnpm-workspace.yaml`)

- `@linqapp/chat-sdk-adapter@0.5.1` — native `replyToMessageId` delivery.
- `eve@0.49.0` — Companion Eve recovery / native-runtime cohort patch.
- `@workflow/world@5.0.0-beta.32` — workflow recovery / acceptance cohort.
- `@workflow/world-postgres@5.0.0-beta.39` — PGWorld renewable worker leases,
  generation fencing, and owner-aware Graphile completion (SIGKILL reclaim).

Native-runtime rebuild notes and manifests live under `patches/native-runtime/`.

## Parked upstream Eve patch

`eve@0.52.2+main.59ec96cc99f65a80.patch` arrived via upstream Merit-Systems sync.
It is kept in-tree for a future Effect-safe Eve upgrade, but it is **not** wired
in `patchedDependencies` while Companion remains on `eve@^0.49.0` with fencing.
