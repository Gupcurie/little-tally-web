#!/usr/bin/env bash
# Prepare an isolated Supabase installation; never publishes a public listener.
set -euo pipefail
umask 077
cd /opt/little-tally/stack
if [ -f .env ] && grep -q '^COMPOSE_FILE=.*docker-compose.ip-test.yml' .env; then
  printf 'IP HTTPS mode is already configured. Do not rerun the private-only bootstrap on this installation.\n' >&2
  exit 1
fi
if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  sh utils/generate-keys.sh --update-env > /opt/little-tally/migration/generated-secrets.log 2>&1
  python3 - <<'PY'
from pathlib import Path
p = Path('.env')
settings = {
 'SITE_URL':'http://127.0.0.1:8080',
 'SUPABASE_PUBLIC_URL':'http://127.0.0.1:8000',
 'API_EXTERNAL_URL':'http://127.0.0.1:8000/auth/v1',
 'ADDITIONAL_REDIRECT_URLS':'',
 'DISABLE_SIGNUP':'true',
 'ENABLE_PHONE_SIGNUP':'false',
 'ENABLE_ANONYMOUS_USERS':'false',
 'FUNCTIONS_VERIFY_JWT':'true',
 'SMTP_HOST':'', 'SMTP_USER':'', 'SMTP_PASS':'',
 'OPENAI_API_KEY':'',
 'PGRST_DB_SCHEMAS':'public',
 'TALLY_ALLOWED_ORIGINS':'http://127.0.0.1:8080,http://localhost:8080',
}
lines=p.read_text().splitlines()
for key,value in settings.items():
 found=False
 for i,line in enumerate(lines):
  if line.startswith(key+'='):
   lines[i]=key+'='+value;found=True
 if not found: lines.append(key+'='+value)
p.write_text('\n'.join(lines)+'\n')
p.chmod(0o600)
PY
fi
# Upstream explicitly sets COMPOSE_FILE, so include the isolation override here.
python3 - <<'PY'
from pathlib import Path
p=Path('.env')
lines=[line for line in p.read_text().splitlines() if not line.startswith('COMPOSE_FILE=')]
compose_files=['docker-compose.yml','docker-compose.override.yml']
if Path('docker-compose.web.yml').exists(): compose_files.append('docker-compose.web.yml')
lines.append('COMPOSE_FILE='+':'.join(compose_files))
p.write_text('\n'.join(lines)+'\n')
p.chmod(0o600)
PY
cat > docker-compose.override.yml <<'YAML'
name: little-tally
services:
  api-gw:
    ports: !override
      - "127.0.0.1:8000:8000"
  supavisor:
    ports: !override
      - "127.0.0.1:5432:5432"
      - "127.0.0.1:6543:6543"
  auth:
    environment:
      GOTRUE_PASSWORD_MIN_LENGTH: 6
  functions:
    environment:
      TALLY_ALLOWED_ORIGINS: ${TALLY_ALLOWED_ORIGINS}
YAML
install -d -m 0755 volumes/functions/tally-accounts
cp /opt/little-tally/app/supabase/functions/tally-accounts/index.ts volumes/functions/tally-accounts/index.ts
docker compose config --quiet
docker compose config --format json | python3 -c 'import json,sys; d=json.load(sys.stdin); ports=[(n,p.get("host_ip"),p.get("published")) for n,s in d["services"].items() for p in s.get("ports",[])]; assert ports and all(p[1]=="127.0.0.1" for p in ports),"Non-loopback port found"; print("Configuration valid. Host listeners restricted to loopback:",ports)'
printf 'Private configuration ready; no services started.\n'
