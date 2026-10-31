#!/usr/bin/env bash
# First-run setup for the account console: build, configure secrets, start.
set -euo pipefail
cd "$(dirname "$0")"
STACK=/opt/little-tally/stack

[ -f server.py ] || { echo "server.py missing"; exit 1; }
[ -f /opt/little-tally/stack/.env ] || { echo "stack/.env missing"; exit 1; }

mkdir -p data
# the container runs as uid 10001 and must be able to append the audit log
chown 10001:10001 data 2>/dev/null || true
chmod 700 data

if [ ! -f admin.env ]; then
  SERVICE_ROLE_KEY=$(grep -m1 '^SERVICE_ROLE_KEY=' "$STACK/.env" | cut -d= -f2-)
  [ -n "$SERVICE_ROLE_KEY" ] || { echo "SERVICE_ROLE_KEY not found in stack/.env"; exit 1; }

  SESSION_SECRET=$(python3 -c "import secrets;print(secrets.token_hex(32))")
  PW=$(python3 -c "import secrets,string;a=string.ascii_letters+string.digits;print(''.join(secrets.choice(a) for _ in range(28)))")
  HASH=$(PW="$PW" python3 -c "
import hashlib, os, secrets
pw = os.environ['PW'].encode()
salt = secrets.token_bytes(16)
print('pbkdf2_sha256\$210000\$%s\$%s' % (salt.hex(), hashlib.pbkdf2_hmac('sha256', pw, salt, 210000).hex()))
")

  umask 077
  cat > admin.env <<EOF
SUPABASE_URL=http://api-gw:8000
SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
SESSION_SECRET=$SESSION_SECRET
ADMIN_PASSWORD_HASH=$HASH
DATA_DIR=/data
SESSION_TTL=43200
EOF
  chmod 600 admin.env
  printf '%s\n' "$PW" > admin-password.txt
  chmod 600 admin-password.txt
  echo "generated admin.env and a first password"
else
  echo "admin.env exists, keeping it"
fi

docker compose build --quiet 2>&1 | tail -3 || docker compose build
docker compose up -d 2>&1 | tail -5
sleep 3

echo "-- container --"
docker compose ps --format 'table {{.Name}}\t{{.Status}}'
echo "-- health --"
docker exec tally-admin python3 -c "import socket;s=socket.create_connection(('127.0.0.1',8080),2);s.close();print('LISTENING')" 2>&1
echo "-- reachable from the web container --"
docker exec little-tally-web sh -c 'getent hosts tally-admin' 2>&1
