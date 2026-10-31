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
