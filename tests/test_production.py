import json
import os
import string
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class ProductionSettingsTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.env={**os.environ,'DJANGO_SETTINGS_MODULE':'mak_backend.settings','DJANGO_ENV':'production',
                  'DJANGO_SECRET_KEY':'Test-only-'+string.ascii_letters+string.digits,
                  'DJANGO_DEBUG':'false','DJANGO_ALLOWED_HOSTS':'orders.example.com','SITE_ORIGIN':'https://orders.example.com',
                  'DJANGO_TRUST_PROXY':'true','MAK_DATA_DIR':self.tmp.name}

    def run_settings(self, code, **changes):
        return subprocess.run([sys.executable,'-c',code],env={**self.env,**changes},capture_output=True,text=True,timeout=20)

    def test_production_rejects_unsafe_configuration(self):
        for change in ({'DJANGO_SECRET_KEY':''},{'DJANGO_SECRET_KEY':'x'*64},{'DJANGO_DEBUG':'true'},
                       {'DJANGO_ALLOWED_HOSTS':'*'},{'SITE_ORIGIN':'http://orders.example.com'},
                       {'SITE_ORIGIN':'https://attacker.example'},{'SITE_ORIGIN':'https://orders.example.com/admin'},
                       {'DJANGO_ENV':'typo'}):
            with self.subTest(change=tuple(change)):
                result=self.run_settings('import django; django.setup()',**change)
                self.assertNotEqual(result.returncode,0)
                self.assertIn('ImproperlyConfigured',result.stderr)

    def test_https_redirect_and_private_auth_database(self):
        code='''
import django, json
django.setup()
from django.conf import settings
from django.test import Client
from django.core.management import call_command
call_command('migrate',verbosity=0)
http=Client().get('/admin',HTTP_HOST='orders.example.com')
secure=Client().get('/admin/login',HTTP_HOST='orders.example.com',HTTP_X_FORWARDED_PROTO='https')
print(json.dumps({'redirect':http.status_code,'url':http.url,'login':secure.status_code,
                  'csrfSecure':secure.cookies['csrftoken']['secure'],'sessionSecure':settings.SESSION_COOKIE_SECURE,
                  'permission':settings.DATABASES['default']['NAME'].stat().st_mode & 0o777}))
'''
        result=self.run_settings(code)
        self.assertEqual(result.returncode,0,result.stderr)
        data=json.loads(result.stdout)
        self.assertEqual(data,{'redirect':301,'url':'https://orders.example.com/admin','login':200,
                               'csrfSecure':True,'sessionSecure':True,'permission':0o600})

    def test_trusted_proxy_is_explicit(self):
        result=self.run_settings("import django; django.setup(); from django.conf import settings; print(settings.SECURE_PROXY_SSL_HEADER)",DJANGO_TRUST_PROXY='false')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(result.stdout.strip(),'None')
