import json
import os
import tempfile
import unittest
import uuid
from pathlib import Path
from contextlib import closing

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "mak_backend.settings")
import django
django.setup()
from django.test import Client, override_settings
from mak_backend import storage


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        directory = Path(self.tmp.name)
        self.override = override_settings(DATA_DIR=directory, QUOTES_DB_PATH=directory / "quotes.sqlite3", QUOTES_PATH=directory / "quotes.jsonl", ADMIN_TOKEN="test-admin", TRUST_PROXY=False)
        self.override.enable()
        self.client = Client()
        self.body = {"requestId": str(uuid.uuid4()), "name": "عميل تجريبي", "email": "", "phone": "01000000000", "projectType": "طلب منزل", "message": "ماسورة 25 مم"}

    def tearDown(self):
        self.override.disable()
        self.tmp.cleanup()

    def post(self, body=None, **headers):
        return self.client.post("/api/quotes", json.dumps(self.body if body is None else body), content_type="application/json", **headers)

    def test_private_files_blocked(self):
        for path in ("/data/quotes.jsonl", "/data/quotes.sqlite3", "/data/catalog.json", "/mak_backend/settings.py", "/.env", "/.openai/hosting.json", "/index.html.bak", "/BACKEND.md", "/db/schema.ts", "/unknown-route"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 404)

    def test_private_backup_and_safe_restore(self):
        auth={'HTTP_AUTHORIZATION':'Bearer test-admin'}
        first=self.post().json()['quoteId']
        second=self.post({**self.body,'requestId':str(uuid.uuid4()),'name':'عميل آخر'}).json()['quoteId']
        listed=self.client.get('/api/admin/backups',**auth).json()
        self.assertEqual(listed['state']['revision'],listed['state']['saved_revision'])
        backup_id=listed['state']['last_id'];path='/api/admin/backups/'+backup_id
        self.assertEqual(self.client.get(path).status_code,401)
        envelope=self.client.get(path,**auth).json()
        snapshot=json.loads(envelope['data']);self.assertEqual(len(snapshot['tables']['quotes']),2)
        self.assertIn('عميل آخر',envelope['data'])
        self.client.patch('/api/quotes/'+first,json.dumps({'status':'fulfilled','notes':'تم التسليم','version':0}),content_type='application/json',**auth)
        with closing(storage.connect()) as db:
            db.execute('DELETE FROM quote_notifications WHERE quote_id=?',(second,));db.execute('DELETE FROM quotes WHERE id=?',(second,));db.commit()
        preview=self.client.post(path+'/restore',json.dumps({'mode':'preview'}),content_type='application/json',**auth)
        self.assertEqual(preview.json(),{'missing':1,'preserved':1})
        restored=self.client.post(path+'/restore',json.dumps({'mode':'restore','confirm':backup_id}),content_type='application/json',**auth)
        self.assertEqual(restored.json()['restored'],1)
        with closing(storage.connect()) as db:
            self.assertEqual(db.execute('SELECT notes FROM quote_admin WHERE quote_id=?',(first,)).fetchone()[0],'تم التسليم')
            self.assertEqual(db.execute('SELECT state FROM quote_notifications WHERE quote_id=?',(second,)).fetchone()[0],'needs_review')
        file=Path(self.tmp.name) / 'backups' / (backup_id+'.json')
        self.assertEqual(file.stat().st_mode & 0o777,0o600)
        data=json.loads(file.read_text());data['sha256']='invalid';file.write_text(json.dumps(data))
        self.assertEqual(self.client.post(path+'/restore',json.dumps({'mode':'restore','confirm':backup_id}),content_type='application/json',**auth).status_code,422)

    def test_order_date_range(self):
        dates=['2026-10-01T20:59:59.999Z','2026-10-01T21:00:00.000Z','2026-10-02T23:59:59+03:00','2026-10-02T21:00:00.000Z']
        with closing(storage.connect()) as db:
            for value in dates:
                db.execute('INSERT INTO quotes VALUES (?,?,?,?,?,?,?,?)',(str(uuid.uuid4()),str(uuid.uuid4()),'inside','customer@example.com','','Home','Order',value))
            db.commit()
        params={'limit':'1','q':'inside','status':'new','createdFrom':'2026-10-01T21:00:00.000Z','createdBefore':'2026-10-02T21:00:00.000Z'}
        response=self.client.get('/api/quotes',params,HTTP_AUTHORIZATION='Bearer test-admin')
        self.assertEqual(response.status_code,200);self.assertEqual(response.json()['total'],2);self.assertEqual(response.json()['summary']['total'],4)
        params['offset']='1'
        self.assertEqual(len(self.client.get('/api/quotes',params,HTTP_AUTHORIZATION='Bearer test-admin').json()['quotes']),1)
        for value in ('2026-02-30T00:00:00.000Z','invalid','2026-10-03T00:00:00.000Z'):
            params['createdFrom']=value
            self.assertEqual(self.client.get('/api/quotes',params,HTTP_AUTHORIZATION='Bearer test-admin').status_code,400)

    def test_assets_and_catalog(self):
        for path in ("/", "/products", "/style.css", "/script.js", "/images/hero.jpg", "/images/pvc-coupling.jpeg", "/pricing.html", "/vendor/exceljs-4.4.0.min.js"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, path)
            response.close()
        expected = json.loads(Path("data/catalog.json").read_text())
        actual=self.client.get("/api/catalog").json()
        self.assertEqual([{key:value for key,value in item.items() if key not in ("active","version","createdAt","updatedAt")} for item in actual["products"]], expected["products"])
        self.assertEqual(self.client.get("/api/products").json()["products"], actual["products"])
        self.assertEqual(self.client.get('/product/'+expected['products'][0]['id']).status_code, 200)
        self.assertEqual(self.client.get('/product/missing').status_code, 404)

    def test_save_persist_and_authorize(self):
        self.assertEqual(self.client.get("/api/health").json()["storage"], "ready")
        response = self.post()
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.json()["ok"])
        self.assertEqual(Client().get("/api/quotes").status_code, 401)
        self.assertEqual(Client().get("/api/quotes", HTTP_AUTHORIZATION="Bearer wrong").status_code, 401)
        saved = Client().get("/api/quotes", HTTP_AUTHORIZATION="Bearer test-admin").json()["quotes"]
        self.assertEqual(len(saved), 1)
        self.assertEqual(saved[0]["id"], response.json()["quoteId"])
        self.assertEqual(saved[0]["message"], self.body["message"])
        self.assertNotIn("requestId", saved[0])

    def test_admin_disabled_by_default(self):
        with override_settings(ADMIN_TOKEN=""):
            self.assertEqual(self.client.get("/api/quotes", HTTP_AUTHORIZATION="Bearer ").status_code, 401)

    def test_duplicate_and_conflicting_retry(self):
        original = self.post().json()
        for _ in range(7):
            response = self.post()
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), original)
        changed = {**self.body, "message": "different"}
        self.assertEqual(self.post(changed).status_code, 409)
        with closing(storage.connect()) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM quotes").fetchone()[0], 1)

    def test_limits_persist_and_forwarding_not_trusted(self):
        for i in range(6):
            body = {**self.body, "requestId": str(uuid.uuid4())}
            response = self.post(body, HTTP_X_FORWARDED_FOR=f"192.0.2.{i}")
            self.assertEqual(response.status_code, 201 if i < 5 else 429)
        self.assertEqual(response["Retry-After"], "600")

    def test_validation(self):
        changes = ({"name": ""}, {"phone": "", "email": ""}, {"email": "invalid"}, {"phone": "bad"}, {"message": "x"*2001}, {"name": ["wrong"]}, {"requestId": "invalid"})
        for change in changes:
            self.assertEqual(self.post({**self.body, **change}).status_code, 400, change.keys())
        for body in ([], None, "string", 42):
            self.assertEqual(self.client.post('/api/quotes', json.dumps(body), content_type='application/json').status_code, 400)
        self.assertEqual(self.client.post('/api/quotes', '{broken', content_type='application/json').status_code, 400)
        self.assertEqual(self.post({**self.body, "phone": "", "email": "test@example.com"}).status_code, 201)

    def test_origin_content_type_size_methods(self):
        self.assertEqual(self.post(HTTP_ORIGIN="https://evil.example").status_code, 403)
        self.assertEqual(self.client.post('/api/quotes', json.dumps(self.body), content_type='text/plain').status_code, 415)
        self.assertEqual(self.client.post('/api/quotes', ' '*17000, content_type='application/json').status_code, 413)
        self.assertEqual(self.client.delete('/api/quotes').status_code, 405)
        self.assertEqual(self.client.post('/style.css').status_code, 405)
        self.assertEqual(self.post(HTTP_ORIGIN="http://testserver").status_code, 201)

    def test_storage_failure_never_confirms_success(self):
        with override_settings(QUOTES_DB_PATH=Path(self.tmp.name) / 'missing' / 'quotes.sqlite3'):
            response = self.post()
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('quoteId', response.json())

    def test_legacy_requests_migrate_once(self):
        legacy = {"id": str(uuid.uuid4()), "name": "Legacy", "email": "test@example.com", "projectType": "Home", "message": "Existing request", "createdAt": "2026-09-01T00:00:00Z"}
        Path(self.tmp.name, 'quotes.jsonl').write_text(json.dumps(legacy)+'\n')
        for _ in range(2):
            with closing(storage.connect()) as db:
                rows = db.execute('SELECT * FROM quotes').fetchall()
                self.assertEqual(len(rows), 1)
                self.assertEqual(storage.serialize(rows[0])['id'], legacy['id'])


    def test_dashboard_status_search_and_stale_update(self):
        quote_id = self.post().json()['quoteId']
        self.assertEqual(self.client.get('/api/admin/session').status_code,401)
        auth={'HTTP_AUTHORIZATION':'Bearer test-admin'}
        self.assertEqual(self.client.get('/api/admin/session',**auth).status_code,200)
        data=self.client.get('/api/quotes?limit=30',**auth).json()
        self.assertEqual(data['summary']['new'],1)
        self.assertEqual(data['quotes'][0]['notification']['state'],'pending')
        change={'status':'contacted','notes':'تم الاتصال','version':0}
        url='/api/quotes/'+quote_id
        self.assertEqual(self.client.patch(url,json.dumps(change),content_type='application/json').status_code,401)
        response=self.client.patch(url,json.dumps(change),content_type='application/json',**auth)
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['quote']['version'],1)
        self.assertEqual(self.client.patch(url,json.dumps(change),content_type='application/json',**auth).status_code,409)
        results=self.client.get('/api/quotes?limit=30&status=contacted&q=01000000000',**auth).json()
        self.assertEqual(results['total'],1)
        self.assertEqual(results['quotes'][0]['notes'],change['notes'])
        self.assertEqual(self.client.get('/api/quotes?limit=30&status=new',**auth).json()['total'],0)
        self.assertEqual(self.client.get('/api/quotes?limit=30&status=invalid',**auth).status_code,400)

    def test_email_submission_failure_and_retry(self):
        import io
        from unittest.mock import patch
        from mak_backend import notifications
        with override_settings(RESEND_API_KEY='test-api-key',NOTIFICATION_FROM='orders@example.com',NOTIFICATION_TO='owner@example.com'):
            with patch('mak_backend.notifications.urlopen',return_value=io.BytesIO(b'{"id":"provider-test-id"}')) as send:
                receipt=self.post().json()
                self.assertEqual(send.call_count,0)
                with closing(storage.connect()) as db:
                    self.assertEqual(db.execute('SELECT state FROM quote_notifications').fetchone()[0],'pending')
                notifications.process_pending()
                self.assertEqual(send.call_count,1)
                self.assertIn(receipt['quoteId'],send.call_args.args[0].data.decode())
                notifications.process_pending()
                self.assertEqual(send.call_count,1)
            with closing(storage.connect()) as db:
                self.assertEqual(db.execute('SELECT state FROM quote_notifications').fetchone()[0],'submitted')
            with patch('mak_backend.notifications.urlopen',side_effect=OSError('Provider unavailable')):
                response=self.post({**self.body,'requestId':str(uuid.uuid4())})
                self.assertEqual(response.status_code,201)
                notifications.process_pending()
            with closing(storage.connect()) as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM quote_notifications WHERE state='failed'").fetchone()[0],1)
            with patch('mak_backend.notifications.urlopen',return_value=io.BytesIO(b'{"id":"retry-id"}')) as send:
                response=self.client.post('/api/admin/notifications/retry','{}',content_type='application/json',HTTP_AUTHORIZATION='Bearer test-admin')
                self.assertEqual(response.status_code,200)
                self.assertEqual(response.json()['state'],'queued')
                self.assertEqual(send.call_count,0)
                notifications.process_pending()
                self.assertEqual(send.call_count,1)

    def test_background_command_recovers_saved_work_and_creates_backup(self):
        import io
        from unittest.mock import patch
        from django.core.management import call_command
        with override_settings(RESEND_API_KEY='test-api-key',NOTIFICATION_FROM='orders@example.com',NOTIFICATION_TO='owner@example.com'):
            with patch('mak_backend.notifications.urlopen',side_effect=AssertionError('Request must not send email')), patch('mak_backend.backups.ensure_backup',side_effect=AssertionError('Request must not write backup')):
                self.assertEqual(self.post().status_code,201)
            with patch('mak_backend.notifications.urlopen',return_value=io.BytesIO(b'{"id":"worker-id"}')) as send:
                call_command('run_outbox',once=True,stdout=io.StringIO())
                self.assertEqual(send.call_count,1)
            with closing(storage.connect()) as db:
                self.assertEqual(db.execute('SELECT state FROM quote_notifications').fetchone()[0],'submitted')
                state=db.execute('SELECT * FROM backup_state').fetchone()
                self.assertEqual(state['revision'],state['saved_revision'])
                self.assertTrue(state['last_id'])

    def test_notification_leases_and_expired_retry_window(self):
        import time
        from unittest.mock import patch
        from mak_backend import notifications
        quote_id=self.post().json()['quoteId']
        with override_settings(RESEND_API_KEY='test-api-key',NOTIFICATION_FROM='orders@example.com',NOTIFICATION_TO='owner@example.com'):
            with closing(storage.connect()) as db:
                with db:db.execute('UPDATE quote_notifications SET locked_until=?',(int(time.time())+60,))
            with patch('mak_backend.notifications.urlopen') as send:
                self.assertEqual(notifications.process_pending(),0)
                notifications.deliver(quote_id)
                send.assert_not_called()
                with closing(storage.connect()) as db:
                    with db:db.execute('UPDATE quote_notifications SET locked_until=0,first_attempt=?',(int(time.time())-24*3600,))
                notifications.process_pending()
                send.assert_not_called()
            with closing(storage.connect()) as db:
                self.assertEqual(db.execute('SELECT state FROM quote_notifications').fetchone()[0],'needs_review')

if __name__ == '__main__':
    unittest.main()
