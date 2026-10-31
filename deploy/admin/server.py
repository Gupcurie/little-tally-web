#!/usr/bin/env python3
"""Little Tally - account administration service.

Runs inside its own container on the private Docker network; nginx publishes it
under /admin/ only. The service_role key stays here and is never sent to the
browser. Standard library only, so the image needs no package installs.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SUPABASE_URL = os.environ['SUPABASE_URL'].rstrip('/')
SERVICE_KEY = os.environ['SERVICE_ROLE_KEY']
PASSWORD_HASH = os.environ['ADMIN_PASSWORD_HASH']
SESSION_SECRET = os.environ['SESSION_SECRET'].encode()
DATA_DIR = os.environ.get('DATA_DIR', '/data')
STATIC_DIR = os.environ.get('STATIC_DIR', '/app/static')
SESSION_TTL = int(os.environ.get('SESSION_TTL', str(12 * 3600)))
PORT = int(os.environ.get('PORT', '8080'))

LOGIN_WINDOW = 900
LOGIN_MAX_FAILS = 8
_lock = threading.Lock()
_fails = {}
_audit_lock = threading.Lock()

NEW_PASSWORD_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def b64e(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode()


def b64d(text):
    pad = '=' * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)


def verify_password(password, stored):
    try:
        algo, iters, salt_hex, hash_hex = stored.strip().split('$')
        if algo != 'pbkdf2_sha256':
            return False
        digest = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt_hex), int(iters))
        return hmac.compare_digest(digest.hex(), hash_hex)
    except Exception:
        return False


def make_session():
    claims = {'sid': secrets.token_hex(12), 'exp': int(time.time()) + SESSION_TTL,
              'csrf': secrets.token_hex(16)}
    body = b64e(json.dumps(claims, separators=(',', ':')).encode())
    sig = hmac.new(SESSION_SECRET, body.encode(), hashlib.sha256).hexdigest()
    return body + '.' + sig, claims


def read_session(token):
    if not token or '.' not in token:
        return None
    body, sig = token.rsplit('.', 1)
    expect = hmac.new(SESSION_SECRET, body.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expect):
        return None
    try:
        claims = json.loads(b64d(body))
    except Exception:
        return None
    if not isinstance(claims, dict) or claims.get('exp', 0) < time.time():
        return None
    return claims


def supabase(path, method='GET', body=None):
    url = SUPABASE_URL + path
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers={
        'apikey': SERVICE_KEY,
        'Authorization': 'Bearer ' + SERVICE_KEY,
        'Content-Type': 'application/json',
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            payload = json.loads(raw) if raw else None
        except ValueError:
            payload = None
        return exc.code, payload
    except Exception:
        return 0, None


def audit(action, target_id='', target_name='', ip='', result='ok', note=''):
    record = {'ts': int(time.time()), 'action': action, 'target_id': target_id,
              'target_name': target_name, 'ip': ip, 'result': result, 'note': note}
    path = os.path.join(DATA_DIR, 'audit.jsonl')
    line = json.dumps(record, ensure_ascii=False)
    with _audit_lock:
        try:
            os.makedirs(DATA_DIR, exist_ok=True)
            with open(path, 'a', encoding='utf-8') as fh:
                fh.write(line + '\n')
            with open(path, 'r', encoding='utf-8') as fh:
                lines = fh.readlines()
            if len(lines) > 2000:
                with open(path, 'w', encoding='utf-8') as fh:
                    fh.writelines(lines[-2000:])
        except Exception:
            pass


def read_audit(limit=60):
    path = os.path.join(DATA_DIR, 'audit.jsonl')
    try:
        with open(path, 'r', encoding='utf-8') as fh:
            lines = fh.readlines()[-limit:]
    except Exception:
        return []
    out = []
    for line in lines:
        try:
            out.append(json.loads(line))
        except ValueError:
            continue
    return list(reversed(out))


def ledger_stats(payload):
    result = {}
    if not isinstance(payload, dict):
        return result
    for book in ('sales', 'stock'):
        data = payload.get(book) or {}
        items = data.get('items') or []
        records = data.get('records') or []
        totals = {}
        for rec in records:
            if rec.get('kind') == 'count' and rec.get('itemId'):
                totals[rec['itemId']] = totals.get(rec['itemId'], 0) + (rec.get('delta') or 0)
        result[book] = {
            'items': len(items),
            'records': len(records),
            'lines': [{'name': str(i.get('name') or ''), 'total': totals.get(i.get('id'), 0)}
                      for i in items][:60],
        }
    return result


def fetch_accounts():
    users = []
    page = 1
    while page <= 20:
        status, data = supabase('/auth/v1/admin/users?page=%d&per_page=200' % page)
        if status != 200 or not isinstance(data, dict):
            raise RuntimeError('user list failed: %s' % status)
        batch = data.get('users') or []
        users.extend(batch)
        if len(batch) < 200:
            break
        page += 1

    status, rows = supabase('/rest/v1/tally_ledgers?select=user_id,revision,updated_at,payload')
    ledgers = {}
    if status == 200 and isinstance(rows, list):
        for row in rows:
            ledgers[row.get('user_id')] = row

    accounts = []
    for user in users:
        meta = user.get('app_metadata') or {}
        user_id = user.get('id')
        row = ledgers.get(user_id)
        stats = ledger_stats((row or {}).get('payload')) if row else {}
        accounts.append({
            'id': user_id,
            'username': meta.get('tally_username') or '',
            'created_at': user.get('created_at'),
            'last_sign_in_at': user.get('last_sign_in_at'),
            'banned_until': user.get('banned_until'),
            'confirmed': bool(user.get('email_confirmed_at') or user.get('confirmed_at')),
            'revision': (row or {}).get('revision'),
            'ledger_updated_at': (row or {}).get('updated_at'),
            'books': stats,
            'items': sum(v['items'] for v in stats.values()) if stats else 0,
            'records': sum(v['records'] for v in stats.values()) if stats else 0,
        })
    accounts.sort(key=lambda a: (a['username'] or '~'))
    return accounts


def logins_recent(accounts, days=7):
    cutoff = time.time() - days * 86400
    count = 0
    for acc in accounts:
        value = acc.get('last_sign_in_at')
        if not value:
            continue
        try:
            stamp = datetime.strptime(value[:19], '%Y-%m-%dT%H:%M:%S').replace(
                tzinfo=timezone.utc).timestamp()
        except ValueError:
            continue
        if stamp >= cutoff:
            count += 1
    return count


def new_password():
    return ''.join(secrets.choice(NEW_PASSWORD_ALPHABET) for _ in range(12))


def client_ip(handler):
    forwarded = handler.headers.get('X-Forwarded-For', '')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return handler.headers.get('X-Real-IP', '') or 'unknown'


def mask_ip(ip):
    if re.match(r'^\d+\.\d+\.\d+\.\d+$', ip):
        parts = ip.split('.')
        return '%s.%s.***.***' % (parts[0], parts[1])
    return '***'


# --------------------------------------------------------------------------- #
# request handler
# --------------------------------------------------------------------------- #
class Handler(BaseHTTPRequestHandler):
    server_version = 'tally-admin'
    sys_version = ''

    def log_message(self, fmt, *args):  # keep stdout clean; no tokens or paths
        return

    # -- response helpers -------------------------------------------------- #
    def _json(self, status, payload):
        raw = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(raw)

    def _file(self, name, ctype):
        path = os.path.join(STATIC_DIR, name)
        try:
            with open(path, 'rb') as fh:
                raw = fh.read()
        except OSError:
            self._json(404, {'error': 'NOT_FOUND'})
            return
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(raw)

    def _redirect(self, location):
        self.send_response(302)
        self.send_header('Location', location)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def _cookies(self):
        jar = {}
        for chunk in (self.headers.get('Cookie') or '').split(';'):
            if '=' in chunk:
                key, value = chunk.split('=', 1)
                jar[key.strip()] = value.strip()
        return jar

    def _session(self):
        return read_session(self._cookies().get('admin_session'))

    def _body(self):
        try:
            length = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            return None
        if length <= 0 or length > 32768:
            return None
        try:
            return json.loads(self.rfile.read(length) or b'{}')
        except ValueError:
            return None

    def _origin_ok(self):
        origin = self.headers.get('Origin') or ''
        if not origin:
            return True
        host = self.headers.get('X-Forwarded-Host') or self.headers.get('Host') or ''
        return origin == 'https://' + host or origin == 'http://' + host

    def _csrf_ok(self, claims):
        token = self.headers.get('X-CSRF') or ''
        return bool(token) and hmac.compare_digest(token, claims.get('csrf', ''))

    # -- routing ----------------------------------------------------------- #
    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path.startswith('/admin'):
            path = path[6:]
        claims = self._session()

        if path in ('', '/'):
            if claims:
                self._file('index.html', 'text/html; charset=utf-8')
            else:
                self._file('login.html', 'text/html; charset=utf-8')
            return
        if path == '/favicon.ico':
            self._json(204, {})
            return
        if path.startswith('/static/'):
            name = path[len('/static/'):]
            if not re.match(r'^[A-Za-z0-9._-]+$', name):
                self._json(404, {'error': 'NOT_FOUND'})
                return
            ctype = 'text/css; charset=utf-8' if name.endswith('.css') else 'application/javascript; charset=utf-8'
            self._file(name, ctype)
            return

        if not path.startswith('/api/'):
            self._json(404, {'error': 'NOT_FOUND'})
            return

        if path == '/api/session':
            if claims:
                self._json(200, {'authenticated': True, 'csrf': claims['csrf']})
            else:
                self._json(401, {'authenticated': False})
            return
        if not claims:
            self._json(401, {'error': 'UNAUTHENTICATED'})
            return

        if path == '/api/accounts':
            try:
                accounts = fetch_accounts()
            except Exception:
                self._json(503, {'error': 'BACKEND_UNAVAILABLE'})
                return
            active = [a for a in accounts if not a['banned_until']]
            self._json(200, {
                'accounts': accounts,
                'summary': {
                    'total': len(accounts),
                    'active': len(active),
                    'banned': len(accounts) - len(active),
                    'with_ledger': sum(1 for a in accounts if a['revision'] is not None),
                    'items': sum(a['items'] for a in accounts),
                    'records': sum(a['records'] for a in accounts),
                    'signed_in_7d': logins_recent(accounts),
                },
                'generated_at': int(time.time()),
            })
            return

        if path == '/api/audit':
            entries = read_audit()
            for entry in entries:
                entry['ip'] = mask_ip(entry.get('ip') or '')
            self._json(200, {'entries': entries})
            return

        self._json(404, {'error': 'NOT_FOUND'})

    def do_POST(self):
        path = self.path.split('?', 1)[0]
        if path.startswith('/admin'):
            path = path[6:]
        if not path.startswith('/api/'):
            self._json(404, {'error': 'NOT_FOUND'})
            return
        if not self._origin_ok():
            self._json(403, {'error': 'ORIGIN_NOT_ALLOWED'})
            return

        if path == '/api/login':
            self._login()
            return

        claims = self._session()
        if not claims:
            self._json(401, {'error': 'UNAUTHENTICATED'})
            return
        if not self._csrf_ok(claims):
            self._json(403, {'error': 'CSRF_REJECTED'})
            return

        if path == '/api/logout':
            audit('logout', ip=client_ip(self))
            self._expire_cookies()
            return

        match = re.match(r'^/api/accounts/([0-9a-fA-F-]{36})/(ban|password)$', path)
        if not match:
            self._json(404, {'error': 'NOT_FOUND'})
            return

        user_id, action = match.group(1), match.group(2)
        body = self._body() or {}
        accounts = None
        try:
            accounts = fetch_accounts()
        except Exception:
            self._json(503, {'error': 'BACKEND_UNAVAILABLE'})
            return
        target = next((a for a in accounts if a['id'] == user_id), None)
        if not target:
            self._json(404, {'error': 'ACCOUNT_NOT_FOUND'})
            return
        name = target['username'] or user_id[:8]
        ip = client_ip(self)

        if action == 'ban':
            banned = bool(body.get('banned'))
            duration = '876000h' if banned else 'none'
            status, data = supabase('/auth/v1/admin/users/' + user_id, 'PUT', {'ban_duration': duration})
            if status != 200:
                audit('ban' if banned else 'unban', user_id, name, ip, 'failed')
                self._json(400, {'error': 'UPDATE_FAILED'})
                return
            audit('ban' if banned else 'unban', user_id, name, ip)
            self._json(200, {'ok': True, 'banned': bool((data or {}).get('banned_until'))})
            return

        password = body.get('password')
        if password is not None:
            if not isinstance(password, str) or not (6 <= len(password) <= 128):
                self._json(400, {'error': 'WEAK_PASSWORD'})
                return
        else:
            password = new_password()
        status, _ = supabase('/auth/v1/admin/users/' + user_id, 'PUT', {'password': password})
        if status != 200:
            audit('reset_password', user_id, name, ip, 'failed')
            self._json(400, {'error': 'UPDATE_FAILED'})
            return
        audit('reset_password', user_id, name, ip)
        self._json(200, {'ok': True, 'password': password})
        return

    # -- login ------------------------------------------------------------- #
    def _login(self):
        ip = client_ip(self)
        now = time.time()
        with _lock:
            attempts = [t for t in _fails.get(ip, []) if now - t < LOGIN_WINDOW]
            _fails[ip] = attempts
            if len(attempts) >= LOGIN_MAX_FAILS:
                self._json(429, {'error': 'TOO_MANY_ATTEMPTS'})
                return
        body = self._body() or {}
        password = body.get('password')
        if not isinstance(password, str) or not verify_password(password, PASSWORD_HASH):
            with _lock:
                _fails.setdefault(ip, []).append(now)
            audit('login', ip=ip, result='failed')
            self._json(401, {'error': 'INVALID_PASSWORD'})
            return
        with _lock:
            _fails[ip] = []
        token, claims = make_session()
        cookie = ('admin_session=%s; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=%d'
                  % (token, SESSION_TTL))
        csrf = ('admin_csrf=%s; Path=/admin; Secure; SameSite=Strict; Max-Age=%d'
                % (claims['csrf'], SESSION_TTL))
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Set-Cookie', cookie)
        self.send_header('Set-Cookie', csrf)
        raw = json.dumps({'ok': True, 'csrf': claims['csrf']}).encode()
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)
        audit('login', ip=ip)

    def _expire_cookies(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Set-Cookie', 'admin_session=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0')
        self.send_header('Set-Cookie', 'admin_csrf=; Path=/admin; Secure; SameSite=Strict; Max-Age=0')
        self.send_header('Content-Length', '2')
        self.end_headers()
        self.wfile.write(b'{}')


def main():
    server = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    server.daemon_threads = True
    print('tally-admin listening on %d' % PORT, flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
