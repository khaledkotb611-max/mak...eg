import hashlib
import io
import json
import tempfile
import time
import unittest
import uuid
from contextlib import closing
from pathlib import Path
from urllib.error import HTTPError
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import Client, override_settings

from mak_backend import notifications, operations, storage


class OperationalTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        path=Path(self.tmp.name)
        override=override_settings(DATA_DIR=path,QUOTES_DB_PATH=path/'quotes.sqlite3',QUOTES_PATH=path/'quotes.jsonl',
                                   ADMIN_TOKEN='test-admin',RESEND_API_KEY='fake-key',NOTIFICATION_FROM='orders@example.com',NOTIFICATION_TO='owner@example.com')
        override.enable();self.addCleanup(override.disable)
        self.client=Client();self.auth={'HTTP_AUTHORIZATION':'Bearer test-admin'}
        payload={'requestId':str(uuid.uuid4()),'name':'عميل','phone':'01000000000','projectType':'منزل','message':'طلب جديد'}
        self.id=self.client.post('/api/quotes',json.dumps(payload),content_type='application/json').json()['quoteId']

    def notice(self):
        with closing(storage.connect()) as db:
            return dict(db.execute('SELECT * FROM quote_notifications WHERE quote_id=?',(self.id,)).fetchone())

    def provider_error(self, status, name='', retry=None):
        return HTTPError('https://api.resend.com/emails',status,'Rejected',{'Retry-After':retry} if retry else {},io.BytesIO(json.dumps({'name':name}).encode()))

    def test_health_is_private_and_detects_stale_worker_without_leaking_customer_data(self):
        self.assertEqual(self.client.get('/api/admin/health').status_code,401)
        data=self.client.get('/api/admin/health',**self.auth).json()
        self.assertEqual(data['worker']['state'],'not_started');self.assertEqual(data['notifications']['counts']['pending'],1)
        self.assertNotIn(self.id,json.dumps(data));self.assertNotIn('fake-key',json.dumps(data))
        operations.heartbeat('worker',int(time.time()),90)
        call_command('check_outbox',stdout=io.StringIO())
        with closing(storage.connect()) as db:
            with db:db.execute('UPDATE background_workers SET last_seen=?',(int(time.time())-120,))
        self.assertEqual(self.client.get('/api/admin/health',**self.auth).json()['worker']['state'],'stale')
        with self.assertRaises(CommandError):call_command('check_outbox',stdout=io.StringIO())
        with override_settings(QUOTES_DB_PATH=Path(self.tmp.name)/'missing'/'quotes.sqlite3'):
            self.assertEqual(self.client.get('/api/admin/health',**self.auth).status_code,503)

    def test_permanent_rejection_pauses_until_explicit_retry_and_keeps_payload(self):
        with patch('mak_backend.notifications.urlopen',side_effect=self.provider_error(403,'validation_error')) as send:
            notifications.process_pending();self.assertEqual(self.notice()['state'],'action_required')
            notifications.process_pending();self.assertEqual(send.call_count,1)
        payload=self.notice()['payload']
        self.assertEqual(self.client.post('/api/admin/notifications/retry','{}',content_type='application/json',**self.auth).status_code,200)
        with patch('mak_backend.notifications.urlopen',return_value=io.BytesIO(b'{"id":"fixed"}')):
            notifications.process_pending()
        self.assertEqual(self.notice()['state'],'submitted');self.assertEqual(self.notice()['payload'],payload)

    def test_rate_limit_retry_after_survives_manual_retry(self):
        start=int(time.time())
        with patch('mak_backend.notifications.urlopen',side_effect=self.provider_error(429,'rate_limit_exceeded','900')):
            notifications.process_pending()
        row=self.notice();self.assertEqual(row['state'],'failed');self.assertGreaterEqual(row['next_attempt'],start+900)
        self.client.post('/api/admin/notifications/retry','{}',content_type='application/json',**self.auth)
        self.assertEqual(self.notice()['next_attempt'],row['next_attempt'])
        with patch('mak_backend.notifications.urlopen') as send:
            notifications.process_pending();send.assert_not_called()
        self.assertEqual(notifications.retry_delay('invalid',1),120)
        self.assertEqual(notifications.retry_delay('nan',1),120)

    def test_idempotency_conflict_requires_review_and_cannot_be_forced(self):
        with patch('mak_backend.notifications.urlopen',side_effect=self.provider_error(409,'invalid_idempotent_request')):
            notifications.process_pending()
        self.assertEqual(self.notice()['state'],'needs_review')
        self.client.post('/api/admin/notifications/retry','{}',content_type='application/json',**self.auth)
        with patch('mak_backend.notifications.urlopen') as send:
            notifications.process_pending();send.assert_not_called()
        self.assertEqual(notifications.failure_state(409,'concurrent_idempotent_requests'),'failed')

    def test_expired_worker_cannot_overwrite_newer_delivery(self):
        def replacement(*args,**kwargs):
            with closing(storage.connect()) as db:
                with db:db.execute("UPDATE quote_notifications SET state='submitted',locked_until=0,provider_id='newer-worker' WHERE quote_id=?",(self.id,))
            return io.BytesIO(b'{"id":"old-worker"}')
        with patch('mak_backend.notifications.urlopen',side_effect=replacement):notifications.process_pending()
        self.assertEqual(self.notice()['provider_id'],'newer-worker');self.assertEqual(self.notice()['state'],'submitted')

    def test_order_history_is_atomic_and_stale_update_adds_no_event(self):
        url='/api/quotes/'+self.id
        change=json.dumps({'status':'contacted','notes':'ملاحظة خاصة','version':0})
        self.assertEqual(self.client.patch(url,change,content_type='application/json',**self.auth).status_code,200)
        self.assertEqual(self.client.patch(url,change,content_type='application/json',**self.auth).status_code,409)
        history=self.client.get(url+'/history',**self.auth).json()['events']
        self.assertEqual(len(history),1);self.assertEqual(history[0]['actor'],'server-api')
        self.assertTrue(history[0]['notesChanged']);self.assertEqual(history[0]['previousStatus'],'new')
        self.assertNotIn('ملاحظة خاصة',json.dumps(history,ensure_ascii=False))
        self.assertEqual(self.client.get(url+'/history').status_code,401)
        with closing(storage.connect()) as db:
            db.execute("CREATE TRIGGER reject_event BEFORE INSERT ON quote_events BEGIN SELECT RAISE(ABORT,'test failure'); END")
        change=json.dumps({'status':'fulfilled','notes':'Other','version':1})
        self.assertEqual(self.client.patch(url,change,content_type='application/json',**self.auth).status_code,503)
        with closing(storage.connect()) as db:
            self.assertEqual(db.execute('SELECT status FROM quote_admin WHERE quote_id=?',(self.id,)).fetchone()[0],'contacted')

    def test_backup_restores_history_and_reads_legacy_snapshots(self):
        self.client.patch('/api/quotes/'+self.id,json.dumps({'status':'contacted','notes':'Called','version':0}),content_type='application/json',**self.auth)
        backup=self.client.post('/api/admin/backups','{}',content_type='application/json',**self.auth).json()['backup']['id']
        path='/api/admin/backups/'+backup
        with closing(storage.connect()) as db:
            with db:
                for table in ('quote_events','quote_admin','quote_notifications'):db.execute(f'DELETE FROM {table} WHERE quote_id=?',(self.id,))
                db.execute('DELETE FROM quotes WHERE id=?',(self.id,))
        result=self.client.post(path+'/restore',json.dumps({'mode':'restore','confirm':backup}),content_type='application/json',**self.auth)
        self.assertEqual(result.status_code,200)
        self.assertEqual(len(self.client.get('/api/quotes/'+self.id+'/history',**self.auth).json()['events']),1)
        file=Path(self.tmp.name)/'backups'/(backup+'.json');envelope=json.loads(file.read_text());snapshot=json.loads(envelope['data'])
        del snapshot['tables']['quote_events'];envelope['data']=json.dumps(snapshot);envelope['sha256']=hashlib.sha256(envelope['data'].encode()).hexdigest();file.write_text(json.dumps(envelope))
        self.assertEqual(self.client.get(path,**self.auth).status_code,200)

    def test_reopened_storage_uses_read_only_migration_check(self):
        # Existing connections can reopen while another process holds a write transaction.
        with closing(storage.connect()) as first:
            first.execute('BEGIN IMMEDIATE')
            with closing(storage.connect()) as second:
                self.assertEqual(second.execute('SELECT COUNT(*) FROM quotes').fetchone()[0],1)
            first.rollback()
