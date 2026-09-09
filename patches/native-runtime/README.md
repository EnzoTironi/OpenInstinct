# Native input recovery cohort v3

This is a new immutable delivery. It does not overwrite the earlier attachment bundle and
contains no GROUP or P06 follow-on implementation. Root installation remains root-owned.

## Install the reviewed cohort

The application applies the complete Eve 0.49.0 patch at `../eve@0.49.0.patch`.
It is a complete patch against the registry archive, not an addon to the old compiled patch.
Keep the separate Linq adapter patch. World and PostgreSQL World retain the existing acceptance
implementation and migrations 20/21; this change adds no migration or new storage engine.
The updated Core runtime is embedded inside Eve. The source rebuild generates standalone archives for verification. They are not
checked in and are not application file/tarball dependencies.

**Pin the application's direct Zod to 4.5.4 and regenerate its lock so AI SDK/gateway peers
resolve Zod 4.5.4.** The qualified external AI version is 7.0.83. Eve vendors Zod 4.5.4.
AI's asSchema dispatches vendor=zod schemas into its own Zod converter, so leaving the app at
4.4.3 mixes private converter state and fails at intersections.push before a model call.
No converter mutation, missing-array default or application workaround is included.
The native HTTP/model test now pins exactly this Zod/AI cohort. Prior source acceptance fixtures
used Zod 4.3.6; they did not qualify the application's failing 4.4.3 converter combination.

## Recovery contract

ChannelSource, ChannelAddress and Session expose:

```ts
recoverInputAcceptance(inputId, auth): Promise<SessionInputReceipt | undefined>
```

The Runtime equivalent takes `{ auth, inputId, targetToken }`. The original principal and exact
address/fixed-session namespace identify acceptance. The operation reads the actual stored
receipt, then Core's public `recoverHookResume({ runId, inputId, scope })` reads native getResume
again and validates run/id/scope. Only stored receipt data controls the wake. There is no payload
parameter, caller-supplied receipt, address-owner lookup, new event write or replacement content.

The shared native wake helper is awaited before success. A terminal canonical run returns its
receipt without publication; missing acceptance returns undefined. Missing run metadata,
receipt changes, storage errors and wake publication failures propagate as errors.

`getInputAcceptance` remains strictly read-only. After lookup, root must validate its immutable
prepared content/key, revalidate current authority and lease, call recovery, and require an
identical receipt before marking accepted. Native scope matching is not application grant
validation. Keep uncertain results uncertain. Receipt retention must cover the full recovery
lifetime: purge/restore loss still cannot be distinguished from never accepted.

Repeated recovery can enqueue multiple wakes. Native replay processes the existing accepted
input event once; this is not an exactly-once external-side-effect claim. Root's actual application
warm/cold reply assertions remain necessary and separate from this native proof.

## Sources and reproduction

- `source/eve.patch`: complete source against Eve 78fa9046b8ad377b7fdca2c6d18cd3c10afcfc77.
- `source/workflow.patch`: complete source against Workflow 2d753279d548e577a08035adeec4605c716379ef.
- `source/*-recovery-addon.patch`: exact independently reviewed deltas over 4a95477 and 6278780.
- `rebuild-from-source.sh`: the v2 source-only procedure, unchanged. It installs TS7 7.0.2 from
  registry (or uses TS7_COMPILER), builds Workflow first, and only then supplies newly generated
  archives to a fresh Eve checkout. No preexisting tarball or installed root is required.

Example from a directory containing this delivery:

```sh
recovery_inputs="$PWD"
git clone https://github.com/vercel/workflow.git workflow-source
git -C workflow-source checkout --detach 2d753279d548e577a08035adeec4605c716379ef
git -C workflow-source apply "$recovery_inputs/source/workflow.patch"
git clone https://github.com/vercel/eve.git eve-source
git -C eve-source checkout --detach 78fa9046b8ad377b7fdca2c6d18cd3c10afcfc77
git -C eve-source apply "$recovery_inputs/source/eve.patch"
bash "$recovery_inputs/rebuild-from-source.sh" ./eve-source ./workflow-source ./fresh-output
```

Validated using fresh local clones of the exact original base objects with these source patches,
Node 24.18.1, registry dependencies and existing package caches. Public remote cloning was not
separately repeated. All runtime/type/document files reproduce byte-for-byte. Expected metadata
variations are the Eve vendor cache hash (absolute checkout paths) and JSON field ordering in
Core/PG package manifests; semantic JSON is equal. No metadata was edited to imitate old hashes.

## Evidence

- `native-tests-final.log`: 21 tests, six files, 41.59 seconds; actual packaged Eve HTTP/SDK,
  real model/approval operations and PostgreSQL. A session is already waiting with zero queued
  wakes; an independently authenticated native producer commits the event and blocks on queue
  publication. SIGKILL plus termination of its exact blocked PostgreSQL backend leaves no
  published wake. Getter and foreign-principal recovery enqueue nothing. Payload-free recovery
  returns the same receipt, repeated recovery yields one consumed input/one new turn, terminal
  recovery adds no turn, and no additional user message is sent.
- `workflow-tests-final.log`: 22 tests, three files, 9.76 seconds; actual native storage and queue,
  including a separate-process payload-free recovery and decoded queued run identity.
- Earlier failed fault-injection runs are retained. A dead TCP client alone did not reliably
  cancel its blocked PostgreSQL statement; the final barrier terminates only the producer's
  identified blocked backend before releasing the table lock. Job checks decode the real
  base64 envelope so unkeyed recovery wakes cannot escape the assertion.
- `eve-types-final-proof.log`, `eve-lint-final.log`: full TS7 and changed source lint passed.
- `source-reproduction.log` and `source-reproduction-comparison.json`: fresh source build passed.
- `package-patch-verification.log`: complete compiled patch reproduces all 3,774 archive files.
- `source-verification.log`: patched source and reviewed delta match; old bundle unchanged.

See manifest.json for actual hashes and QUALITY.md for the scoped review and open structural gate.

## Checked-in inputs and local evidence

This directory contains the complete source patches, the exact reviewed additions,
the upstream delivery manifest and the reconstruction script. The application
uses registry dependencies with pnpm patches; it does not load a local tarball.
The manifest preserves hashes of the original delivery's archives and compiled
patch. `pnpm patch-commit` may normalize the application patch representation;
its actual lockfile hash is generated by pnpm. Compare extracted package contents
when verifying equivalence. Build logs and binary archives remain local evidence;
the source procedure generates new archives and records their real hashes.

The application separately reproduced the schema-conversion failure with Zod
4.4.3, then received the exact requested model reply through its normal native
private-channel path with Zod 4.5.4. Native wake tests and this application model
proof establish different properties; the combined application crash/recovery
proof failed waiting for its second response because a Graphile job remained
locked by the killed worker. Automatic accepted-input reconciliation succeeded.
See `../../docs/local-runtime-setup.md` for the separate results.
