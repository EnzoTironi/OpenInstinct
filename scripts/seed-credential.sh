#!/bin/sh
# A retained volume preserves refreshed OAuth credentials. Only a changed deployment
# secret intentionally replaces them. Read the secret from stdin, never arguments.
set -eu
umask 077
credential_path=$1
mkdir -p "$(dirname "$credential_path")"
seed_temp=$(mktemp "$credential_path.seed.XXXXXX")
trap 'rm -f "$seed_temp" "$seed_temp.digest"' EXIT HUP INT TERM
cat > "$seed_temp"
# Node is available in every application image and on supported development hosts.
node -e 'const fs = require("node:fs"); const crypto = require("node:crypto"); fs.writeFileSync(process.argv[2], crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"), { mode: 0o600 });' "$seed_temp" "$seed_temp.digest"
if [ ! -s "$credential_path" ] || ! cmp -s "$seed_temp.digest" "$credential_path.seed-digest"; then
  mv "$seed_temp" "$credential_path"
  mv "$seed_temp.digest" "$credential_path.seed-digest"
fi
