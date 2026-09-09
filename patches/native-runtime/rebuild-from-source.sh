#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == --help ]]; then
  cat <<'HELP'
Usage: rebuild-from-source.sh EVE_SOURCE WORKFLOW_SOURCE NEW_OUTPUT

Build the patched native packages in fresh source checkouts, without input tarballs.
Requires bash, git, Node 24+, npm, and registry access. Sources must already have
our full source patches applied (or be checked out at the composition commits),
including workflow-lease-fencing-addon.patch after the recovery workflow patch when present.
NEW_OUTPUT must not exist. Both source trees must have no node_modules or prior
.acceptance-packages. This script installs dependencies and writes build output
and an updated Eve lockfile only in those disposable source trees.

Optional: TS7_COMPILER=/absolute/path/to/tsc uses an existing TypeScript 7.0.2
compiler read-only; otherwise that exact compiler is installed from npm.

Example:
  ./rebuild-from-source.sh ./eve-source ./workflow-source ./native-build-v2

Results: NEW_OUTPUT/packages/*.tgz, packages.sha256, logs, toolchain lockfiles,
and the refreshed Eve lockfile. Existing artifact bundles are never read.
HELP
  exit 0
fi
if [[ $# != 3 ]]; then
  echo 'Usage: rebuild-from-source.sh EVE_SOURCE WORKFLOW_SOURCE NEW_OUTPUT (see --help)' >&2
  exit 2
fi
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Node 24+ required")'
eve_source=$(cd "$1" && pwd)
workflow_source=$(cd "$2" && pwd)
if [[ -e "$3" ]]; then
  echo "Output already exists; choose a new directory: $3" >&2
  exit 2
fi
for source in "$eve_source" "$workflow_source"; do
  if [[ -e "$source/node_modules" || -e "$source/.acceptance-packages" ]]; then
    echo "Use a fresh checkout without node_modules or .acceptance-packages: $source" >&2
    exit 2
  fi
done
for manifest in "$eve_source/packages/eve/package.json" "$workflow_source/packages/core/package.json"; do
  test -f "$manifest" || { echo "Missing source manifest: $manifest" >&2; exit 2; }
done
mkdir -p "$3"
output_dir=$(cd "$3" && pwd)
mkdir -p "$output_dir/packages" "$output_dir/logs" "$output_dir/toolchain"
exec > >(tee "$output_dir/logs/rebuild.log") 2>&1
trap 'echo "Rebuild failed at line $LINENO; logs and partial output retained in $output_dir" >&2' ERR
export CI=true

# The compiler is independent of Eve and therefore needs no native input archive.
if [[ -n "${TS7_COMPILER:-}" ]]; then
  compiler="$TS7_COMPILER"
  [[ "$compiler" == /* ]] || { echo 'TS7_COMPILER must be absolute' >&2; exit 2; }
else
  npm install --prefix "$output_dir/toolchain/compiler" --registry=https://registry.npmjs.org/ --no-audit --no-fund --save-exact typescript@7.0.2
  compiler="$output_dir/toolchain/compiler/node_modules/.bin/tsc"
fi
[[ "$("$compiler" --version)" == 'Version 7.0.2' ]] || { echo 'TypeScript 7.0.2 required' >&2; exit 2; }
node --version
"$compiler" --version
# Use each upstream's exact package-manager version, without global installation.
npm install --prefix "$output_dir/toolchain/workflow" --registry=https://registry.npmjs.org/ --no-audit --no-fund --save-exact pnpm@10.20.0
npm install --prefix "$output_dir/toolchain/eve" --registry=https://registry.npmjs.org/ --no-audit --no-fund --save-exact pnpm@11.21.0
original_path="$PATH"
export PATH="$output_dir/toolchain/workflow/node_modules/.bin:$original_path"
(cd "$workflow_source" && pnpm install --filter @workflow/core... --filter @workflow/world-postgres... --frozen-lockfile)
for package in utils errors serde world world-local world-vercel core world-postgres; do
  case "$package" in
    world-vercel|core) (cd "$workflow_source/packages/$package" && ./node_modules/.bin/genversion --es6 src/version.ts) ;;
  esac
  if [[ "$package" == core ]]; then
    (cd "$workflow_source/packages/core" && node scripts/build-quickjs-assets.js)
  fi
  "$compiler" -p "$workflow_source/packages/$package/tsconfig.json"
done
for package in world core world-postgres; do
  (cd "$workflow_source/packages/$package" && pnpm pack --pack-destination "$output_dir/packages")
done

# These are outputs of this run, not prerequisites from an earlier bundle.
mkdir "$eve_source/.acceptance-packages"
cp "$output_dir"/packages/workflow-*.tgz "$eve_source/.acceptance-packages/"
export PATH="$output_dir/toolchain/eve/node_modules/.bin:$original_path"
# Existing lock integrity refers to the old local archive bytes. Refresh it only
# after producing all inputs locally; save the resulting lock as build evidence.
(cd "$eve_source" && pnpm install --filter eve... --no-frozen-lockfile)
[[ "$("$eve_source/node_modules/.bin/tsc" --version)" == 'Version 7.0.2' ]] || { echo 'Eve did not resolve TS7' >&2; exit 2; }
(cd "$eve_source" && pnpm --filter @eve/catalog build)
# Eve prepack performs the complete native vendor, TS7, JS and docs build once.
(cd "$eve_source/packages/eve" && pnpm pack --pack-destination "$output_dir/packages")
cp "$eve_source/pnpm-lock.yaml" "$output_dir/eve-resolved-lock.yaml"
node --input-type=module - "$output_dir" <<'JS'
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const output = process.argv[2];
const packages = readdirSync(join(output, 'packages')).filter(name => name.endsWith('.tgz')).sort();
if (packages.length !== 4) throw new Error(`Expected four generated packages, found ${packages.length}`);
writeFileSync(join(output, 'packages.sha256'), packages.map(name => `${createHash('sha256').update(readFileSync(join(output, 'packages', name))).digest('hex')}  packages/${name}\n`).join(''));
JS
printf 'Build complete: %s/packages.sha256\n' "$output_dir"
