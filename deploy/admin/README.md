# Account console (账号管理后台)

A small self-hosted console for looking after 小小记 accounts. It runs as its own
container on the private Docker network and is published by nginx under
`https://43.142.19.116/admin/` only.

What it does:

- lists every account: username, registration time, last sign-in, status,
  ledger revision, last save, item and record counts;
- per-account detail with the item names and current counts of both books;
- disable / re-enable an account (data is never deleted);
- issue a new password for an account, shown once;
- writes an audit trail of logins, bans, unbans and password resets.

## How it stays safe

- The `service_role` key lives only in `admin.env` (mode 0600) inside the
  container; the browser never receives it, and the API responses are checked
  for it.
- The administrator password is stored as PBKDF2-HMAC-SHA256 (210k rounds,
  per-install salt). Only a hash is kept in `admin.env`.
- Login is rate limited to 8 failures per 15 minutes per client IP.
- The session cookie is `HttpOnly; Secure; SameSite=Strict`, signed with
  `SESSION_SECRET`, valid 12 hours.
- Every mutating call needs the `X-CSRF` header that matches the signed session
  and must come from the same Origin.
- nginx adds a strict CSP, `X-Frame-Options: DENY`, `noindex` and `no-store`
  for `/admin/`.
- The container runs read-only, without capabilities, as a non-root user, and
  the database, Studio and `/auth/v1/admin/` remain unreachable from outside.

## First login

The first password is generated during `deploy.sh` and written to
`admin-password.txt` (mode 0600). Read it on the server, log in, then delete the
file once it is memorised:

```bash
cat /opt/little-tally/admin/admin-password.txt
```

## Rotating the password

```bash
cd /opt/little-tally/admin
./set-password.sh            # prompts twice, needs 16+ characters
./set-password.sh --random   # generates 24 characters and prints them once
```

Both restart the container; the old sessions stop working only after they
expire, so revoke by rotating if a laptop is lost.

## Layout

```
/opt/little-tally/admin/
  server.py            HTTP service + Supabase calls (standard library only)
  static/              login page, console page, css, js
  docker-compose.yml   project "admin", joins little-tally_default
  admin.env            0600, holds the service key, session secret, password hash
  admin-password.txt   0600, first password, delete after memorising
  data/audit.jsonl     audit trail, 0600, owned by uid 10001
```

`admin.env` is not in this repository and must never be committed.

## Redeploy after changing the code

```bash
cd /opt/little-tally/admin
docker compose build && docker compose up -d
```

## Endpoints the console uses

- `GET  /auth/v1/admin/users` (loopback api-gw) — account list
- `PUT  /auth/v1/admin/users/<id>` — ban / unban / password change
- `GET  /rest/v1/tally_ledgers` — ledger usage statistics

nginx exposes only `/admin/`; the console talks to the gateway over the internal
Docker network (`http://api-gw:8000`), so it is unaffected when that container
is recreated and its IP changes.
