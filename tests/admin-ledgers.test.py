"""Focused read-only admin book tests; no live credentials or database writes."""
import copy
import csv
import importlib.util
import io
import os
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
    def _origin_ok(self): return True
    def _session(self): return {'csrf': 'test'} if self.authenticated else None
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
        with patch.object(admin, 'supabase', return_value=(200, [{'payload': {'egg': egg, 'sales': {}}, 'revision': 7, 'updated_at': 'now'}])) as request:
            admin.Handler.do_GET(handler)
            self.assertEqual(handler.response[1], {'egg': egg, 'revision': 7, 'updated_at': 'now'})
            self.assertIn('user_id=eq.' + A, request.call_args.args[0])
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

    def test_missing_egg_book_aggregates_as_zero(self):
        ledgers = {A: {'payload': {'egg': book('放蛋物品', [2])}}, B: {'payload': {}}}
        with patch.object(admin, 'fetch_ledgers', return_value=ledgers):
            self.assertEqual(admin.aggregate([A, B], {}, 'egg', 'sum')['rows'][0]['values'], [2, 0])

    def test_account_overview_includes_egg_items_and_records(self):
        def fake_supabase(url):
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

    def test_invalid_book_and_unauthenticated_requests_are_rejected(self):
        for key in ('invalid', {}, None):
            handler = Handler(key)
            admin.Handler.do_POST(handler)
            self.assertEqual(handler.response[0], 400)
        handler = Handler(authenticated=False)
        admin.Handler.do_POST(handler)
        self.assertEqual(handler.response[0], 401)

if __name__ == '__main__':
    unittest.main()
