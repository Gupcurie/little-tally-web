#!/usr/bin/env python3
"""Little Tally - account administration service.

Runs inside its own container on the private Docker network; nginx publishes it
under /admin/ only. The service_role key stays here and is never sent to the
browser. Standard library only, so the image needs no package installs.
"""
import base64
import csv
import hashlib
import hmac
import io
import ipaddress
import json
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SUPABASE_URL = os.environ['SUPABASE_URL'].rstrip('/')
SERVICE_KEY = os.environ['SERVICE_ROLE_KEY']
PASSWORD_HASH = os.environ['ADMIN_PASSWORD_HASH']
SECONDARY_PASSWORD_HASH = os.environ.get('ADMIN_SECONDARY_PASSWORD_HASH', '')
SESSION_SECRET = os.environ['SESSION_SECRET'].encode()
DATA_DIR = os.environ.get('DATA_DIR', '/data')
STATIC_DIR = os.environ.get('STATIC_DIR', '/app/static')
SESSION_TTL = int(os.environ.get('SESSION_TTL', str(12 * 3600)))
PORT = int(os.environ.get('PORT', '8080'))

ADMIN_SLOTS = ('primary', 'secondary')
ACCOUNT_ID = re.compile(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}')

LOGIN_WINDOW = 900
LOGIN_MAX_FAILS = 8
_lock = threading.Lock()
_fails = {}
_audit_lock = threading.Lock()

NEW_PASSWORD_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
BOOK_LABELS = {'sales': '销售', 'stock': '库存', 'egg': '放蛋'}


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


def login_admin_slot(body):
    if not isinstance(body, dict) or not isinstance(body.get('password'), str):
        return None
    password = body['password']
    primary_ok = verify_password(password, PASSWORD_HASH)
    secondary_ok = SECONDARY_PASSWORD_HASH and verify_password(password, SECONDARY_PASSWORD_HASH)
    if primary_ok:
        return 'primary'
    if secondary_ok:
        return 'secondary'
    return None


def make_session(admin_slot):
    claims = {'admin_slot': admin_slot, 'sid': secrets.token_hex(12), 'exp': int(time.time()) + SESSION_TTL,
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
    if (not isinstance(claims, dict) or claims.get('exp', 0) < time.time()
            or claims.get('admin_slot') not in ADMIN_SLOTS):
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


def audit(action, target_id='', target_name='', ip='', result='ok', note='', *, admin_slot=None):
    record = {'ts': int(time.time()), 'action': action, 'target_id': target_id,
              'target_name': target_name, 'ip': ip, 'result': result, 'note': note,
              'admin_slot': admin_slot}
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


def read_audit(limit=60, admin_slot=None):
    path = os.path.join(DATA_DIR, 'audit.jsonl')
    try:
        with open(path, 'r', encoding='utf-8') as fh:
            lines = fh.readlines()
    except Exception:
        return []
    out = []
    for line in reversed(lines):
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if not isinstance(entry, dict):
            continue
        recorded_slot = entry.get('admin_slot') or (
            'secondary' if entry.get('action') == 'login' and entry.get('note') == 'admin_slot=secondary' else 'primary'
        )
        if admin_slot is None or recorded_slot == admin_slot:
            out.append(entry)
            if len(out) == limit:
                break
    return out


def ledger_stats(payload):
    result = {}
    if not isinstance(payload, dict):
        return result
    for book in BOOK_LABELS:
        data = payload.get(book) or {}
        items = data.get('items') or []
        records = data.get('records') or []
        totals = item_totals(data)
        result[book] = {
            'items': len(items),
            'records': len(records),
            'lines': [{'name': str(i.get('name') or ''), 'total': totals.get(i.get('id'), 0)}
                      for i in items],
        }
        if book == 'egg':
            ratios = [(i, i.get('ratio')) for i in items
                      if isinstance(i.get('ratio'), int) and i['ratio'] > 0]
            completed = min((totals.get(i.get('id'), 0) // ratio for i, ratio in ratios), default=0)
            result[book]['round'] = completed
            result[book]['total'] = sum(totals.get(i.get('id'), 0) for i in items)
            for line, item in zip(result[book]['lines'], items):
                line['ratio'] = item.get('ratio')
    return result


def fetch_teams():
    status, rows = supabase('/rest/v1/rpc/tally_admin_teams', method='POST', body={})
    if status != 200 or not isinstance(rows, list):
        raise RuntimeError('group list unavailable')
    return [r for r in rows if isinstance(r, dict) and r.get('id') and 'payload' in r]

def fetch_ledgers(ids):
    """Return {user_id: ledger row} for the given account ids."""
    if not ids:
        return {}
    expr = ','.join(ids)
    status, rows = supabase('/rest/v1/tally_ledgers?select=user_id,revision,updated_at,payload'
                            '&user_id=in.(%s)' % expr)
    if status != 200 or not isinstance(rows, list):
        raise RuntimeError('ledger read failed')
    result = {row.get('user_id'): row for row in rows}
    missing = set(ids) - set(result)
    if missing:
        for team in fetch_teams():
            if team['id'] in missing:
                result[team['id']] = team
    return result


def item_totals(book):
    totals = {}
    for rec in (book.get('records') or []):
        if rec.get('kind') in ('count', 'set') and rec.get('itemId'):
            totals[rec['itemId']] = totals.get(rec['itemId'], 0) + (rec.get('delta') or 0)
    return totals


def name_key(name):
    return ' '.join(str(name or '').split()).lower() or '(未命名)'


def aggregate(ids, names, book_key, op, ledgers=None):
    """Read-only aggregation across accounts, matched by item name."""
    if ledgers is None:
        ledgers = fetch_ledgers(ids)
    rows = {}
    for uid in ids:
        row = ledgers.get(uid)
        payload = (row or {}).get('payload') or {}
        book = payload.get(book_key) or {}
        totals = item_totals(book)
        for item in (book.get('items') or []):
            key = name_key(item.get('name'))
            entry = rows.setdefault(key, {'name': (item.get('name') or '(未命名)').strip(),
                                          'per_user': {}})
            entry['per_user'][uid] = entry['per_user'].get(uid, 0) + totals.get(item.get('id'), 0)

    out = []
    for entry in rows.values():
        values = [entry['per_user'].get(uid, 0) for uid in ids]
        record = {'name': entry['name'], 'values': values, 'sum': sum(values)}
        if op == 'diff' and len(ids) >= 2:
            record['diff'] = values[0] - sum(values[1:])
        out.append(record)
    out.sort(key=lambda r: (-abs(r['diff'] if 'diff' in r else r['sum']), r['name']))
    return {
        'book': book_key,
        'op': op,
        'users': [{'id': uid, 'username': names.get(uid, '')} for uid in ids],
        'rows': out,
        'missing': [uid for uid in ids if uid not in ledgers],
    }


def display_network_event(event):
    if not isinstance(event, dict): return None
    method, path, status = (event.get(k) for k in ('method', 'path', 'status'))
    if not isinstance(status, int):
        match = re.fullmatch(r'([A-Z]+) (/[^\r\n]*) · HTTP (\d{3})', str(event.get('detail', '')))
        if not match: return event
        method, path, status = match.group(1), match.group(2), int(match.group(3))
    if status == 404 and method in ('GET', 'HEAD') and path in ('/favicon.ico', '/robots.txt'):
        return None
    if event.get('kind') == '请求被拒绝或资源不存在':
        event = dict(event, kind={400:'请求格式错误',401:'未登录或登录未通过',403:'访问被拒绝',404:'资源不存在',405:'请求方式不允许',408:'请求超时',413:'请求体过大'}.get(status,'HTTP '+str(status)))
    if status == 404 and event.get('kind') == '资源不存在':
        event = dict(event, can_block=False)
    return event


def security_snapshot():
    entries = []
    path = os.path.join(DATA_DIR, 'network', 'events.jsonl')
    try:
        with open(path, 'rb') as fh:
            fh.seek(max(0, os.fstat(fh.fileno()).st_size - 1024 * 1024))
            for line in fh.read().splitlines():
                try:
                    event = display_network_event(json.loads(line))
                    if event is not None: entries.append(event)
                except (ValueError, UnicodeError): pass
    except OSError: pass
    for event in read_audit(200, 'primary'):
        if event.get('result') != 'ok' or event.get('action') in ('export', 'security_block', 'security_unblock'):
            entries.append({'at': event['ts'], 'ip': event.get('ip', ''), 'kind': '管理操作' if event.get('result') == 'ok' else '管理请求失败', 'detail': {'export':'后台导出账本','login':'后台登录','security_block':'管理员提交封禁','security_unblock':'管理员解除封禁'}.get(event.get('action'), event.get('action', '')) + (' · ' + event['note'] if event.get('note') else '')})
    status, events = supabase('/rest/v1/rpc/tally_admin_security', method='POST', body={})
    if status == 200 and isinstance(events, list):
        for event in events:
            entries.append({'at': event.get('at'), 'ip': event.get('ip'), 'kind': '入群码尝试失败' if event.get('kind')=='team_code_failed' else event.get('kind','数据库操作'), 'detail': event.get('detail', '')})
    try:
        with open(os.path.join(DATA_DIR, 'ip-blocks.json')) as fh: blocked = json.load(fh)
    except (OSError, ValueError): blocked = []
    try:
        with open(os.path.join(DATA_DIR, 'security-status.json')) as fh: agent = json.load(fh)
        if time.time() - float(agent.get('at', 0)) > 30: agent['status'] = '安全服务超过30秒未更新，请检查服务器'
    except (OSError, ValueError): agent = {'status': '等待安全服务启动'}
    def stamp(e):
        value = e.get('at')
        try: return float(value)
        except (ValueError, TypeError):
            try: return datetime.fromisoformat(str(value).replace('Z', '+00:00')).timestamp()
            except (ValueError, TypeError): return 0
    entries.sort(key=stamp, reverse=True)
    return {'entries': entries[:300], 'blocked': blocked, 'agent': agent}

def cst(ms):
    if not isinstance(ms, (int, float)):
        return ''
    return datetime.fromtimestamp(ms / 1000, timezone(timedelta(hours=8))).strftime('%Y-%m-%d %H:%M:%S')


def export_csv(username, payload):
    payload = payload or {}
    out = io.StringIO()
    writer = csv.writer(out, lineterminator='\r\n')
    writer.writerow(['记录时间', '账本', '物品', '数量变化', '类型'])
    for book_key, label in BOOK_LABELS.items():
        book = payload.get(book_key) or {}
        names = {item.get('id'): (item.get('name') or '') for item in (book.get('items') or [])}
        records = sorted(book.get('records') or [], key=lambda r: r.get('at') or 0)
        for rec in records:
            writer.writerow([cst(rec.get('at')), label, names.get(rec.get('itemId'), ''),
                             rec.get('delta', ''), rec.get('kind', '')])
    writer.writerow([])
    writer.writerow(['物品汇总', '账本', '物品', '当前数量', ''])
    for book_key, label in BOOK_LABELS.items():
        book = payload.get(book_key) or {}
        totals = item_totals(book)
        for item in (book.get('items') or []):
            writer.writerow([username, label, item.get('name') or '', totals.get(item.get('id'), 0), ''])
    return '\ufeff' + out.getvalue()


def account_activity(payload):
    """Read-only signals; recommendation-only saves do not count as ledger changes."""
    payload = payload if isinstance(payload, dict) else {}
    stable = {k: v for k, v in payload.items() if k != 'revision'}
    egg = payload.get('egg') if isinstance(payload.get('egg'), dict) else {}
    if egg:
        stable['egg'] = {k: v for k, v in egg.items() if k != 'recommendation'}
    plan = egg.get('recommendation') if isinstance(egg.get('recommendation'), dict) else {}
    totals = item_totals(egg)
    key = json.dumps([[[i.get('id'), i.get('ratio'), totals.get(i.get('id'), 0)]
                       for i in egg.get('items', [])],
                      [r.get('id') for r in egg.get('records', [])[-16:]]],
                     ensure_ascii=False, separators=(',', ':'))
    synced = plan.get('version') in (1, 2) and plan.get('key') == key
    times = [r.get('at') for name in BOOK_LABELS
             for r in (payload.get(name) or {}).get('records', [])
             if isinstance(r, dict) and isinstance(r.get('at'), (int, float))]
    return {
        'data_fingerprint': hashlib.sha256(json.dumps(stable, ensure_ascii=False, sort_keys=True,
                                                     separators=(',', ':')).encode()).hexdigest(),
        'latest_record_at': max(times, default=0),
        'recommendation_version': plan.get('version') if synced else None,
        'recommendation_synced_at': plan.get('at') if synced else None,
    }


def account_modified_time(account):
    value = account.get('ledger_updated_at')
    if not value:
        return 0
    try:
        stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        return stamp.timestamp()
    except (ValueError, TypeError, AttributeError, OverflowError):
        return 0


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
    if status != 200 or not isinstance(rows, list):
        raise RuntimeError('ledger list failed: %s' % status)
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
            **account_activity((row or {}).get('payload')),
        })
    for team in fetch_teams():
        stats = ledger_stats(team.get('payload'))
        accounts.append({'id': team['id'], 'username': '群 · ' + team['name'], 'entity_type': 'team', 'members': team.get('members', 0), 'created_at': team.get('created_at'), 'last_sign_in_at': None, 'banned_until': None, 'confirmed': True, 'revision': team.get('revision'), 'ledger_updated_at': team.get('updated_at'), 'books': stats, 'items': sum(v['items'] for v in stats.values()), 'records': sum(v['records'] for v in stats.values()), **account_activity(team.get('payload'))})
    accounts.sort(key=lambda a: (-account_modified_time(a), a['username'] or '~', a['id']))
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

    def _raw(self, status, body, ctype, extra=None):
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

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

    def _check_primary(self, admin_slot):
        if admin_slot == 'primary':
            return True
        self._json(403, {'error': '此功能由管理员 1 管理'})
        return False

    # -- export ------------------------------------------------------------ #
    def _export(self, user_id, fmt, admin_slot):
        team = next((t for t in fetch_teams() if t['id'] == user_id), None)
        status, user = (200, {'app_metadata': {'tally_username': '群-' + team['name']}}) if team else supabase('/auth/v1/admin/users/' + user_id)
        if status != 200 or not isinstance(user, dict):
            self._json(404, {'error': 'ACCOUNT_NOT_FOUND'})
            return
        username = ((user.get('app_metadata') or {}).get('tally_username')) or user_id[:8]
        try:
            payload = (fetch_ledgers([user_id]).get(user_id) or {}).get('payload') or {}
        except Exception:
            self._json(503, {'error': 'BACKEND_UNAVAILABLE'})
            return
        stamp = time.strftime('%Y%m%d-%H%M')
        safe = re.sub(r'[^A-Za-z0-9_-]', '_', username) or 'account'
        if fmt == 'json':
            body = json.dumps({'username': username, 'exported_at': cst(time.time() * 1000),
                               'ledger': payload}, ensure_ascii=False, indent=2).encode('utf-8')
            ctype, ext = 'application/json; charset=utf-8', 'json'
        else:
            body = export_csv(username, payload).encode('utf-8')
            ctype, ext = 'text/csv; charset=utf-8', 'csv'
        audit('export', user_id, username, client_ip(self), note=ext, admin_slot=admin_slot)
        self._raw(200, body, ctype, {
            'Content-Disposition': 'attachment; filename="tally-%s-%s.%s"' % (safe, stamp, ext),
        })

    # -- routing ----------------------------------------------------------- #
    def do_GET(self):
        raw_path = self.path
        path = raw_path.split('?', 1)[0]
        query = urllib.parse.parse_qs(raw_path.split('?', 1)[1] if '?' in raw_path else '')
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
                self._json(200, {'authenticated': True, 'csrf': claims['csrf'], 'admin_slot': claims['admin_slot']})
            else:
                self._json(401, {'authenticated': False})
            return
        if not claims:
            self._json(401, {'error': 'UNAUTHENTICATED'})
            return

        admin_slot = claims['admin_slot']
        if path == '/api/accounts':
            try:
                accounts = fetch_accounts()
            except Exception:
                self._json(503, {'error': 'BACKEND_UNAVAILABLE'})
                return
            active = [a for a in accounts if not a['banned_until']]
            self._json(200, {
                'accounts': accounts,
                'admin_slot': admin_slot,
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

        match = re.match(r'^/api/accounts/([0-9a-fA-F-]{36})/recommendation$', path)
        if match:
            user_id = match.group(1).lower()
            try:
                row = fetch_ledgers([user_id]).get(user_id)
                status, rows = 200, [row] if row else []
            except Exception:
                status, rows = 503, None
            if status != 200 or not isinstance(rows, list):
                self._json(503, {'error': 'BACKEND_UNAVAILABLE'})
                return
            if not rows:
                self._json(200, {'egg': None, 'revision': None, 'updated_at': None})
                return
            row = rows[0]
            self._json(200, {'egg': (row.get('payload') or {}).get('egg'),
                             'revision': row.get('revision'), 'updated_at': row.get('updated_at')})
            return

        match = re.match(r'^/api/accounts/([0-9a-fA-F-]{36})/export$', path)
        if match:
            user_id = match.group(1).lower()
            self._export(user_id, (query.get('format') or ['csv'])[0], admin_slot)
            return

        if path == '/api/security':
            if self._check_primary(admin_slot):
                self._json(200, {**security_snapshot(), 'current_ip': client_ip(self)})
            return

        if path == '/api/audit':
            entries = read_audit(admin_slot=admin_slot)
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

        admin_slot = claims['admin_slot']
        if path == '/api/logout':
            audit('logout', ip=client_ip(self), admin_slot=admin_slot)
            self._expire_cookies()
            return

        if path == '/api/security/block':
            if not self._check_primary(admin_slot):
                return
            body = self._body() or {}
            try:
                address = ipaddress.ip_address(str(body.get('ip', '')).strip())
                if address.is_loopback or address.is_link_local or str(address) == client_ip(self):
                    raise ValueError('不能封禁当前连接或服务器本地地址')
                ip = str(address)
                with _lock:
                    try:
                        with open(os.path.join(DATA_DIR, 'ip-blocks.json')) as fh: blocked = json.load(fh)
                    except (OSError, ValueError): blocked = []
                    blocked = [str(ipaddress.ip_address(v)) for v in blocked]
                    if body.get('blocked') is True:
                        if ip not in blocked: blocked.append(ip)
                    else: blocked = [v for v in blocked if v != ip]
                    if len(blocked) > 10000: raise ValueError('封禁列表已达上限')
                    tmp = os.path.join(DATA_DIR, 'ip-blocks.json.tmp')
                    with open(tmp, 'w') as fh: json.dump(blocked, fh)
                    os.replace(tmp, os.path.join(DATA_DIR, 'ip-blocks.json'))
                audit('security_block' if body.get('blocked') is True else 'security_unblock', ip=client_ip(self), note=ip, admin_slot=admin_slot)
                self._json(200, {'ok': True, 'message': '已提交，安全服务将在几秒内应用'})
            except (ValueError, TypeError) as exc:
                self._json(400, {'error': str(exc)})
            return

        if path == '/api/aggregate':
            body = self._body() or {}
            ids = []
            for value in (body.get('ids') or []):
                text = str(value).lower()
                if ACCOUNT_ID.fullmatch(text) and text not in ids:
                    ids.append(text)
            ids = ids[:40]
            book = body.get('book', 'stock')
            if not isinstance(book, str) or book not in BOOK_LABELS:
                self._json(400, {'error': 'INVALID_BOOK'})
                return
            op = 'diff' if body.get('op') == 'diff' else 'sum'
            if not ids:
                self._json(400, {'error': 'NO_ACCOUNTS'})
                return
            if op == 'diff' and len(ids) < 2:
                self._json(400, {'error': 'DIFF_NEEDS_AT_LEAST_TWO'})
                return
            try:
                accounts = fetch_accounts()
            except Exception:
                self._json(503, {'error': 'BACKEND_UNAVAILABLE'})
                return
            names = {a['id']: a['username'] for a in accounts}
            if any(uid not in names for uid in ids):
                self._json(404, {'error': 'ACCOUNT_NOT_FOUND'})
                return
            try:
                if body.get('all_books') is True:
                    ledgers = fetch_ledgers(ids)
                    result = {'op': op, 'books': {key: aggregate(ids, names, key, op, ledgers) for key in BOOK_LABELS}}
                else:
                    result = aggregate(ids, names, book, op)
            except Exception:
                self._json(503, {'error': '账本读取失败，请刷新后重试'})
                return
            audit('aggregate', ','.join(ids)[:64], '%s %s' % (book, op), client_ip(self), admin_slot=admin_slot)
            self._json(200, result)
            return

        match = re.match(r'^/api/accounts/([0-9a-fA-F-]{36})/(ban|password)$', path)
        if not match:
            self._json(404, {'error': 'NOT_FOUND'})
            return

        user_id, action = match.group(1).lower(), match.group(2)
        if any(t['id'] == user_id for t in fetch_teams()):
            self._json(400, {'error': '群账本没有登录密码或个人账号封禁设置'})
            return
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
                audit('ban' if banned else 'unban', user_id, name, ip, 'failed', admin_slot=admin_slot)
                self._json(400, {'error': 'UPDATE_FAILED'})
                return
            audit('ban' if banned else 'unban', user_id, name, ip, admin_slot=admin_slot)
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
            audit('reset_password', user_id, name, ip, 'failed', admin_slot=admin_slot)
            self._json(400, {'error': 'UPDATE_FAILED'})
            return
        audit('reset_password', user_id, name, ip, admin_slot=admin_slot)
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
        admin_slot = login_admin_slot(self._body())
        if not admin_slot:
            with _lock:
                _fails.setdefault(ip, []).append(now)
            audit('login', ip=ip, result='failed')
            self._json(401, {'error': 'INVALID_PASSWORD'})
            return
        with _lock:
            _fails[ip] = []
        token, claims = make_session(admin_slot)
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
        audit('login', ip=ip, admin_slot=admin_slot)

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
