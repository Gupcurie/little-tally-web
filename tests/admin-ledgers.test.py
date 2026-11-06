"""Focused read-only admin book tests; no live credentials or database writes."""
import copy
import csv
import hashlib
import hmac
import json
import importlib.util
import io
import os
from tempfile import TemporaryDirectory
import time
from pathlib import Path
import unittest
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / 'deploy/admin/server.py'
with patch.dict(os.environ, {'SUPABASE_URL': 'http://example.invalid', 'SERVICE_ROLE_KEY': 'test-only',
                            'ADMIN_PASSWORD_HASH': 'test-only', 'SESSION_SECRET': 'test-only'}):
    spec = importlib.util.spec_from_file_location('admin_server_test', path)
    admin = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(admin)

A = '00000000-0000-4000-8000-000000000001'
B = '00000000-0000-4000-8000-000000000002'

def book(name, amounts, ratio=1):
    return {'items': [{'id': 'item', 'name': name, 'ratio': ratio}],
            'records': [{'itemId': 'item', 'delta': n, 'at': 1793469600000 + k,
                         'kind': 'count' if k == 0 else 'set'} for k, n in enumerate(amounts)]}

def payload():
    return {'sales': book('销售物品', [1, 4]), 'stock': book('库存物品', [2, 6]),
            'egg': book('放蛋物品', [1, 5, -1], 2)}

class Handler:
    path = '/admin/api/aggregate'
    headers = {}
    def __init__(self, key='egg', authenticated=True):
        self.body = {'book': key, 'op': 'sum', 'ids': [A, B]}
        self.authenticated = authenticated
        self.response = None
        self.admin_slot = 'primary'
    def _origin_ok(self): return True
    def _session(self): return {'csrf': 'test', 'admin_slot': self.admin_slot} if self.authenticated else None
    def _csrf_ok(self, claims): return True
    def _body(self): return self.body
    def _json(self, status, data): self.response = (status, data)

class AdminBooksTest(unittest.TestCase):
    def test_activity_ignores_recommendation_only_saves_and_detects_real_ledger_edits(self):
        current = payload()
        first = admin.account_activity(current)
        current['revision'] = 999
        current['egg']['recommendation'] = {'version': 2, 'at': 1793490000000, 'key': 'old'}
        metadata = admin.account_activity(current)
        self.assertEqual(first['data_fingerprint'], metadata['data_fingerprint'])
        current['egg']['records'][0]['delta'] += 1
        changed = admin.account_activity(current)
        self.assertNotEqual(first['data_fingerprint'], changed['data_fingerprint'])
        self.assertEqual(changed['recommendation_version'], None)
        self.assertEqual(changed['latest_record_at'], 1793469600002)

    def test_activity_recognizes_matching_plan_keys_and_reports_sync_time(self):
        current = payload()
        egg = current['egg']
        import json
        key = json.dumps([[['item', 2, 5]], [None, None, None]], separators=(',', ':'))
        egg['recommendation'] = {'version': 2, 'at': 1793490000000, 'key': key}
        activity = admin.account_activity(current)
        self.assertEqual(activity['recommendation_version'], 2)
        self.assertEqual(activity['recommendation_synced_at'], 1793490000000)

    def test_ledger_fetch_failure_is_not_reported_as_all_accounts_being_empty(self):
        with patch.object(admin, 'supabase', side_effect=[(200, {'users': [{'id': A}]}), (503, None)]):
            with self.assertRaises(RuntimeError):
                admin.fetch_accounts()

    def test_recommendation_endpoint_requires_admin_session_and_returns_only_the_requested_egg(self):
        handler = Handler(authenticated=False)
        handler.path = '/admin/api/accounts/' + A + '/recommendation'
        with patch.object(admin, 'supabase') as request:
            admin.Handler.do_GET(handler)
            self.assertEqual(handler.response[0], 401)
            request.assert_not_called()
        handler.authenticated = True
        egg = payload()['egg']
        egg['recommendation'] = {'test': 'stored snapshot'}
        before = copy.deepcopy(egg)
        with patch.object(admin, 'supabase', return_value=(200, [{'user_id': A, 'payload': {'egg': egg, 'sales': {}}, 'revision': 7, 'updated_at': 'now'}])) as request:
            admin.Handler.do_GET(handler)
            self.assertEqual(handler.response[1], {'egg': egg, 'revision': 7, 'updated_at': 'now'})
            self.assertIn('user_id=in.(' + A, request.call_args.args[0])
        self.assertEqual(egg, before)

    def test_recommendation_endpoint_reports_backend_failure_and_missing_ledger(self):
        handler = Handler()
        handler.path = '/admin/api/accounts/' + A + '/recommendation'
        with patch.object(admin, 'supabase', return_value=(503, None)):
            admin.Handler.do_GET(handler)
            self.assertEqual(handler.response[0], 503)
        with patch.object(admin, 'supabase', return_value=(200, [])):
            admin.Handler.do_GET(handler)
            self.assertEqual(handler.response[1]['egg'], None)

    def test_summary_counts_and_egg_round_include_manual_sets(self):
        stats = admin.ledger_stats(payload())
        self.assertEqual(set(stats), {'sales', 'stock', 'egg'})
        self.assertEqual(stats['sales']['lines'][0]['total'], 5)
        self.assertEqual(stats['stock']['lines'][0]['total'], 8)
        self.assertEqual(stats['egg']['lines'][0], {'name': '放蛋物品', 'total': 5, 'ratio': 2})
        self.assertEqual(stats['egg']['round'], 2)
        self.assertEqual(stats['egg']['total'], 5)
        self.assertEqual(sum(b['records'] for b in stats.values()), 7)

    def test_old_ledgers_without_egg_are_supported(self):
        stats = admin.ledger_stats({'sales': book('旧物品', [1])})
        self.assertEqual(stats['egg']['items'], 0)
        self.assertEqual(stats['egg']['records'], 0)
        self.assertEqual(stats['egg']['round'], 0)
        self.assertEqual(admin.ledger_stats(None), {})

    def test_csv_exports_egg_records_and_correct_current_quantity(self):
        rows = list(csv.reader(io.StringIO(admin.export_csv('test', payload()).lstrip('\ufeff'))))
        records = [r for r in rows if len(r) == 5 and r[1] == '放蛋']
        self.assertEqual(len(records), 4)  # three records and the item summary
        self.assertEqual(records[-1], ['test', '放蛋', '放蛋物品', '5', ''])
        self.assertEqual(records[1][3:], ['5', 'set'])

    def test_sum_and_diff_choose_each_book_and_leave_data_unchanged(self):
        ledgers = {A: {'payload': payload()}, B: {'payload': payload()}}
        ledgers[B]['payload']['egg'] = book('放蛋物品', [1, 2], 2)
        before = copy.deepcopy(ledgers)
        with patch.object(admin, 'fetch_ledgers', return_value=ledgers):
            for key, expected in [('sales', 10), ('stock', 16), ('egg', 8)]:
                result = admin.aggregate([A, B], {}, key, 'sum')
                self.assertEqual(result['book'], key)
                self.assertEqual(result['rows'][0]['sum'], expected)
            result = admin.aggregate([A, B], {}, 'egg', 'diff')
            self.assertEqual(result['rows'][0]['values'], [5, 3])
            self.assertEqual(result['rows'][0]['diff'], 2)
        self.assertEqual(ledgers, before)

    def test_multi_account_diff_is_first_minus_all_others_for_each_book(self):
        third = '00000000-0000-4000-8000-000000000003'
        ledgers = {uid: {'payload': payload()} for uid in [A, B, third]}
        before = copy.deepcopy(ledgers)
        with patch.object(admin, 'fetch_ledgers', return_value=ledgers):
            for key, expected in [('sales', -5), ('stock', -8), ('egg', -5)]:
                result = admin.aggregate([A, B, third], {}, key, 'diff')
                self.assertEqual(result['rows'][0]['diff'], expected)
        self.assertEqual(ledgers, before)
        handler = Handler();handler.body.update(ids=[A, B, third], op='diff')
        with patch.object(admin, 'fetch_accounts', return_value=[{'id': uid, 'username': uid} for uid in [A, B, third]]), patch.object(admin, 'aggregate', return_value={'rows': []}) as calculate, patch.object(admin, 'audit'):
            admin.Handler.do_POST(handler)
            self.assertEqual(handler.response[0], 200)
            self.assertEqual(calculate.call_args.args[0], [A, B, third])

    def test_missing_egg_book_aggregates_as_zero(self):
        ledgers = {A: {'payload': {'egg': book('放蛋物品', [2])}}, B: {'payload': {}}}
        with patch.object(admin, 'fetch_ledgers', return_value=ledgers):
            self.assertEqual(admin.aggregate([A, B], {}, 'egg', 'sum')['rows'][0]['values'], [2, 0])

    def test_account_overview_includes_egg_items_and_records(self):
        def fake_supabase(url, **kwargs):
            if url.endswith('tally_admin_teams'): return 200, []
            if url.startswith('/auth/'):
                return 200, {'users': [{'id': A, 'app_metadata': {'tally_username': 'test'}}]}
            return 200, [{'user_id': A, 'payload': payload(), 'revision': 1}]
        with patch.object(admin, 'supabase', side_effect=fake_supabase):
            account = admin.fetch_accounts()[0]
        self.assertEqual(account['items'], 3)
        self.assertEqual(account['records'], 7)
        self.assertEqual(account['books']['egg']['records'], 3)

    def test_http_handler_accepts_egg_and_does_not_fall_back_to_stock(self):
        handler = Handler()
        with patch.object(admin, 'fetch_accounts', return_value=[{'id': A, 'username': 'a'}, {'id': B, 'username': 'b'}]), \
             patch.object(admin, 'aggregate', return_value={'book': 'egg', 'rows': []}) as aggregate, \
             patch.object(admin, 'audit'):
            admin.Handler.do_POST(handler)
        aggregate.assert_called_once_with([A, B], {A: 'a', B: 'b'}, 'egg', 'sum')
        self.assertEqual(handler.response, (200, {'book': 'egg', 'rows': []}))

    def test_combined_route_reads_one_ledger_snapshot_for_three_separate_books(self):
        handler = Handler();handler.body['all_books'] = True
        accounts = [{'id': A, 'username': 'a'}, {'id': B, 'username': 'b'}]
        with patch.object(admin, 'fetch_accounts', return_value=accounts), patch.object(admin, 'fetch_ledgers', return_value={A: {'payload': payload()}}) as fetch, patch.object(admin, 'audit'):
            admin.Handler.do_POST(handler)
            self.assertEqual(handler.response[0], 200)
            self.assertEqual(set(handler.response[1]['books']), {'sales','stock','egg'})
            fetch.assert_called_once_with([A,B])
            for key,n in [('sales',5),('stock',8),('egg',5)]:
                self.assertEqual(handler.response[1]['books'][key]['rows'][0]['values'], [n,0])

    def test_failed_batch_read_is_not_silently_reported_as_zero_accounts(self):
        with patch.object(admin, 'supabase', return_value=(503, {})):
            with self.assertRaises(RuntimeError): admin.fetch_ledgers([A,B])
        handler = Handler();handler.body['all_books'] = True
        with patch.object(admin, 'fetch_accounts', return_value=[{'id':A,'username':'a'},{'id':B,'username':'b'}]), patch.object(admin, 'fetch_ledgers', side_effect=RuntimeError('failed')):
            admin.Handler.do_POST(handler)
            self.assertEqual(handler.response[0],503)
            self.assertNotIn('books',handler.response[1])

    def test_group_ledgers_are_visible_and_can_be_aggregated_by_the_admin(self):
        group = '00000000-0000-4000-8000-000000000009'
        with patch.object(admin, 'supabase', return_value=(200, [])), patch.object(admin, 'fetch_teams', return_value=[{'id':group,'payload':payload()}]):
            result = admin.aggregate([group,A],{},'egg','sum')
            self.assertEqual(result['rows'][0]['values'],[5,0])
            self.assertEqual(result['missing'],[A])

    def test_security_endpoints_require_session_and_reject_invalid_or_current_ip(self):
        handler = Handler(authenticated=False);handler.path='/admin/api/security'
        admin.Handler.do_GET(handler);self.assertEqual(handler.response[0],401)
        for ip in ['not-an-ip','1.2.3.4; rm -rf /','127.0.0.1','198.51.100.1']:
            handler=Handler();handler.path='/admin/api/security/block';handler.body={'ip':ip,'blocked':True};handler.headers={'X-Forwarded-For':'198.51.100.1'}
            admin.Handler.do_POST(handler);self.assertEqual(handler.response[0],400)

    def test_old_browser_icon_misses_are_hidden_without_hiding_real_refusals(self):
        def legacy(path, status, method='GET', kind='请求被拒绝或资源不存在'):
            return {'at':1,'ip':'198.51.100.24','kind':kind,'detail':f'{method} {path} · HTTP {status}'}
        self.assertIsNone(admin.display_network_event(legacy('/favicon.ico',404)))
        self.assertIsNone(admin.display_network_event(legacy('/robots.txt',404,'HEAD')))
        self.assertEqual(admin.display_network_event(legacy('/favicon.ico',403))['kind'],'访问被拒绝')
        self.assertEqual(admin.display_network_event(legacy('/admin/api/login',401,'POST'))['kind'],'未登录或登录未通过')
        self.assertEqual(admin.display_network_event(legacy('/missing.css',404))['can_block'],False)
        self.assertEqual(admin.display_network_event(legacy('/.env',404,kind='敏感路径探测'))['kind'],'敏感路径探测')
        event=legacy('/favicon.ico',404)
        before=copy.deepcopy(event);admin.display_network_event(event);self.assertEqual(event,before)

    def test_security_collector_keeps_scans_and_denials_but_skips_routine_browser_misses(self):
        agent_path=path.parents[1]/'security'/'security_agent.py'
        spec=importlib.util.spec_from_file_location('security_agent_test',agent_path)
        agent=importlib.util.module_from_spec(spec);spec.loader.exec_module(agent)
        request={'at':1,'ip':'198.51.100.24','method':'GET','path':'/favicon.ico','status':404}
        self.assertIsNone(agent.classify_request(request))
        self.assertEqual(agent.classify_request(dict(request,status=403))['kind'],'访问被拒绝')
        self.assertEqual(agent.classify_request(dict(request,path='/.env'))['kind'],'敏感路径探测')
        self.assertEqual(agent.classify_request(dict(request,path='/missing.css'))['kind'],'资源不存在')

    def test_invalid_book_and_unauthenticated_requests_are_rejected(self):
        for key in ('invalid', {}, None):
            handler = Handler(key)
            admin.Handler.do_POST(handler)
            self.assertEqual(handler.response[0], 400)
        handler = Handler(authenticated=False)
        admin.Handler.do_POST(handler)
        self.assertEqual(handler.response[0], 401)

class AdminProfilesTest(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        config = patch.object(admin, 'DATA_DIR', directory.name)
        config.start()
        self.addCleanup(config.stop)
        self.accounts = [
            {'id': A, 'username': '甲', 'banned_until': None, 'revision': 1, 'items': 2, 'records': 3},
            {'id': B, 'username': '群 · 乙', 'banned_until': None, 'revision': 2, 'items': 4, 'records': 5},
        ]

    def request(self, slot, path, body=None):
        handler = Handler()
        handler.admin_slot = slot
        handler.path = '/admin/api/' + path
        if body is None:
            admin.Handler.do_GET(handler)
        else:
            handler.body = body
            admin.Handler.do_POST(handler)
        return handler.response

    def test_old_or_tampered_sessions_cannot_become_primary(self):
        token, _ = admin.make_session('secondary')
        self.assertEqual(admin.read_session(token)['admin_slot'], 'secondary')
        body, signature = token.split('.')
        claims = json.loads(admin.b64d(body))
        claims['admin_slot'] = 'primary'
        self.assertIsNone(admin.read_session(admin.b64e(json.dumps(claims).encode()) + '.' + signature))
        body = admin.b64e(json.dumps({'exp': int(time.time()) + 100, 'csrf': 'legacy'}).encode())
        signature = hmac.new(admin.SESSION_SECRET, body.encode(), hashlib.sha256).hexdigest()
        self.assertIsNone(admin.read_session(body + '.' + signature))

    def test_both_admins_see_the_same_accounts_and_groups(self):
        (Path(admin.DATA_DIR) / 'admin-assignments.json').write_text(json.dumps([B]), encoding='utf-8')
        with patch.object(admin, 'fetch_accounts', return_value=self.accounts):
            for slot in admin.ADMIN_SLOTS:
                status, data = self.request(slot, 'accounts')
                self.assertEqual(status, 200)
                self.assertEqual(data['admin_slot'], slot)
                self.assertEqual([account['id'] for account in data['accounts']], [A, B])
                self.assertEqual(data['summary']['records'], 8)
                self.assertEqual(self.request(slot, 'assignments', {'id': A, 'assigned': True})[0], 404)

    def test_both_admins_read_and_aggregate_shared_ledgers(self):
        ledgers = {id_: {'payload': payload()} for id_ in (A, B)}
        with patch.object(admin, 'fetch_accounts', return_value=self.accounts), \
             patch.object(admin, 'fetch_ledgers', return_value=ledgers):
            for slot in admin.ADMIN_SLOTS:
                for id_ in (A, B):
                    status, result = self.request(slot, 'accounts/' + id_ + '/recommendation')
                    self.assertEqual(status, 200)
                    self.assertEqual(result['egg'], payload()['egg'])
                status, result = self.request(slot, 'aggregate', {'ids': [A, B], 'book': 'egg'})
                self.assertEqual(status, 200)
                self.assertEqual(result['rows'][0]['sum'], 10)

    def test_audit_stays_separate_when_admins_act_on_the_same_account(self):
        admin.audit('export', A, '管理员 1 导出', admin_slot='primary')
        admin.audit('export', A, '管理员 2 导出', admin_slot='secondary')
        for slot, title in [('primary', '管理员 1 导出'), ('secondary', '管理员 2 导出')]:
            self.assertEqual([e['target_name'] for e in self.request(slot, 'audit')[1]['entries']], [title])

    def test_both_admins_share_security_rules_and_see_only_their_own_actions(self):
        ip = '198.51.100.20'
        with patch.object(admin, 'supabase', return_value=(200, [])):
            self.assertEqual(self.request('secondary', 'security/block', {'ip': ip, 'blocked': True})[0], 200)
            self.assertEqual(self.request('primary', 'security')[1]['blocked'], [ip])
            self.assertEqual(self.request('primary', 'security')[1]['entries'], [])
            own = self.request('secondary', 'security')[1]
            self.assertEqual(own['blocked'], [ip])
            self.assertEqual(len(own['entries']), 1)
            self.assertIn('管理员提交封禁', own['entries'][0]['detail'])
            self.assertEqual(self.request('primary', 'security/block', {'ip': ip, 'blocked': False})[0], 200)
            self.assertEqual(self.request('secondary', 'security')[1]['blocked'], [])
            self.assertEqual(len(self.request('secondary', 'security')[1]['entries']), 1)
            self.assertIn('管理员解除封禁', self.request('primary', 'security')[1]['entries'][0]['detail'])


if __name__ == '__main__':
    unittest.main()
