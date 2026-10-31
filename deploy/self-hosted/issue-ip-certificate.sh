#!/usr/bin/env bash
set -euo pipefail
umask 077
root_dir=/opt/little-tally
ip=43.142.19.116
install -d -m 0700 "$root_dir/tls/letsencrypt" "$root_dir/tls/work" "$root_dir/tls/logs"
install -d -m 0755 "$root_dir/tls/acme-webroot/.well-known/acme-challenge"
nginx_image=$(python3 -c 'from pathlib import Path; print(next(x.split("=",1)[1] for x in Path("/opt/little-tally/stack/.env").read_text().splitlines() if x.startswith("TALLY_NGINX_IMAGE=")))')
certbot_image=$(docker image inspect certbot/certbot:latest --format '{{index .RepoDigests 0}}')
printf '%s\n' "$certbot_image" > "$root_dir/tls/certbot-image"
cat > "$root_dir/tls/acme.conf" <<'NGINX'
server {
    listen 80;
    server_name _;
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type text/plain;
        try_files $uri =404;
    }
    location / { return 404; }
}
NGINX
if ! docker container inspect little-tally-acme >/dev/null 2>&1; then
 docker run -d --name little-tally-acme --restart unless-stopped \
  -p 0.0.0.0:80:80 \
  -v "$root_dir/tls/acme.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$root_dir/tls/acme-webroot:/var/www/certbot:ro" \
  "$nginx_image" >/dev/null
fi
printf 'tally-acme-ready\n' > "$root_dir/tls/acme-webroot/.well-known/acme-challenge/readiness"
chmod 0644 "$root_dir/tls/acme-webroot/.well-known/acme-challenge/readiness"
python3 - <<'PY'
import time,urllib.request
for attempt in range(10):
 try:
  with urllib.request.urlopen('http://127.0.0.1/.well-known/acme-challenge/readiness',timeout=2) as r:
   assert r.read()==b'tally-acme-ready\n'
  break
 except Exception:
  if attempt==9: raise
  time.sleep(1)
print('Certificate challenge endpoint is ready; application login is not served over HTTP.')
PY
if docker run --rm --pull never \
 -v "$root_dir/tls/letsencrypt:/etc/letsencrypt" \
 -v "$root_dir/tls/work:/var/lib/letsencrypt" \
 -v "$root_dir/tls/logs:/var/log/letsencrypt" \
 -v "$root_dir/tls/acme-webroot:/var/www/certbot" \
 "$certbot_image" certonly --non-interactive --agree-tos \
 --register-unsafely-without-email --preferred-profile shortlived \
 --webroot --webroot-path /var/www/certbot --ip-address "$ip" \
 --cert-name little-tally-ip-test --key-type ecdsa \
 >"$root_dir/tls/issuance.log" 2>&1; then
 openssl x509 -in "$root_dir/tls/letsencrypt/live/little-tally-ip-test/cert.pem" -noout -checkip "$ip"
 openssl x509 -in "$root_dir/tls/letsencrypt/live/little-tally-ip-test/cert.pem" -noout -checkend 172800
 openssl x509 -in "$root_dir/tls/letsencrypt/live/little-tally-ip-test/cert.pem" -noout -dates -ext subjectAltName
 printf 'Trusted IP certificate issued. Private key remains on the server.\n'
else
 printf 'Certificate issuance failed; details are retained in the private issuance log.\n'
 exit 1
fi
