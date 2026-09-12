#!/bin/sh
# Build the same Operon revision for CI, local integration, and the hosted image.
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: sh scripts/prepare-operon.sh <new-checkout-directory>" >&2
  exit 2
fi

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
revision=$(cat "$repo_root/operon.lock")
case "$revision" in
  ''|*[!0-9a-f]*) echo "operon.lock must contain a full commit SHA" >&2; exit 2 ;;
esac
if [ "${#revision}" -ne 40 ]; then
  echo "operon.lock must contain a full commit SHA" >&2
  exit 2
fi

destination=$1
if [ -e "$destination" ]; then
  echo "Choose a new checkout directory; the destination already exists" >&2
  exit 2
fi

git init --quiet "$destination"
GIT_TERMINAL_PROMPT=0 git -C "$destination" fetch --quiet --depth=1 \
  https://github.com/EnzoTironi/operon.git "$revision"
git -C "$destination" checkout --quiet --detach FETCH_HEAD
test "$(git -C "$destination" rev-parse HEAD)" = "$revision"

cd "$destination"
# Corepack respects Operon's own packageManager instead of Zoen's pnpm version.
corepack pnpm install --frozen-lockfile
corepack pnpm --filter '@operon/cli...' run build
