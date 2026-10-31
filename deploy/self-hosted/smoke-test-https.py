#!/usr/bin/env python3
"""End-to-end check through the REAL public HTTPS entry (TLS verified, nginx in the path).

Why this exists: the earlier smoke test talked to http://127.0.0.1:8000 directly and
therefore bypassed nginx. When the api-gw container was recreated its Docker IP changed
and nginx kept proxying to the stale address; every proxied request returned 502 while
the internal test still passed. This script exercises the same path a phone uses.

Connection is pinned to 127.0.0.1:443 but the certificate is verified for the public
name/IP, so it can run on the server itself without DNS or hairpin NAT.

Usage:
    python3 smoke-test-https.py [host] [pin]
    host  default 43.142.19.116
    pin   default 127.0.0.1  (use "auto" to connect to host directly)

Administrator calls (disabling the temporary QA accounts) intentionally stay on the
internal http://127.0.0.1:8000 gateway: the public nginx config blocks /auth/v1/admin/.
"""
import hashlib
import http.client
import json
import secrets
import socket
import ssl
import subprocess
import sys
import time
import uuid
from pathlib import Path

ENV_PATH = Path('/opt/little-tally/stack/.env')
STACK_DIR = '/opt/little-tally/stack'

env = dict(line.split('=', 1) for line in ENV_PATH.read_text().splitlines()
           if line and not line.startswith('#') and '=' in line)
ANON = env['ANON_KEY']
ADMIN = env['SERVICE_ROLE_KEY']

HOST = sys.argv[1] if len(sys.argv) > 1 else '43.142.19.116'
PIN = sys.argv[2] if len(sys.argv) > 2 else '127.0.0.1'
ORIGIN = 'https://' + HOST

results = []


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host, port=443, pin=None, timeout=25):
        super().__init__(host, port, timeout=timeout, context=ssl.create_default_context())
        self._pin = pin or host

    def connect(self):
        target = self.host if str(self._pin).lower() == 'auto' else self._pin
        self.sock = socket.create_connection((target, self.port), self.timeout)
        self.sock = self._context.wrap_socket(self.sock, server_hostname=self.host)


def call(path, method='GET', body=None, token=None, origin=None, timeout=25):
    conn = PinnedHTTPSConnection(HOST, 443, PIN, timeout=timeout)
    headers = {'apikey': ANON, 'Authorization': 'Bearer ' + (token or ANON),
               'Origin': origin or ORIGIN, 'Content-Type': 'application/json'}
    payload = None if body is None else json.dumps(body).encode()
    try:
        conn.request(method, path, body=payload, headers=headers)
        resp = conn.getresponse()
        raw = resp.read()
        status = resp.status
    except Exception as exc:  # noqa: BLE001
        return 0, {'_transport_error': type(exc).__name__}
    finally:
        conn.close()
    try:
        data = json.loads(raw) if raw else None
    except ValueError:
        data = None
    return status, data


def internal(path, method='GET', body=None):
    conn = http.client.HTTPConnection('127.0.0.1', 8000, timeout=25)
    headers = {'apikey': ADMIN, 'Authorization': 'Bearer ' + ADMIN, 'Content-Type': 'application/json'}
    payload = None if body is None else json.dumps(body).encode()
    try:
        conn.request(method, path, body=payload, headers=headers)
        resp = conn.getresponse()
        raw = resp.read()
        status = resp.status
    except Exception as exc:  # noqa: BLE001
        return 0, {'_transport_error': type(exc).__name__}
    finally:
        conn.close()
    try:
        data = json.loads(raw) if raw else None
    except ValueError:
        data = None
    return status, data


def check(name, ok, detail=''):
    results.append((name, ok, detail))
    print(('PASS  ' if ok else 'FAIL  ') + name + (('  [' + detail + ']' if detail else '')))


def login(username, password):
    email = 'u' + hashlib.sha256(username.encode()).hexdigest() + '@users.little-tally.invalid'
    return call('/auth/v1/token?grant_type=password', 'POST', {'email': email, 'password': password})


def db_count(sql):
    for user in ('postgres', 'supabase_admin'):
        try:
            out = subprocess.run(['docker', 'compose', 'exec', '-T', 'db', 'psql', '-U', user,
                                  '-d', 'postgres', '-tAc', sql],
                                 cwd=STACK_DIR, capture_output=True, text=True, timeout=30)
            if out.returncode == 0 and out.stdout.strip():
                return out.stdout.strip()
        except Exception:  # noqa: BLE001
            continue
    return 'n/a'


def main():
    stamp = int(time.time())
    users_before = db_count('select count(*) from auth.users')
    ledgers_before = db_count('select count(*) from tally_ledgers')
    print('target https://%s (pinned to %s)' % (HOST, PIN))
    print('before: auth.users=%s tally_ledgers=%s\n' % (users_before, ledgers_before))

    u1 = 'qa_dsh_%d_1' % stamp
    pw1 = str(secrets.randbelow(900000) + 100000)
    u2 = 'qa_dsh_%d_2' % stamp
    pw2 = ''.join(secrets.choice('abcdefghijklmnopqrstuvwxyz') for _ in range(12))

    created = []
    status, data = call('/functions/v1/tally-accounts', 'POST', {'username': u1, 'password': pw1})
    check('register numeric-only password via HTTPS', status == 200 and data == {'created': True}, 'HTTP %s' % status)
    if status == 200:
        created.append(u1)
    status, data = call('/functions/v1/tally-accounts', 'POST', {'username': u2, 'password': pw2})
    check('register alphabetic-only password via HTTPS', status == 200 and data == {'created': True}, 'HTTP %s' % status)
    if status == 200:
        created.append(u2)
    if len(created) < 2:
        print('\ncannot continue without two accounts (registration rate limit?)')
        return 1

    status, data = call('/functions/v1/tally-accounts', 'POST', {'username': u1, 'password': '12345'})
    check('5-char password rejected', status == 400 and (data or {}).get('error') == 'INVALID_ACCOUNT', 'HTTP %s' % status)
    status, data = call('/functions/v1/tally-accounts', 'POST', {'username': 'ab', 'password': '123456'})
    check('2-char username rejected', status == 400 and (data or {}).get('error') == 'INVALID_ACCOUNT', 'HTTP %s' % status)
    status, data = call('/functions/v1/tally-accounts', 'POST', {'username': u1, 'password': pw1},
                        origin='https://untrusted.example.invalid')
    check('untrusted Origin rejected', status == 403 and (data or {}).get('error') == 'ORIGIN_NOT_ALLOWED', 'HTTP %s' % status)

    status, a = login(u1, pw1)
    check('login user A via HTTPS', status == 200 and bool((a or {}).get('access_token')), 'HTTP %s' % status)
    if status != 200:
        return 1
    status, b = login(u2, pw2)
    check('login user B via HTTPS', status == 200 and bool((b or {}).get('access_token')), 'HTTP %s' % status)
    if status != 200:
        return 1
    status, _ = login(u1, pw2 + 'x')
    check('wrong password rejected', status in (400, 401), 'HTTP %s' % status)
    status, data = call('/functions/v1/tally-accounts', 'POST', {'username': u1, 'password': pw1})
    check('duplicate username rejected', status == 409 and (data or {}).get('error') == 'USERNAME_TAKEN', 'HTTP %s' % status)

    ta, tb = a['access_token'], b['access_token']
    id_a, id_b = a['user']['id'], b['user']['id']

    item = str(uuid.uuid4())
    ts = int(time.time() * 1000)
    snapshot = {'format': 'little-tally-pocket', 'version': 1, 'revision': 0,
                'sales': {'book': 'sales', 'items': [{'id': item, 'name': 'HTTPS check', 'color': 0,
                                                      'created': ts, 'breakdown': {}}],
                          'records': [{'id': str(uuid.uuid4()), 'itemId': item, 'delta': 1,
                                       'at': ts, 'kind': 'count'}], 'goal': None},
                'stock': {'book': 'stock', 'items': [], 'records': [], 'goal': None}}
    body = {'p_expected_revision': 0, 'p_snapshot': snapshot, 'p_mutation': str(uuid.uuid4())}
    status, saved = call('/rest/v1/rpc/tally_save', 'POST', body, token=ta)
    check('save ledger via HTTPS', status == 200 and (saved or {}).get('revision') == 1, 'HTTP %s' % status)
    status, replay = call('/rest/v1/rpc/tally_save', 'POST', body, token=ta)
    check('idempotent retry', status == 200 and (replay or {}).get('replayed') is True, 'HTTP %s' % status)
    status, _ = call('/rest/v1/rpc/tally_save', 'POST', {**body, 'p_mutation': str(uuid.uuid4())}, token=ta)
    check('revision conflict rejected', status in (400, 409), 'HTTP %s' % status)

    query = '/rest/v1/tally_ledgers?select=user_id,payload,revision'
    status, own = call(query, token=ta)
    check('read own ledger via HTTPS', status == 200 and len(own or []) == 1 and own[0]['user_id'] == id_a,
          'HTTP %s' % status)
    own_payload = own[0]['payload'] if status == 200 and own else None
    status, other = call(query + '&user_id=eq.' + id_a, token=tb)
    check('cross-account isolation', status == 200 and other == [], 'HTTP %s' % status)
    status, _ = call(query)
    check('anonymous read denied', status in (401, 403), 'HTTP %s' % status)
    status, _ = call('/rest/v1/tally_ledgers', 'POST',
                     {'user_id': id_b, 'payload': snapshot, 'revision': 1, 'last_mutation': str(uuid.uuid4())}, token=tb)
    check('direct table write denied', status in (401, 403), 'HTTP %s' % status)

    status, _ = call('/auth/v1/logout?scope=local', 'POST', token=ta)
    check('logout via HTTPS', status in (200, 204), 'HTTP %s' % status)
    status, again = login(u1, pw1)
    check('re-login after logout', status == 200 and bool((again or {}).get('access_token')), 'HTTP %s' % status)
    status, restored = call(query, token=(again or {}).get('access_token'))
    check('ledger identical after re-login',
          status == 200 and len(restored or []) == 1 and restored[0]['payload'] == own_payload, 'HTTP %s' % status)

    status, _ = call('/auth/v1/admin/users', token=ADMIN)
    check('public admin path blocked', status == 404, 'HTTP %s' % status)
    status, _ = call('/functions/v1/some-other-function')
    check('other functions path blocked', status == 404, 'HTTP %s' % status)

    for label, uid in (('A', id_a), ('B', id_b)):
        status, _ = internal('/auth/v1/admin/users/' + uid, 'PUT', {'ban_duration': '876000h'})
        check('disable temporary QA account ' + label, status == 200, 'HTTP %s' % status)

    print('\nafter: auth.users=%s tally_ledgers=%s'
          % (db_count('select count(*) from auth.users'), db_count('select count(*) from tally_ledgers')))
    failed = [r for r in results if not r[1]]
    print('\nRESULT %d passed, %d failed' % (len(results) - len(failed), len(failed)))
    for name, _, detail in failed:
        print('  failed: ' + name + ' ' + detail)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
