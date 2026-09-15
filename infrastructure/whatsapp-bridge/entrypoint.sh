#!/bin/bash
set -euo pipefail
umask 077
: "${ZOEN_WHATSAPP_HOMESERVER_ADDRESS:?Homeserver address is required}"
: "${ZOEN_WHATSAPP_HOMESERVER_DOMAIN:?Homeserver domain is required}"
: "${ZOEN_DATABASE_HOST:?Database host is required}"
: "${ZOEN_WHATSAPP_DATABASE_PASSWORD:?Database password is required}"
: "${ZOEN_WHATSAPP_AS_TOKEN:?Appservice token is required}"
: "${ZOEN_WHATSAPP_HS_TOKEN:?Homeserver token is required}"
: "${ZOEN_WHATSAPP_PROVISIONING_SECRET:?Provisioning secret is required}"
: "${ZOEN_WHATSAPP_APPSERVICE_ADDRESS:?Appservice address is required}"
mkdir -p /data
if [[ ! -f /data/config.yaml ]]; then
  /usr/bin/mautrix-whatsapp -c /data/config.yaml -e
fi
export DATABASE_URI
DATABASE_URI=$(python3 -c 'import os,urllib.parse; print("postgres://zoen_whatsapp:"+urllib.parse.quote(os.environ["ZOEN_WHATSAPP_DATABASE_PASSWORD"],safe="")+"@"+os.environ["ZOEN_DATABASE_HOST"]+":5432/zoen_whatsapp?sslmode=disable")')
yq -I2 e -i '
  .homeserver.address = strenv(ZOEN_WHATSAPP_HOMESERVER_ADDRESS) |
  .homeserver.domain = strenv(ZOEN_WHATSAPP_HOMESERVER_DOMAIN) |
  .appservice.address = strenv(ZOEN_WHATSAPP_APPSERVICE_ADDRESS) |
  .appservice.hostname = "0.0.0.0" |
  .appservice.port = 29318 |
  .appservice.id = "whatsapp" |
  .appservice.bot.username = "whatsappbot" |
  .appservice.as_token = strenv(ZOEN_WHATSAPP_AS_TOKEN) |
  .appservice.hs_token = strenv(ZOEN_WHATSAPP_HS_TOKEN) |
  .database.type = "postgres" |
  .database.uri = strenv(DATABASE_URI) |
  .provisioning.shared_secret = strenv(ZOEN_WHATSAPP_PROVISIONING_SECRET) |
  .provisioning.debug_endpoints = false |
  .encryption.allow = false |
  .encryption.default = false |
  .encryption.require = false |
  .logging.min_level = "warn"
' /data/config.yaml
python3 - <<'PY'
import json, os, re
from pathlib import Path
name = os.environ["ZOEN_WHATSAPP_HOMESERVER_DOMAIN"]
registration = {
    "id": "whatsapp",
    "url": os.environ["ZOEN_WHATSAPP_APPSERVICE_ADDRESS"],
    "as_token": os.environ["ZOEN_WHATSAPP_AS_TOKEN"],
    "hs_token": os.environ["ZOEN_WHATSAPP_HS_TOKEN"],
    "sender_localpart": "whatsappbot",
    "rate_limited": False,
    "namespaces": {
        "users": [{"exclusive": True, "regex": "^@whatsapp_.*:" + re.escape(name) + "$"}],
        "aliases": [{"exclusive": True, "regex": "^#whatsapp_.*:" + re.escape(name) + "$"}],
        "rooms": [],
    },
}
path = Path("/data/registration.yaml")
path.write_text(json.dumps(registration))
path.chmod(0o600)
PY
chown -R 1337:1337 /data
exec su-exec 1337:1337 /usr/bin/mautrix-whatsapp -n -c /data/config.yaml -r /data/registration.yaml
