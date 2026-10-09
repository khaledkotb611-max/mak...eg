"""Database-owned catalog. The original file is read only by the one-time import."""
import hashlib
import json
import re
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from urllib.parse import urlsplit

from django.conf import settings
from django.views.decorators.csrf import csrf_exempt
from . import storage
from .auth import admin_api, authorized

COLUMNS = ('id','name','description','name_en','description_en','category','price','image',
           'details_ar','details_en','active','created_at','updated_at','position','version','deleted_at')


def validate(body):
    if not isinstance(body, dict) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,119}', body.get('id','')):
        raise ValueError('Invalid product ID')
    if body.get('category') not in ('pipes','fittings','poly') or type(body.get('active',True)) is not bool:
        raise ValueError('Invalid category or availability')
    if type(body.get('price')) not in (int,float) or isinstance(body['price'],bool):
        raise ValueError('Invalid price')
    try:
        amount=Decimal(str(body['price']))
        if not amount.is_finite() or amount<0 or amount>Decimal('9999999999.99') or amount!=amount.quantize(Decimal('.01')):
            raise ValueError('Invalid price')
    except InvalidOperation as exc:
        raise ValueError('Invalid price') from exc
    result={key:body[key] for key in ('id','category','price')}
    image=body.get('image','')
    # URLs are displayed only as images; executable schemes, relative traversal and credentials are rejected.
    if not isinstance(image,str) or len(image)>1000 or image and not re.fullmatch(r'/images/[A-Za-z0-9_.-]+|https://[^\s<>"\x27]+',image):
        raise ValueError('Invalid image')
    if image.startswith('https://'):
        parsed=urlsplit(image)
        if not parsed.hostname or parsed.username or parsed.password:raise ValueError('Invalid image')
    result.update(image=image,active=body.get('active',True))
    for language in ('ar','en'):
        local=body.get(language)
        if not isinstance(local,dict):raise ValueError('Both languages are required')
        result[language]={}
        for key,limit in (('name',200),('description',3000),('category',120),('size',120),('spec',250),('unit',80)):
            value=local.get(key,'')
            if not isinstance(value,str) or len(value.strip())>limit or key=='name' and not value.strip():
                raise ValueError('Invalid product text')
            result[language][key]=value.strip()
        if 'finish' in local:
            if not isinstance(local['finish'],str) or len(local['finish'].strip())>120:raise ValueError('Invalid finish')
            result[language]['finish']=local['finish'].strip()
    return result


def values(product, now, position=0):
    return (product['id'],product['ar']['name'],product['ar']['description'],product['en']['name'],
            product['en']['description'],product['category'],product['price'],product['image'],
            json.dumps({key:value for key,value in product['ar'].items() if key not in ('name','description')},ensure_ascii=False),
            json.dumps({key:value for key,value in product['en'].items() if key not in ('name','description')},ensure_ascii=False),
            int(product['active']),now,now,position,0,'')


def seed(db):
    """Called inside the same serialized transaction as schema migration, exactly once."""
    data=json.loads(settings.CATALOG_PATH.read_text(encoding='utf-8'))
    if data.get('currency')!='EGP' or not isinstance(data.get('products'),list):raise ValueError('Invalid initial catalog')
    now=data['updatedAt']+'T00:00:00.000Z'
    ids=set()
    for position,item in enumerate(data['products']):
        product=validate(item)
        if product['id'] in ids:raise ValueError('Duplicate initial product')
        ids.add(product['id'])
        db.execute('INSERT OR IGNORE INTO products VALUES ('+','.join('?' for _ in COLUMNS)+')',values(product,now,position))
    db.execute('INSERT OR IGNORE INTO catalog_meta VALUES (1,?)',(data['updatedAt'],))
    db.execute("INSERT INTO app_migrations (name) VALUES ('catalog_seed_v1')")


def serialize(row):
    return {'id':row['id'],'category':row['category'],'price':float(row['price']),'image':row['image'],
            'ar':{**json.loads(row['details_ar']),'name':row['name'],'description':row['description']},
            'en':{**json.loads(row['details_en']),'name':row['name_en'],'description':row['description_en']},
            'active':bool(row['active']),'createdAt':row['created_at'],'updatedAt':row['updated_at'],'version':row['version']}


def read(db, include_inactive=False):
    rows=db.execute("SELECT * FROM products WHERE deleted_at=''"+('' if include_inactive else ' AND active=1')+' ORDER BY position,id').fetchall()
    latest=db.execute('SELECT MAX(updated_at) FROM products').fetchone()[0]
    return {'currency':'EGP','updatedAt':latest or db.execute('SELECT imported_at FROM catalog_meta WHERE id=1').fetchone()[0],
            'products':[serialize(row) for row in rows]}


def listing(request):
    from .views import _json_response as reply
    if request.method!='GET':return mutations(request)
    all_products=request.GET.get('includeInactive')=='1'
    if all_products and not authorized(request):return reply({'error':'Admin authorization required'},401)
    try:
        with closing(storage.connect()) as db:data=read(db,all_products)
        etag='"'+hashlib.sha256(json.dumps(data,sort_keys=True,ensure_ascii=False).encode()).hexdigest()+'"'
        response=reply(data)
        response['ETag']=etag
        response['Cache-Control']='private, no-cache, must-revalidate'
        if request.headers.get('If-None-Match')==etag:
            response.status_code=304;response.content=b''
        return response
    except (OSError,ValueError,sqlite3.Error):return reply({'error':'Catalog unavailable'},503)


@csrf_exempt
def detail(request, product_id):
    from .views import _json_response as reply
    if request.method!='GET':return mutations(request,product_id)
    try:
        with closing(storage.connect()) as db:
            row=db.execute("SELECT * FROM products WHERE id=? AND deleted_at=''",(product_id,)).fetchone()
            if not row or not row['active'] and not authorized(request):return reply({'error':'Not found'},404)
            return reply({'product':serialize(row)})
    except (OSError,ValueError,sqlite3.Error):return reply({'error':'Catalog unavailable'},503)


@admin_api
def mutations(request, product_id=None):
    from .views import _json_response as reply
    if request.method not in (('POST',) if product_id is None else ('PUT','PATCH','DELETE')):
        return reply({'error':'Method not allowed'},405)
    if request.headers.get('Origin') and request.headers['Origin']!=f'{request.scheme}://{request.get_host()}':return reply({'error':'Origin not allowed'},403)
    if request.content_type!='application/json':return reply({'error':'JSON required'},415)
    if len(request.body)>24000:return reply({'error':'Body too large'},413)
    try:
        body=json.loads(request.body)
        if not isinstance(body,dict):raise ValueError()
        with closing(storage.connect()) as db:
            db.execute('BEGIN IMMEDIATE')
            old=db.execute('SELECT * FROM products WHERE id=?',(product_id or body.get('id',''),)).fetchone()
            if product_id:
                if not old:return reply({'error':'Not found'},404)
                if type(body.get('version')) is not int or not 0<=body['version']<2147483647:raise ValueError('Version required')
                if old['deleted_at']:
                    return reply({'ok':True}) if request.method=='DELETE' and old['version']==body['version']+1 else reply({'error':'Not found'},404)
                if request.method=='DELETE':
                    if old['version']!=body['version']:return reply({'error':'Product changed; reload before deleting'},409)
                    now=datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
                    db.execute('UPDATE products SET active=0,deleted_at=?,updated_at=?,version=version+1 WHERE id=?',(now,now,product_id));db.commit()
                    return reply({'ok':True})
                if 'id' in body and body['id']!=product_id:raise ValueError('ID cannot change')
                merged={**serialize(old),**body,'id':product_id} if request.method=='PATCH' else {**body,'id':product_id}
                if request.method=='PATCH':
                    for lang in ('ar','en'):
                        if lang in body:
                            if not isinstance(body[lang],dict):raise ValueError()
                            merged[lang]={**serialize(old)[lang],**body[lang]}
                product=validate(merged)
                current=validate(serialize(old))
                if old['version']!=body['version']:
                    if old['version']==body['version']+1 and product==current:return reply({'product':serialize(old)})
                    return reply({'error':'Product changed; reload before saving'},409)
                now=datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
                new=values(product,now,old['position'])
                fields=COLUMNS[1:11]+('updated_at','version')
                db.execute('UPDATE products SET '+','.join(key+'=?' for key in fields)+' WHERE id=?',(*new[1:11],now,old['version']+1,product_id))
                code=200
            else:
                product=validate(body)
                if old:
                    if not old['deleted_at'] and validate(serialize(old))==product:return reply({'product':serialize(old)},200)
                    return reply({'error':'Product ID already used'},409)
                now=datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
                position=db.execute('SELECT COALESCE(MAX(position),-1)+1 FROM products').fetchone()[0]
                db.execute('INSERT INTO products VALUES ('+','.join('?' for _ in COLUMNS)+')',values(product,now,position));product_id=product['id'];code=201
            saved=serialize(db.execute('SELECT * FROM products WHERE id=?',(product_id,)).fetchone());db.commit()
        return reply({'product':saved},code)
    except (ValueError,TypeError,UnicodeDecodeError):return reply({'error':'Invalid product or price'},400)


def validate_items(body):
    items=body.get('items',[])
    if not isinstance(items,list) or len(items)>50:raise ValueError('Invalid order items')
    result=[];ids=set()
    for item in items:
        if not isinstance(item,dict) or set(item)!= {'productId','quantity'} or not isinstance(item['productId'],str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,119}',item['productId']) or type(item['quantity']) is not int or not 1<=item['quantity']<=9999 or item['productId'] in ids:raise ValueError('Invalid order item')
        ids.add(item['productId']);result.append(item)
    if any(key in body for key in ('price','total','unitPrice','status','notes')):raise ValueError('Untrusted order fields')
    return sorted(result,key=lambda item:item['productId'])


def order_items(db, quote_id):
    return [{'productId':row['product_id'],'quantity':row['quantity'],'unitPrice':float(row['unit_price']),
             'name':row['product_name'],'nameEn':row['product_name_en'],'productVersion':row['product_version'],
             'total':float(Decimal(str(row['unit_price']))*row['quantity'])}
            for row in db.execute('SELECT * FROM quote_items WHERE quote_id=? ORDER BY product_id',(quote_id,))]


def attach_items(db, quotes):
    grouped={quote['id']:[] for quote in quotes}
    for row in db.execute('SELECT * FROM quote_items WHERE quote_id IN (SELECT value FROM json_each(?)) ORDER BY product_id',(json.dumps(list(grouped)),)):
        grouped[row['quote_id']].append({'productId':row['product_id'],'quantity':row['quantity'],'unitPrice':float(row['unit_price']),
                                       'name':row['product_name'],'nameEn':row['product_name_en'],'productVersion':row['product_version'],
                                       'total':float(Decimal(str(row['unit_price']))*row['quantity'])})
    return [{**quote,'items':grouped[quote['id']]} for quote in quotes]


def price_summary(db, quote_id):
    return '\n'.join(f"{item['name']} — {item['quantity']} × {item['unitPrice']:.2f} ج.م = {item['total']:.2f} ج.م" for item in order_items(db,quote_id))
