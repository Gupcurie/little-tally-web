#!/usr/bin/env bash
# Set (or rotate) the administrator password for the account console.
# Usage:  sudo ./set-password.sh            (prompts, twice)
#         sudo ./set-password.sh --random   (generates and prints once)
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE=admin.env
[ -f "$ENV_FILE" ] || { echo "admin.env not found - run deploy.sh first"; exit 1; }

if [ "${1:-}" = "--random" ]; then
  PW=$(python3 -c "import secrets,string;a=string.ascii_letters+string.digits;print(''.join(secrets.choice(a) for _ in range(24)))")
else
  read -rsp "New admin password (min 16 chars): " PW; echo
  read -rsp "Repeat: " PW2; echo
  [ "$PW" = "$PW2" ] || { echo "passwords differ"; exit 1; }
fi

case ${#PW} in
  ''|0|1|2|3|4|5|6|7|8|9|10|11|12|13|14|15) echo "password must be at least 16 characters"; exit 1;;
esac

export PW
HASH=$(python3 - <<'PY'
import hashlib, os, secrets
pw = os.environ['PW'].encode()
salt = secrets.token_bytes(16)
digest = hashlib.pbkdf2_hmac('sha256', pw, salt, 210000)
print('pbkdf2_sha256$210000$%s$%s' % (salt.hex(), digest.hex()))
PY
)

python3 - "$ENV_FILE" "$HASH" <<'PY'
import sys
path, value = sys.argv[1], sys.argv[2]
lines = [l for l in open(path, encoding='utf-8').read().splitlines() if not l.startswith('ADMIN_PASSWORD_HASH=')]
lines.append('ADMIN_PASSWORD_HASH=' + value)
open(path, 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
PY
chmod 600 "$ENV_FILE"

docker compose up -d --force-recreate admin >/dev/null 2>&1 || docker compose up -d --force-recreate >/dev/null
echo "password updated; container restarted"
[ "${1:-}" = "--random" ] && echo "password: $PW"
exit 0
