import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../dist/server/index.js';
import {D1} from './d1-helper.mjs';

const seed=JSON.parse(readFileSync('data/catalog.json','utf8'));
const product=()=>({...structuredClone(seed.products[0]),id:'new-product',price:12.35,active:true});
const env=()=>({DB:new D1(),ADMIN_TOKEN:'owner'});
const call=(db,path,method='GET',body,admin=false,headers={})=>worker.fetch(new Request('https://mak.example'+path,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(admin?{Authorization:'Bearer owner'}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),db);
const quote=items=>({requestId:crypto.randomUUID(),name:'Client',phone:'01000000000',projectType:'Home',message:'User-controlled text including a fake price',items});

test('one-time import preserves every existing product and never reseeds deleted or externally modified data',async()=>{
    const db=env();const initial=await (await call(db,'/api/catalog')).json();
    assert.deepEqual(initial.products.map(({active,version,createdAt,updatedAt,...p})=>p),seed.products);
    db.DB.sqlite.prepare('UPDATE products SET price=? WHERE id=?').run(1.25,seed.products[0].id);
    const changed=await (await call(db,'/api/catalog')).json();
    assert.equal(changed.products[0].price,1.25);assert.equal(changed.products[0].version,1);
    db.DB.sqlite.exec('DELETE FROM products');
    assert.deepEqual((await (await call(db,'/api/catalog')).json()).products,[]);
    assert.equal((await call({...db,DB:new D1(db.DB.sqlite)},'/api/products')).status,200);
    assert.equal(db.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM products').get().n,0);
});

test('catalog CRUD, partial edits, inactive visibility, stale writes, PUT, deletion and restart persist to D1',async()=>{
    const db=env();let response=await call(db,'/api/products','POST',product(),true);assert.equal(response.status,201);
    let saved=(await response.json()).product;assert.equal(saved.price,12.35);assert.ok(saved.createdAt);
    assert.equal((await call(db,'/api/products','POST',product(),true)).status,200);
    response=await call(db,'/api/products/new-product','PATCH',{version:0,price:33.45,ar:{name:'اسم محدث'}},true);assert.equal(response.status,200);
    saved=(await response.json()).product;assert.equal(saved.price,33.45);assert.equal(saved.ar.size,product().ar.size);assert.equal(saved.version,1);
    assert.equal((await call(db,'/api/products/new-product','PATCH',{version:0,price:1},true)).status,409);
    assert.equal((await call(db,'/api/products/new-product','PATCH',{version:1,active:false},true)).status,200);
    assert.equal((await call(db,'/api/products/new-product')).status,404);
    assert.ok(!(await (await call(db,'/api/catalog')).json()).products.some(p=>p.id==='new-product'));
    assert.ok((await (await call(db,'/api/products?includeInactive=1','GET',undefined,true)).json()).products.some(p=>p.id==='new-product' && !p.active));
    const replacement={...product(),price:0,active:true,version:2};
    assert.equal((await call(db,'/api/products/new-product','PUT',replacement,true)).status,200);
    response=await call({...db,DB:new D1(db.DB.sqlite)},'/api/products/new-product');assert.equal((await response.json()).product.price,0);
    assert.equal((await call(db,'/api/products/new-product','DELETE',{version:2},true)).status,409);
    assert.equal((await call(db,'/api/products/new-product','DELETE',{version:3},true)).status,200);
    assert.equal((await call(db,'/api/products/new-product','DELETE',{version:3},true)).status,200);
    assert.equal((await call(db,'/api/products/new-product')).status,404);
    assert.equal((await call(db,'/product/new-product')).status,404);
    assert.equal((await call(db,'/api/products','POST',product(),true)).status,409);
});

test('product writes require existing admin authority and reject invalid data and cross-origin requests',async()=>{
    const db=env();await call(db,'/api/catalog');
    for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal((await call(db,'/api/products'+(method==='POST'?'':'/'+seed.products[0].id),method,product())).status,401);
    assert.equal((await call(db,'/api/products?includeInactive=1')).status,401);
    for(const patch of [{price:-1},{price:1.234},{price:'12'},{active:null},{image:'javascript:alert(1)'},{id:'../private'},{ar:{name:''}}])assert.equal((await call(db,'/api/products','POST',{...product(),...patch},true)).status,400);
    assert.equal((await call(db,'/api/products','POST',product(),true,{Origin:'https://evil.example'})).status,403);
    assert.equal((await call({},'/api/catalog')).status,503);
});

test('ETag detects SQL edits, inserts, deletion and availability without trusting timestamp-only changes',async()=>{
    const db=env();let response=await call(db,'/api/catalog');let etag=response.headers.get('ETag');
    assert.equal((await call(db,'/api/catalog','GET',undefined,false,{'If-None-Match':etag})).status,304);
    db.DB.sqlite.prepare('UPDATE products SET name=? WHERE id=?').run('Changed directly',seed.products[0].id);
    response=await call(db,'/api/catalog','GET',undefined,false,{'If-None-Match':etag});assert.equal(response.status,200);etag=response.headers.get('ETag');
    db.DB.sqlite.prepare('DELETE FROM products WHERE id=?').run(seed.products[0].id);
    assert.equal((await call(db,'/api/catalog','GET',undefined,false,{'If-None-Match':etag})).status,200);
});

test('new orders use database prices, retries retain original snapshots, unavailable items never create partial orders',async()=>{
    const db=env();await call(db,'/api/products','POST',product(),true);
    await call(db,'/api/products/new-product','PATCH',{version:0,price:45.67},true);
    const body=quote([{productId:'new-product',quantity:3}]);let response=await call(db,'/api/quotes','POST',body);assert.equal(response.status,201);
    const receipt=await response.json();assert.equal(receipt.items[0].unitPrice,45.67);assert.equal(receipt.items[0].total,137.01);
    assert.equal(db.DB.sqlite.prepare('SELECT unit_price FROM quote_items WHERE quote_id=?').get(receipt.quoteId).unit_price,45.67);
    await call(db,'/api/products/new-product','PATCH',{version:1,price:55.55},true);
    assert.deepEqual(await (await call(db,'/api/quotes','POST',body)).json(),receipt);
    assert.equal((await call(db,'/api/quotes','POST',{...body,items:[{productId:'new-product',quantity:4}]})).status,409);
    for(const items of [[{productId:'new-product',quantity:1,unitPrice:0}],[{productId:'new-product',quantity:0}]])assert.equal((await call(db,'/api/quotes','POST',quote(items))).status,400);
    assert.equal((await call(db,'/api/quotes','POST',{...quote([]),price:0})).status,400);
    await call(db,'/api/products/new-product','PATCH',{version:2,active:false},true);
    const before=db.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM quotes').get().n;
    assert.equal((await call(db,'/api/quotes','POST',quote([{productId:'new-product',quantity:1}]))).status,409);
    assert.equal(db.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM quotes').get().n,before);
    await call(db,'/api/products/new-product','DELETE',{version:3},true);
    const list=await (await call(db,'/api/quotes?limit=30','GET',undefined,true)).json();assert.equal(list.quotes[0].items[0].unitPrice,45.67);
    response=await call(db,'/api/quotes/'+receipt.quoteId,'PATCH',{version:0,status:'contacted',notes:'Preserved'},true);assert.equal(response.status,200);
    assert.equal((await response.json()).quote.items[0].unitPrice,45.67);
    assert.equal((await call(db,'/api/quotes/'+receipt.quoteId+'/history','GET',undefined,true)).status,200);
});
