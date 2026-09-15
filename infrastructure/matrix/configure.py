"""Render private Synapse configuration from Fly secrets, then replace this process."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re

name = os.environ["ZOEN_MATRIX_SERVER_NAME"]
config_dir = Path("/tmp/zoen-synapse")
config_dir.mkdir(mode=0o700, exist_ok=True)
seed = hashlib.sha256(os.environ["ZOEN_MATRIX_SIGNING_SECRET"].encode()).digest()
key = config_dir / "signing.key"
key.write_text("ed25519 zoen1 " + base64.b64encode(seed).decode().rstrip("=") + "\n")
key.chmod(0o600)
registration = {
    "id": "zoen", "url": os.environ["ZOEN_MATRIX_CALLBACK_URL"],
    "as_token": os.environ["ZOEN_MATRIX_AS_TOKEN"], "hs_token": os.environ["ZOEN_MATRIX_HS_TOKEN"],
    "sender_localpart": "_zoen_bot", "rate_limited": True,
    "namespaces": {
        "users": [{"exclusive": True, "regex": "^@_zoen_.*:" + re.escape(name) + "$"}],
        "aliases": [{"exclusive": True, "regex": "^#_zoen_room_.*:" + re.escape(name) + "$"}],
        "rooms": [],
    },
}
registration_path = config_dir / "application-service.yaml"
registration_path.write_text(json.dumps(registration))
registration_path.chmod(0o600)
app_service_files = [str(registration_path)]
whatsapp_as = os.environ.get("ZOEN_WHATSAPP_AS_TOKEN")
whatsapp_hs = os.environ.get("ZOEN_WHATSAPP_HS_TOKEN")
whatsapp_url = os.environ.get("ZOEN_WHATSAPP_CALLBACK_URL")
if whatsapp_as and whatsapp_hs and whatsapp_url:
    whatsapp_registration = {
        "id": "whatsapp", "url": whatsapp_url,
        "as_token": whatsapp_as, "hs_token": whatsapp_hs,
        "sender_localpart": "whatsappbot", "rate_limited": False,
        "namespaces": {
            "users": [{"exclusive": True, "regex": "^@whatsapp_.*:" + re.escape(name) + "$"}],
            "aliases": [{"exclusive": True, "regex": "^#whatsapp_.*:" + re.escape(name) + "$"}],
            "rooms": [],
        },
    }
    whatsapp_path = config_dir / "whatsapp-application-service.yaml"
    whatsapp_path.write_text(json.dumps(whatsapp_registration))
    whatsapp_path.chmod(0o600)
    app_service_files.append(str(whatsapp_path))
config = {
    "server_name": name, "pid_file": str(config_dir / "homeserver.pid"),
    "signing_key_path": str(key), "report_stats": False,
    "listeners": [{"port": 8008, "tls": False, "type": "http", "bind_addresses": ["::"],
                   "resources": [{"names": ["client", "health"], "compress": False}]}],
    "database": {"name": "psycopg2", "args": {
        "host": os.environ["ZOEN_DATABASE_HOST"], "port": 5432,
        "user": "zoen_matrix", "password": os.environ["ZOEN_MATRIX_DATABASE_PASSWORD"],
        "database": "zoen_matrix", "cp_min": 1, "cp_max": 5,
    }},
    "enable_registration": False, "enable_registration_without_verification": False,
    "allow_guest_access": False, "enable_media_repo": False,
    "url_preview_enabled": False, "trusted_key_servers": [],
    "federation_domain_whitelist": [], "suppress_key_server_warning": True,
    "app_service_config_files": app_service_files,
    "caches": {"global_factor": 0.25}, "presence": {"enabled": False},
    "rc_message": {"per_second": 1, "burst_count": 10},
    "rc_invites": {"per_room": {"per_second": 5, "burst_count": 50}, "per_user": {"per_second": 5, "burst_count": 50}},
}
path = config_dir / "homeserver.yaml"
path.write_text(json.dumps(config))
path.chmod(0o600)
os.execvp("python", ["python", "-m", "synapse.app.homeserver", "--config-path", str(path)])
