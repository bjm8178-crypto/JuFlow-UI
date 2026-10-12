"""Stdlib auth and live HTTP regression tests; all state is temporary."""
import http.client
import importlib
import json
import os
from pathlib import Path
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import auth
import server


class AuthTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.env = patch.dict(os.environ, {
            'JUFLOW_AUTH_DB': str(Path(self.tmp.name) / 'auth.sqlite3'),
            'JUFLOW_ALLOW_SIGNUP': '0', 'JUFLOW_HTTPS': '0',
        })
        self.env.start()
        self.addCleanup(self.restore_auth)
        importlib.reload(auth)
        auth.init_auth()
        self.old_db, self.old_token = server.DB, server.TOKEN
        server.DB = Path(self.tmp.name) / 'sales.sqlite3'
        server.TOKEN = 'isolated-test-cashier-token'
        self.addCleanup(self.restore_server)
        self.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_http)
        self.account = {'email': 'admin@example.com', 'password': 'test-password', 'name': 'Admin'}

    def restore_auth(self):
        self.env.stop()
        importlib.reload(auth)

    def restore_server(self):
        server.DB, server.TOKEN = self.old_db, self.old_token

    def stop_http(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join()

    def request(self, method, path, payload=None, cookie=None, headers=None, raw=None):
        headers = dict(headers or {})
        if cookie:
            headers['Cookie'] = cookie
        body = raw
        if payload is not None:
            body = json.dumps(payload).encode()
            headers['Content-Type'] = 'application/json'
        connection = http.client.HTTPConnection(*self.httpd.server_address, timeout=5)
        try:
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def signup(self):
        self.assertEqual(self.request('POST', '/api/auth/signup', self.account)[0], 201)

    def login(self):
        status, headers, _ = self.request('POST', '/api/auth/login', self.account)
        self.assertEqual(status, 200)
        return headers['Set-Cookie'].split(';')[0]

    def test_signup_policy_and_validation(self):
        bad = dict(self.account, password='short')
        self.assertEqual(self.request('POST', '/api/auth/signup', bad)[0], 400)
        self.signup()
        second = dict(self.account, email='second@example.com')
        self.assertEqual(self.request('POST', '/api/auth/signup', second)[0], 403)
        with patch.dict(os.environ, {'JUFLOW_ALLOW_SIGNUP': '1'}):
            importlib.reload(auth)
            self.assertEqual(self.request('POST', '/api/auth/signup', second)[0], 201)
            self.assertEqual(self.request('POST', '/api/auth/signup', second)[0], 400)

    def test_first_signup_is_serialized(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda i: auth.signup(f'user{i}@example.com', 'password123'), range(4)))
        self.assertEqual(sum(error is None for _, error in results), 1)
        self.assertEqual(sum(error == 'signup_disabled' for _, error in results), 3)

    def test_wrong_password_and_lock(self):
        self.signup()
        wrong = dict(self.account, password='wrong-password')
        for _ in range(5):
            self.assertEqual(self.request('POST', '/api/auth/login', wrong)[0], 401)
        status, _, body = self.request('POST', '/api/auth/login', self.account)
        self.assertEqual(status, 429)
        self.assertEqual(json.loads(body)['error'], 'locked')

    def test_session_cookie_current_user_logout_and_expiry(self):
        self.signup()
        cookie = self.login()
        handler = SimpleNamespace(headers={'Cookie': cookie})
        user = auth.current_user(handler)
        self.assertEqual(set(user), {'id', 'email', 'name', 'role'})
        self.assertEqual(user['email'], self.account['email'])
        status, headers, _ = self.request('POST', '/api/auth/login', self.account)
        for flag in ('HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=43200'):
            self.assertIn(flag, headers['Set-Cookie'])
        self.assertEqual(self.request('GET', '/api/auth/me', cookie=cookie)[0], 200)
        self.assertEqual(self.request('GET', '/orders.html', cookie=cookie)[0], 200)
        with auth._db() as db:
            token = cookie.split('=', 1)[1]
            stored = db.execute('SELECT token_hash FROM sessions WHERE token_hash=?', (auth._th(token),)).fetchone()
            self.assertIsNotNone(stored)
            self.assertNotEqual(stored['token_hash'], token)
        status, headers, _ = self.request('POST', '/api/auth/logout', cookie=cookie)
        self.assertEqual(status, 200)
        self.assertIn('Max-Age=0', headers['Set-Cookie'])
        self.assertIsNone(auth.current_user(handler))
        cookie = self.login()
        with auth._db() as db:
            db.execute('UPDATE sessions SET expires_at=?', (time.time() - 1,))
        self.assertEqual(self.request('GET', '/api/auth/me', cookie=cookie)[0], 401)

    def test_gates_public_assets_and_head(self):
        for path in ('/', '/orders.html'):
            status, headers, _ = self.request('GET', path)
            self.assertEqual(status, 302)
            self.assertTrue(headers['Location'].startswith('/login.html?next='))
        for path in ('/api/anything', '/api/sales/summary', '/api/auth/me'):
            self.assertEqual(self.request('GET', path)[0], 401)
        for path in ('/login.html', '/signup.html', '/styles.css', '/app.js'):
            self.assertEqual(self.request('GET', path)[0], 200)
        self.signup()
        cookie = self.login()
        for path, expected in (('/orders.html', 302), ('/api/sales/summary', 401), ('/api/auth/me', 401), ('/login.html', 200), ('/server.py', 404), ('/api/auth/login', 405)):
            status, _, body = self.request('HEAD', path)
            self.assertEqual((status, body), (expected, b''))
        for path in ('/orders.html', '/api/sales/summary', '/api/auth/me'):
            status, _, body = self.request('HEAD', path, cookie=cookie)
            self.assertEqual((status, body), (200, b''))

    def test_private_files_encoded_and_authenticated(self):
        self.signup()
        cookie = self.login()
        for credential in (None, cookie):
            for path in ('/server.py', '/auth.py', '/data.sqlite3', '/.juflow-auth.sqlite3', '/.juflow-sales.sqlite3', '/.cashier-token', '/.env', '/%2eenv', '/%2ejuflow-auth.sqlite3', '/server%2epy', '/folder/%2eprivate', '/%2e%2e/server.py'):
                with self.subTest(path=path, authenticated=bool(credential)):
                    self.assertEqual(self.request('GET', path, cookie=credential)[0], 404)

    def test_malformed_bodies(self):
        for raw in (b'[]', b'null', b'42', b'"string"', b'{', b'\xff', b'{"email":42}', b'{"password":[]}', b'{"name":null}'):
            self.assertEqual(self.request('POST', '/api/auth/signup', raw=raw)[0], 400)
        for length in ('-1', 'bad', '10001'):
            self.assertEqual(self.request('POST', '/api/auth/login', headers={'Content-Length': length}, raw=b'')[0], 400)
        self.assertEqual(self.request('POST', '/api/auth/login', headers={'Transfer-Encoding': 'chunked'}, raw=b'')[0], 400)

    def test_cashier_exemption_and_authenticated_summary(self):
        sale = {'transaction_id': 'auth-test-sale', 'device_id': 'test-cashier',
                'sold_at': '2026-09-28T16:01:00Z', 'status': 'completed', 'payment_method': 'cash',
                'items': [{'product_id': 'pork', 'name': 'Pork Paksiw', 'quantity': 2, 'unit_price_centavos': 7500}]}
        endpoint = '/api/cashier/sales'
        self.assertEqual(self.request('POST', endpoint, sale)[0], 401)
        bearer = {'Authorization': 'Bearer ' + server.TOKEN}
        self.assertEqual(self.request('POST', endpoint, sale, headers=bearer)[0], 201)
        self.assertEqual(self.request('POST', endpoint, sale, headers=bearer)[0], 200)
        path = '/api/sales/summary?date=2026-09-29'
        self.assertEqual(self.request('GET', path, headers=bearer)[0], 401)
        self.signup()
        cookie = self.login()
        self.assertEqual(self.request('POST', endpoint, sale, cookie=cookie)[0], 401)
        status, _, body = self.request('GET', path, cookie=cookie)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['total_centavos'], 15000)
        self.assertEqual(json.loads(body)['transaction_count'], 1)


if __name__ == '__main__':
    unittest.main()
