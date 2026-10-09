import json
import tempfile
import unittest
import uuid
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from django.test import Client, override_settings
from mak_backend import storage
from mak_backend.models import Product


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        root=Path(self.tmp.name)
        self.override=override_settings(DATA_DIR=root,QUOTES_DB_PATH=root/'quotes.sqlite3',QUOTES_PATH=root/'quotes.jsonl',ADMIN_TOKEN='owner')
        self.override.enable();self.addCleanup(self.override.disable)
        self.client=Client();self.seed=json.loads(Path('data/catalog.json').read_text())
        self.product={**self.seed['products'][0],'id':'new-product','price':12.35,'active':True}

    def call(self,path,method='get',body=None,admin=True,**headers):
        if admin:headers['HTTP_AUTHORIZATION']='Bearer owner'
        return getattr(self.client,method)(path,{} if body is None else json.dumps(body),content_type='application/json',**headers)

    def test_seed_only_once_database_is_only_runtime_source(self):
        data=self.client.get('/api/catalog').json()
        self.assertEqual(len(data['products']),len(self.seed['products']))
        for actual,original in zip(data['products'],self.seed['products']):
            self.assertEqual({key:actual[key] for key in original},original)
        with closing(storage.connect()) as db:
            db.execute('UPDATE products SET price=? WHERE id=?',(1.25,self.product['id'].replace('new-product',self.seed['products'][0]['id'])));db.commit()
        with override_settings(CATALOG_PATH=Path('/missing-seed')):
            self.assertEqual(self.client.get('/api/catalog').json()['products'][0]['price'],1.25)
            with closing(storage.connect()) as db:db.execute('DELETE FROM products');db.commit()
            self.assertEqual(self.client.get('/api/catalog').json()['products'],[])

    def test_crud_prices_availability_versions_and_auth(self):
        for method in ('post','put','patch','delete'):
            path='/api/products'+('' if method=='post' else '/new-product')
            self.assertEqual(self.call(path,method,self.product,False).status_code,401)
        self.assertEqual(self.client.get('/api/products?includeInactive=1').status_code,401)
        self.assertEqual(self.call('/api/products','post',self.product).status_code,201)
        self.assertEqual(self.call('/api/products','post',self.product).status_code,200)
        path='/api/products/new-product'
        updated=self.call(path,'patch',{'version':0,'price':33.45,'ar':{'name':'منتج جديد'}})
        self.assertEqual(updated.status_code,200);self.assertEqual(updated.json()['product']['ar']['size'],self.product['ar']['size'])
        self.assertEqual(self.call(path,'patch',{'version':0,'price':1}).status_code,409)
        self.assertEqual(self.call(path,'patch',{'version':1,'active':False}).status_code,200)
        self.assertEqual(self.client.get(path).status_code,404)
        self.assertFalse(any(p['id']=='new-product' for p in self.client.get('/api/catalog').json()['products']))
        self.assertTrue(any(p['id']=='new-product' and not p['active'] for p in self.call('/api/products?includeInactive=1').json()['products']))
        self.assertEqual(self.call(path,'put',{**self.product,'version':2,'price':0}).status_code,200)
        self.assertEqual(self.call(path,'delete',{'version':2}).status_code,409)
        self.assertEqual(self.call(path,'delete',{'version':3}).status_code,200)
        self.assertEqual(self.call(path,'delete',{'version':3}).status_code,200)
        self.assertEqual(self.client.get(path).status_code,404)
        self.assertEqual(self.client.get('/product/new-product').status_code,404)
        self.assertEqual(self.call('/api/products','post',self.product).status_code,409)

    def test_validation_etag_and_raw_database_edits(self):
        response=self.client.get('/api/catalog');etag=response['ETag']
        self.assertEqual(self.client.get('/api/catalog',HTTP_IF_NONE_MATCH=etag).status_code,304)
        with closing(storage.connect()) as db:
            db.execute('UPDATE products SET name=? WHERE id=?',('Changed in DB',self.seed['products'][0]['id']));db.commit()
        changed=self.client.get('/api/catalog',HTTP_IF_NONE_MATCH=etag)
        self.assertEqual(changed.status_code,200);self.assertEqual(changed.json()['products'][0]['version'],1)
        for extra in ({'price':-1},{'price':1.234},{'price':'12'},{'active':None},{'image':'javascript:alert(1)'},{'id':'../secret'}):
            self.assertEqual(self.call('/api/products','post',{**self.product,**extra}).status_code,400)
        self.assertEqual(self.call('/api/products','post',self.product,HTTP_ORIGIN='https://evil.example').status_code,403)
        with patch('mak_backend.storage.connect',side_effect=OSError('offline')):
            self.assertEqual(self.client.get('/api/catalog').status_code,503)

    def test_order_prices_are_server_owned_immutable_and_backed_up(self):
        self.call('/api/products','post',self.product)
        self.call('/api/products/new-product','patch',{'version':0,'price':45.67})
        body={'requestId':str(uuid.uuid4()),'name':'Client','phone':'01000000000','projectType':'Home','message':'fake price 0','items':[{'productId':'new-product','quantity':3}]}
        response=self.call('/api/quotes','post',body,False);self.assertEqual(response.status_code,201)
        receipt=response.json();self.assertEqual(receipt['items'][0]['unitPrice'],45.67);self.assertEqual(receipt['items'][0]['total'],137.01)
        self.call('/api/products/new-product','patch',{'version':1,'price':55.55})
        self.assertEqual(self.call('/api/quotes','post',body,False).json(),receipt)
        self.assertEqual(self.call('/api/quotes','post',{**body,'items':[{'productId':'new-product','quantity':4}]},False).status_code,409)
        self.assertEqual(self.call('/api/quotes','post',{**body,'requestId':str(uuid.uuid4()),'items':[{'productId':'new-product','quantity':1,'unitPrice':0}]},False).status_code,400)
        self.assertEqual(self.call('/api/quotes','post',{**body,'requestId':str(uuid.uuid4()),'price':0},False).status_code,400)
        self.call('/api/products/new-product','patch',{'version':2,'active':False})
        self.assertEqual(self.call('/api/quotes','post',{**body,'requestId':str(uuid.uuid4())},False).status_code,409)
        self.call('/api/products/new-product','delete',{'version':3})
        quote=self.call('/api/quotes?limit=30').json()['quotes'][0]
        self.assertEqual(quote['items'][0]['unitPrice'],45.67)
        updated=self.call('/api/quotes/'+receipt['quoteId'],'patch',{'version':0,'status':'contacted','notes':'Preserved'})
        self.assertEqual(updated.status_code,200);self.assertEqual(updated.json()['quote']['items'][0]['unitPrice'],45.67)
        backup=self.call('/api/admin/backups','post').json()['backup'];snapshot=json.loads(self.call('/api/admin/backups/'+backup['id']).json()['data'])
        self.assertEqual(snapshot['tables']['quote_items'][0]['unit_price'],45.67)
        self.assertTrue(any(p['id']=='new-product' and p['deleted_at'] for p in snapshot['tables']['products']))
        with closing(storage.connect()) as db:
            db.execute('DELETE FROM quote_items');db.commit()
        self.assertEqual(self.call('/api/admin/backups/'+backup['id']+'/restore','post',{'mode':'restore','confirm':backup['id']}).status_code,200)
        self.assertEqual(self.call('/api/quotes?limit=30').json()['quotes'][0]['items'][0]['unitPrice'],45.67)

    def test_django_model_routes_to_business_database(self):
        self.assertEqual(Product._meta.db_table,'products')
        self.assertEqual(Product.objects.all().db,'business')
