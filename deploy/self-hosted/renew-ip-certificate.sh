#!/usr/bin/env bash
set -euo pipefail
umask 077
exec 9>/run/lock/little-tally-certificate.lock
flock -n 9 || exit 0
root_dir=/opt/little-tally
image=$(cat "$root_dir/tls/certbot-image")
before=$(sha256sum "$root_dir/tls/letsencrypt/live/little-tally-ip-test/fullchain.pem" | cut -d' ' -f1)
docker run --rm --pull never \
 -v "$root_dir/tls/letsencrypt:/etc/letsencrypt" \
 -v "$root_dir/tls/work:/var/lib/letsencrypt" \
 -v "$root_dir/tls/logs:/var/log/letsencrypt" \
 -v "$root_dir/tls/acme-webroot:/var/www/certbot" \
 "$image" renew --non-interactive --cert-name little-tally-ip-test --quiet
after=$(sha256sum "$root_dir/tls/letsencrypt/live/little-tally-ip-test/fullchain.pem" | cut -d' ' -f1)
if [ "$before" != "$after" ]; then
 cd "$root_dir/stack"
 docker compose exec -T web nginx -t </dev/null
 docker compose exec -T web nginx -s reload </dev/null
fi
openssl x509 -in "$root_dir/tls/letsencrypt/live/little-tally-ip-test/cert.pem" -noout -checkend 86400
