# Private migration staging

This directory contains the scripts used to prepare the Tencent Lighthouse staging server. It does not change the currently published site's backend configuration.

- Upstream Supabase release: `self-hosted/v0.8.3`, commit `bc27d2661edd09a5d0b8d76ce33da6d4071a756e`.
- Application snapshot: GitHub `f8ec6ab50a56ea04842524372081f3c3f7236603`.
- Supabase Docker configuration and init files are verified against their upstream Git blob hashes before transfer.
- The official Edge router is bundled with `jose@6.2.14` to avoid runtime package downloads. The original router and dependency lockfile are retained privately alongside the deployment.

`bootstrap-private.sh` expects the reviewed upstream Docker directory at `/opt/little-tally/stack` and the application at `/opt/little-tally/app`. It generates fresh secrets on the server, includes the loopback-only Compose override explicitly, and validates every published host port before startup. Secret files, generated SQL, exports, and database volumes must never be committed or served as static files.

`prepare-import.py` reads the protected migration JSON and produces a mode-0600 SQL file. Its default is a transaction that rolls back after validating the import. `--commit` is only for the fresh target after that validation succeeds. It rejects non-empty target tables, unknown source columns, changed password hashes, and changed ledger payloads or revisions. Run psql with `ON_ERROR_STOP=1`; capture its output in a private log.

The preliminary backup is a consistent encrypted snapshot, not a completed cutover. The source service remains intact. Before switching the live site: arrange a suitable domain and HTTPS, resolve mainland hosting requirements, take a final snapshot while preventing source writes, verify imported account/data counts and isolation, then update the frontend configuration. Never expose the database, management UI, or service-role key publicly.

## Temporary IP HTTPS test

The user selected a temporary IP test instead of buying a domain. `issue-ip-certificate.sh` issues a short-lived Let's Encrypt IP certificate using a challenge-only HTTP server. Certbot 5.9.0 was resolved to `certbot/certbot@sha256:bc93cb710b413e6b456d622f9b0133b3e109c0a78c2ed9976af43d209b0a1805`. The server retains the resolved image digest for renewals; private keys and ACME account data remain in its root-only TLS directory.

`configure-ip-test.py` and `docker-compose.ip-test.yml` prepare HTTP-to-HTTPS redirects, a loopback health endpoint, and the existing restricted application routes. Only web ports 80/443 are public. `little-tally-certificate.timer` checks renewal every six hours and the host renewal script reloads Nginx only when the certificate changes.

The certificate and local HTTPS trust checks succeeded. Cloud-browser verification returned `ERR_CERT_COMMON_NAME_INVALID`; its error page could not be inspected because the browser's URL policy rejected the error-page protocol. Do not bypass that warning. The user's friend subsequently reached the IP-hosted application and its registration endpoint; the initial HTTP 403 errors were traced to the intentionally locked registration RPC and internal-only function origins.

The final encrypted source snapshot has now been synchronized and verified, preserving original account IDs, password hashes, ledgers and backup payloads. Source write and registration RPCs remain revoked to prevent split data. The target write and registration grants are restored, the public IP and legacy frontend origins are allowed, and numeric/alphabetic registration, login, saves, account isolation and relogin persistence passed against the updated service. A protected database dump was taken before enabling the target. The legacy frontend configuration is switched to this same backend.

`prepare-final-sync.py` supports transactional rollback validation and explicit commit. It requires the target application write lock, rejects a newer or conflicting target ledger, upserts original account IDs and password hashes, and verifies all source ledger and backup payloads. Complete the last source snapshot and verification before restoring the new site's write grants or updating the live frontend configuration.

## Proxied API returned 502 after the gateway container was recreated

Symptom: registration and login failed with the generic "registration did not finish" message; `https://43.142.19.116/functions/v1/tally-accounts` returned an HTML `502 Bad Gateway`, while `http://127.0.0.1:8000/functions/v1/tally-accounts` still answered correctly. Nginx logged `connect() failed (111: Connection refused) while connecting to upstream`.

Cause: `proxy_pass http://api-gw:8000;` names a host, and nginx resolves that name once while loading the configuration, then keeps the address forever. Recreating the `api-gw` (Envoy) container changed its Docker IP from `172.18.0.4` to `172.18.0.5`, so nginx kept dialling the dead address. Nothing was wrong with the password rules, the phone, or the network.

Fix: the API gateway is now reached through an upstream that re-resolves at run time via Docker's embedded DNS. `private-web.conf` (and therefore the generated `ip-test-web.conf`) contains:

```nginx
resolver 127.0.0.11 valid=10s ipv6=off;

upstream tally_api_gw {
    zone tally_api_gw 64k;
    server api-gw:8000 resolve;
}
```

and every proxied location uses `proxy_pass http://tally_api_gw;` — the same request URI, query string, `Host`, `X-Forwarded-For` and `X-Forwarded-Proto` behaviour as before, and the same `404` for `/auth/v1/admin/` and any `/functions/` path other than `tally-accounts`. `resolve` needs nginx 1.27.3 or newer; the deployed image is pinned to nginx 1.30.6.

Rules for future changes:

- Never write a container IP into these files, and never let a `proxy_pass` inside the proxied locations name `api-gw:8000` literally again — that reintroduces the stale-address failure.
- `private-web.conf` is the source of truth; `configure-ip-test.py` derives `ip-test-web.conf` from it, so a fix applied to one file only will survive regeneration only if it is in the source.
- After editing either file run `docker compose exec -T web nginx -t`, then `docker compose exec -T web nginx -s reload` (a reload re-reads the configuration; it does not drop connections).
- Keep `/auth/v1/admin/` unreachable from the public entry. Administrator calls belong on the loopback gateway.

Verification that was actually performed: `smoke-test-https.py` runs the registration, login, save, retry, revision-conflict, isolation, logout and re-login checks through the real HTTPS entry with certificate verification, and keeps the administrator calls on `127.0.0.1:8000`. A separate isolated probe recreated a container behind both the old literal `proxy_pass` and the new resolved upstream: the old form returned `502` for the rest of the run, the new form recovered within ten seconds and stayed healthy.

Still not verified: how the certificate renewal behaves at a real expiry, and browser/device behaviour across models. Do not claim those are covered.

## Account console

`deploy/admin/` is a small container that serves the administrator console at
`https://43.142.19.116/admin/`. It lists accounts with registration time, last
sign-in, ban state and ledger usage, and can disable/re-enable an account, issue
a one-time new password and show an audit trail.

It holds the `service_role` key server-side only; the browser receives neither
that key nor any other secret. Administrator password = PBKDF2-HMAC-SHA256 hash
in `admin.env` (0600), login limited to 8 failures per 15 minutes per IP,
signed `HttpOnly; Secure; SameSite=Strict` session cookie, `X-CSRF` required for
every mutating call, and a strict CSP plus `noindex`/`no-store` on `/admin/`.

Operational notes:

- `private-web.conf` carries the `tally_admin_gw` upstream and the `/admin/`
  location. Regenerating the config from a template that lacks them silently
  removes the console (and the site keeps working, so the loss is easy to miss).
- The first password is written to `/opt/little-tally/admin/admin-password.txt`
  (0600); delete it after memorising. Rotate with
  `cd /opt/little-tally/admin && ./set-password.sh`.
- `admin.env` must never be committed; only hashes and generated secrets live
  there.
- The console reaches Supabase over the internal network, so it survives an
  `api-gw` recreation exactly like the public entry does.
- Deleting accounts is deliberately not implemented: disabling keeps user data
  recoverable.
