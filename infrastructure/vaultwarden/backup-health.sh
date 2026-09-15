#!/bin/bash
set -euo pipefail
umask 077
snapshots=$(restic snapshots --host zoen-vaultwarden --tag quiesced --json)
python3 -c '
import datetime,json,sys,time
from pathlib import Path
snapshots=json.load(sys.stdin)
latest=max((datetime.datetime.fromisoformat(s["time"]).timestamp() for s in snapshots),default=0)
failed=Path("/data/backup-status/failed")
last_failure=int(failed.read_text()) if failed.exists() else 0
fresh=time.time()-latest < 26*3600 and last_failure < latest
print(json.dumps({"ok":fresh,"snapshots":len(snapshots),"last_backup_epoch":int(latest)}))
sys.exit(0 if fresh else 1)
' <<< "$snapshots"
df -Pk /data | awk 'NR == 2 { if ($5 + 0 >= 85) { print "Vault volume is at least 85% full" > "/dev/stderr"; exit 1 } }'
