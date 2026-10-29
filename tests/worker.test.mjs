import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../dist/server/index.js';

import { D1 } from './d1-helper.mjs';
const base = 'https://mak.example';
const payload = () => ({ requestId: crypto.randomUUID(), name: 'عميل', email: '', phone: '01000000000', projectType: 'طلب منزل', message: 'ماسورة 25 مم' });
const get = (path, env, headers = {}) => worker.fetch(new Request(base+path, { headers }), env);
const post = (body, env, headers = {}) => worker.fetch(new Request(base+'/api/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1', ...headers }, body: JSON.stringify(body) }), env);

test('only public assets served, catalog identical to source', async () => {
    const env = {DB:new D1()};
    for (const path of ['/data/quotes.jsonl','/data/quotes.sqlite3','/mak_backend/settings.py','/.env','/.openai/hosting.json','/data/catalog.json','/missing','/api/missing','/product/missing']) assert.equal((await get(path,env)).status,404,path);
    for (const path of ['/','/products','/style.css','/script.js','/images/hero.jpg','/pricing.html','/vendor/exceljs-4.4.0.min.js']) assert.equal((await get(path,env)).status,200,path);
    const catalog = JSON.parse(readFileSync('data/catalog.json'));
    assert.deepEqual((await (await get('/api/catalog',env)).json()).products.map(({active,version,createdAt,updatedAt,...p})=>p),catalog.products);
    assert.deepEqual((await (await get('/api/products',env)).json()).products.map(({active,version,createdAt,updatedAt,...p})=>p),catalog.products);
    assert.equal((await get('/product/'+catalog.products[0].id,env)).status,200);
    const head=await worker.fetch(new Request(base+'/script.js',{method:'HEAD'}),env);
    assert.equal(head.status,200); assert.equal(await head.text(),'');
});

test('SQLite-backed D1 save, restart, admin protection and idempotency', async () => {
    const env = { DB: new D1(), ADMIN_TOKEN: 'test-admin' };
    assert.equal((await get('/api/health',env)).status,200);
    const body = payload();
    const saved = await post(body, env);
    assert.equal(saved.status,201);
    const receipt = await saved.json();
    assert.equal(receipt.ok,true);
    for (let i=0;i<7;i++) {
        const retry = await post(body, env); assert.equal(retry.status,200); assert.deepEqual(await retry.json(),receipt);
    }
    assert.equal((await post({...body,message:'changed'},env)).status,409);
    const restarted = { ...env, DB: new D1(env.DB.sqlite) };
    assert.equal((await get('/api/quotes',restarted)).status,401);
    assert.equal((await get('/api/quotes',restarted,{Authorization:'Bearer wrong'})).status,401);
    const response = await get('/api/quotes',restarted,{Authorization:'Bearer test-admin'});
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    const rows = (await response.json()).quotes;
    assert.equal(rows.length,1); assert.equal(rows[0].id,receipt.quoteId); assert.equal(rows[0].message,body.message);
});

test('durable rate limits, validation, cross-origin and request size protections', async () => {
    const env = { DB: new D1() };
    for (const change of [{name:''},{phone:'',email:''},{email:'invalid'},{phone:'bad'},{message:'x'.repeat(2001)},{name:[]},{requestId:'bad'}]) assert.equal((await post({...payload(),...change},env)).status,400);
    for (const body of [null,[],42,'text']) assert.equal((await post(body,env)).status,400);
    assert.equal((await post(payload(),env,{Origin:'https://evil.example'})).status,403);
    assert.equal((await post(payload(),env,{'Content-Type':'text/plain'})).status,415);
    assert.equal((await post({message:'x'.repeat(17000)},env)).status,413);
    for(let i=0;i<5;i++) assert.equal((await post(payload(),env,{Origin:base})).status,201);
    const limited=await post(payload(),{DB:new D1(env.DB.sqlite)});
    assert.equal(limited.status,429); assert.equal(limited.headers.get('Retry-After'),'600');
    assert.equal((await post({...payload(),phone:'',email:'test@example.com'},env,{'CF-Connecting-IP':'192.0.2.2'})).status,201);
    assert.equal((await worker.fetch(new Request(base+'/api/quotes',{method:'DELETE'}),env)).status,405);
});

test('GitHub Pages can read the public catalog and save orders through a narrow CORS allowlist', async () => {
    const env = { DB: new D1() };
    const siteOrigin = 'https://khaledkotb611-max.github.io';
    const preflight = await worker.fetch(new Request(base+'/api/quotes', { method:'OPTIONS', headers:{
        Origin:siteOrigin, 'Access-Control-Request-Method':'POST', 'Access-Control-Request-Headers':'content-type'
    }}), env);
    assert.equal(preflight.status,204);
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),siteOrigin);
    assert.equal(preflight.headers.get('Access-Control-Allow-Methods'),'POST, OPTIONS');
    const catalog = await get('/api/products',env,{Origin:siteOrigin});
    assert.equal(catalog.status,200);
    assert.equal(catalog.headers.get('Access-Control-Allow-Origin'),siteOrigin);
    assert.equal(catalog.headers.get('Access-Control-Expose-Headers'),'ETag');
    const saved = await post(payload(),env,{Origin:siteOrigin});
    assert.equal(saved.status,201);
    assert.equal(saved.headers.get('Access-Control-Allow-Origin'),siteOrigin);
    assert.equal((await get('/api/quotes',env,{Origin:siteOrigin})).status,403);
    const denied = await worker.fetch(new Request(base+'/api/quotes', { method:'OPTIONS', headers:{
        Origin:'https://evil.example', 'Access-Control-Request-Method':'POST', 'Access-Control-Request-Headers':'content-type'
    }}), env);
    assert.equal(denied.status,403);
});

test('storage failure never returns success or exposes requests', async () => {
    assert.equal((await get('/api/health',{})).status,503);
    assert.equal((await post(payload(),{})).status,503);
    assert.equal((await get('/api/quotes',{})).status,401);
    assert.equal((await get('/api/quotes',{ADMIN_TOKEN:'test'},{Authorization:'Bearer test'})).status,503);
});

test('catalog IDs are unique, stable URLs and complete prices have no embedded frontend copies', () => {
    const catalog=JSON.parse(readFileSync('data/catalog.json'));
    assert.equal(new Set(catalog.products.map(p=>p.id)).size,catalog.products.length);
    for(const p of catalog.products) { assert.ok(Number.isFinite(p.price)); assert.ok(p.ar.name && p.en.name); }
    const source=readFileSync('script.js','utf8');
    assert.ok(!source.includes('const pipeSeries')); assert.ok(!source.includes('const pvcFittings'));
    for(const name of ['index.html','products.html']) assert.ok(!readFileSync(name,'utf8').includes('<strong>537'));
});
