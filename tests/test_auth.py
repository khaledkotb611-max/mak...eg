import io
import json
import tempfile
import uuid
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import Client, TestCase, override_settings

from mak_backend import storage


class StaffAuthenticationTests(TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        directory = Path(self.tmp.name)
        self.override = override_settings(DATA_DIR=directory, QUOTES_DB_PATH=directory / 'quotes.sqlite3',
                                          QUOTES_PATH=directory / 'quotes.jsonl', ADMIN_TOKEN='test-admin', TRUST_PROXY=False)
        self.override.enable()
        self.addCleanup(self.override.disable)
        self.client = Client(enforce_csrf_checks=True)
        self.password = 'Test-password-for-MAK-8624'
        self.staff = get_user_model().objects.create_user('owner', email='owner@example.com', password=self.password, is_staff=True)

    def login(self, client=None, email='owner@example.com', password=None, **extra):
        client = client or self.client
        client.get('/admin/login')
        return client.post('/admin/login', {'username':email, 'password':password or self.password,
                                           'csrfmiddlewaretoken':client.cookies['csrftoken'].value, **extra})

    def test_product_mutations_keep_staff_csrf_and_bearer_contracts(self):
        from pathlib import Path
        product={**json.loads(Path('data/catalog.json').read_text())['products'][0],'id':'session-product'}
        self.assertEqual(self.client.post('/api/products',json.dumps(product),content_type='application/json').status_code,401)
        self.login()
        self.assertEqual(self.client.post('/api/products',json.dumps(product),content_type='application/json').status_code,403)
        csrf=self.client.get('/api/admin/session').json()['csrfToken']
        self.assertEqual(self.client.post('/api/products',json.dumps(product),content_type='application/json',HTTP_X_CSRFTOKEN=csrf).status_code,201)
        path='/api/products/session-product'
        self.assertEqual(self.client.patch(path,json.dumps({'version':0,'price':3.45}),content_type='application/json').status_code,403)
        self.assertEqual(self.client.patch(path,json.dumps({'version':0,'price':3.45}),content_type='application/json',HTTP_X_CSRFTOKEN=csrf).status_code,200)
        self.assertEqual(self.client.delete(path,json.dumps({'version':1}),content_type='application/json').status_code,403)
        self.assertEqual(self.client.delete(path,json.dumps({'version':1}),content_type='application/json',HTTP_X_CSRFTOKEN=csrf).status_code,200)
        bearer=Client(enforce_csrf_checks=True)
        self.assertEqual(bearer.post('/api/products',json.dumps({**product,'id':'bearer-product'}),content_type='application/json',HTTP_AUTHORIZATION='Bearer test-admin').status_code,201)

    def test_private_shell_and_apis_require_active_staff(self):
        for path in ('/admin', '/admin/', '/admin.html'):
            response = self.client.get(path)
            self.assertEqual(response.status_code,302)
            self.assertTrue(response.url.startswith('/admin/login?next='))
        self.assertEqual(self.client.get('/api/quotes').status_code,401)
        for path in ('/auth.sqlite3', '/data/auth.sqlite3', '/deploy/entrypoint.sh', '/compose.yaml', '/mak_backend/templates/mak_backend/login.html'):
            self.assertEqual(self.client.get(path).status_code,404)
        ordinary = get_user_model().objects.create_user('customer',email='customer@example.com',password=self.password)
        self.assertEqual(self.login(email=ordinary.email).status_code,200)
        self.assertEqual(self.client.get('/api/quotes').status_code,401)
        self.client.force_login(ordinary)
        self.assertEqual(self.client.get('/api/quotes').status_code,401)
        self.assertEqual(self.client.get('/admin').status_code,302)
        self.client.logout()
        self.staff.is_active=False;self.staff.save()
        self.assertEqual(self.login().status_code,200)
        self.assertEqual(self.client.get('/api/quotes').status_code,401)

    def test_email_login_session_csrf_and_logout(self):
        self.assertEqual(self.client.post('/admin/login',{'username':self.staff.email,'password':self.password}).status_code,403)
        self.assertEqual(self.login(email='OWNER@EXAMPLE.COM').status_code,302)
        page=self.client.get('/admin');self.assertEqual(page.status_code,200);page.close()
        session=self.client.get('/api/admin/session').json()
        self.assertEqual(session['email'],self.staff.email)
        self.assertEqual(session['authMode'],'django')
        body={'requestId':str(uuid.uuid4()),'name':'عميل','phone':'01000000000','projectType':'منزل','message':'طلب جديد'}
        receipt=self.client.post('/api/quotes',json.dumps(body),content_type='application/json')
        self.assertEqual(receipt.status_code,201)  # Public ordering needs no staff CSRF token.
        path='/api/quotes/'+receipt.json()['quoteId']
        change=json.dumps({'status':'contacted','notes':'تم التواصل','version':0})
        self.assertEqual(self.client.patch(path,change,content_type='application/json').status_code,403)
        self.assertEqual(self.client.post('/api/admin/backups','{}',content_type='application/json').status_code,403)
        self.assertEqual(self.client.post('/api/admin/notifications/retry','{}',content_type='application/json').status_code,403)
        self.assertEqual(self.client.post('/api/admin/notifications/test','{}',content_type='application/json').status_code,403)
        self.assertEqual(self.client.patch(path,change,content_type='application/json',HTTP_X_CSRFTOKEN=session['csrfToken']).status_code,200)
        self.assertEqual(self.client.get(path+'/history').json()['events'][0]['actor'],self.staff.email)
        self.assertEqual(self.client.get('/admin/logout').status_code,405)
        self.assertEqual(self.client.post('/admin/logout').status_code,403)
        self.assertEqual(self.client.post('/admin/logout',HTTP_X_CSRFTOKEN=session['csrfToken']).status_code,302)
        self.assertEqual(self.client.get('/api/quotes').status_code,401)

    def test_disabled_staff_session_and_duplicate_email_cannot_access(self):
        self.assertEqual(self.login().status_code,302)
        self.staff.is_staff=False;self.staff.save()
        self.assertEqual(self.client.get('/api/quotes').status_code,401)
        self.client.logout()
        get_user_model().objects.create_user('duplicate',email=self.staff.email,password=self.password,is_staff=True)
        self.assertEqual(self.login().status_code,200)
        self.assertEqual(self.client.get('/api/quotes').status_code,401)

    def test_login_throttled_across_clients_and_open_redirect_rejected(self):
        for _ in range(5):
            self.assertEqual(self.login(password='incorrect').status_code,200)
        fresh=Client(enforce_csrf_checks=True)
        self.assertEqual(self.login(client=fresh).status_code,429)
        with closing(storage.connect()) as db:
            with db:db.execute('DELETE FROM quote_rate_limits')
        response=self.login(next='https://attacker.example/admin')
        self.assertEqual(response.url,'/admin')

    def test_bearer_tools_keep_access_without_cookie_csrf(self):
        auth={'HTTP_AUTHORIZATION':'Bearer test-admin'}
        self.assertEqual(self.client.get('/api/quotes',**auth).status_code,200)
        self.assertEqual(self.client.post('/api/admin/backups','{}',content_type='application/json',**auth).status_code,201)
        self.assertEqual(self.client.get('/api/quotes',HTTP_X_AUTHENTICATED_EMAIL=self.staff.email).status_code,401)

    def test_admin_creation_validates_password_and_does_not_overwrite(self):
        with patch('mak_backend.management.commands.createadmin.getpass',return_value='123'):
            with self.assertRaises(CommandError):
                call_command('createadmin',email='new@example.com',stdout=io.StringIO())
        self.assertFalse(get_user_model().objects.filter(email='new@example.com').exists())
        with patch('mak_backend.management.commands.createadmin.getpass',return_value=self.password):
            call_command('createadmin',email='new@example.com',stdout=io.StringIO())
        user=get_user_model().objects.get(email='new@example.com')
        self.assertTrue(user.is_staff);self.assertTrue(user.check_password(self.password));self.assertFalse(user.is_superuser)
        with self.assertRaises(CommandError):
            call_command('createadmin',email='NEW@EXAMPLE.COM',stdout=io.StringIO())
