import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import {D1} from './d1-helper.mjs';
const origin='https://mak.example';
const owner={'oai-authenticated-user-id':'trusted-site-user','oai-authenticated-user-email':'owner@example.com'};
const environment=()=>({DB:new D1(),ADMIN_EMAILS:'owner@example.com',ADMIN_TOKEN:'test-token',NOTIFICATION_TO:'owner@example.com'});
const body=()=>({requestId:crypto.randomUUID(),name:'عميل',email:'customer@example.com',phone:'01000000000',projectType:'Home',message:'ماسورة 25 مم'});
const request=(path,env,{method='GET',headers={},data,ctx}={})=>worker.fetch(new Request(origin+path,{method,headers:{...headers,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}),env,ctx);
const save=async(env,data=body(),ctx)=>{const response=await request('/api/quotes',env,{method:'POST',data,ctx});assert.equal(response.status,201);return (await response.json()).quoteId;};

test('date filtering uses inclusive UTC start and exclusive end across timestamp formats',async()=>{
    const env=environment();await request('/api/health',env);
    const dates=['2026-10-01T20:59:59.999Z','2026-10-01T21:00:00.000Z','2026-10-02T23:59:59+03:00','2026-10-02T21:00:00.000Z'];
    for(const date of dates)env.DB.sqlite.prepare('INSERT INTO quotes VALUES (?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),crypto.randomUUID(),'inside','customer@example.com','','Home','Order',date);
    const params=new URLSearchParams({limit:'1',status:'new',q:'inside',createdFrom:'2026-10-01T21:00:00.000Z',createdBefore:'2026-10-02T21:00:00.000Z'});
    const data=await (await request('/api/quotes?'+params,env,{headers:owner})).json();
    assert.equal(data.total,2);assert.equal(data.quotes.length,1);assert.equal(data.summary.total,4);
    params.set('offset','1');assert.equal((await (await request('/api/quotes?'+params,env,{headers:owner})).json()).quotes.length,1);
    for(const value of ['2026-02-30T00:00:00.000Z','invalid','2026-10-03T00:00:00.000Z']){
        params.set('createdFrom',value);assert.equal((await request('/api/quotes?'+params,env,{headers:owner})).status,400);
    }
});

test('only authorized site owner or admin token can access customer data and update statuses',async()=>{
    const env=environment();const id=await save(env);
    for(const headers of [{},{'oai-authenticated-user-id':'outsider','oai-authenticated-user-email':'other@example.com'},{'oai-authenticated-user-email':'owner@example.com'}]) {
        assert.equal((await request('/api/quotes?limit=30',env,{headers})).status,401);
        assert.equal((await request('/api/quotes/'+id,env,{method:'PATCH',data:{status:'contacted',notes:'',version:0},headers})).status,401);
    }
    assert.equal((await request('/admin',env)).status,302);
    assert.equal((await request('/admin.html',env)).status,302);
    const denied=await request('/admin',env,{headers:{...owner,'oai-authenticated-user-email':'other@example.com'}});assert.equal(denied.status,403);
    const page=await request('/admin',env,{headers:owner});assert.equal(page.status,200);assert.equal(page.headers.get('Cache-Control'),'no-store');
    assert.equal((await request('/api/admin/session',env,{headers:owner})).status,200);
    assert.equal((await request('/api/admin/session',env,{headers:{Authorization:'Bearer test-token'}})).status,200);
});

test('pagination, search, summary, status changes, notes and stale writes are durable',async()=>{
    const env=environment();const id=await save(env);
    const list=await (await request('/api/quotes?limit=1',env,{headers:owner})).json();
    assert.equal(list.total,1);assert.equal(list.summary.new,1);assert.equal(list.quotes[0].status,'new');assert.equal(list.quotes[0].notification.state,'blocked');
    const change={status:'contacted',notes:'اتصلنا بالعميل',version:0};
    assert.equal((await request('/api/quotes/'+id,env,{method:'PATCH',headers:{...owner,Origin:'https://evil.example'},data:change})).status,403);
    const updated=await request('/api/quotes/'+id,env,{method:'PATCH',headers:owner,data:change});assert.equal(updated.status,200);assert.equal((await updated.json()).quote.version,1);
    assert.equal((await request('/api/quotes/'+id,env,{method:'PATCH',headers:owner,data:change})).status,409);
    assert.equal((await request('/api/quotes/'+id,env,{method:'PATCH',headers:owner,data:{...change,status:'made-up',version:1}})).status,400);
    const restart={...env,DB:new D1(env.DB.sqlite)};
    const filtered=await (await request('/api/quotes?limit=30&status=contacted&q=01000000000',restart,{headers:owner})).json();
    assert.equal(filtered.total,1);assert.equal(filtered.quotes[0].notes,change.notes);assert.equal(filtered.summary.contacted,1);assert.equal(filtered.summary.new,0);
    assert.equal((await (await request('/api/quotes?limit=30&status=new',env,{headers:owner})).json()).total,0);
    assert.equal((await (await request('/api/quotes?limit=1&offset=1',env,{headers:owner})).json()).quotes.length,0);
    assert.equal((await request('/api/quotes?limit=30&status=invalid',env,{headers:owner})).status,400);
    const pending=await save(env,body());
    assert.equal((await request('/api/quotes/'+pending,env,{method:'PATCH',headers:owner,data:{status:'fulfilled',notes:'',version:5}})).status,409);
});

test('email is queued atomically, submitted once, and retries do not notify again',async()=>{
    const env={...environment(),RESEND_API_KEY:'test-api-key',NOTIFICATION_FROM:'MAK <orders@example.com>',SITE_ORIGIN:origin};
    const originalFetch=globalThis.fetch;const sent=[];const tasks=[];
    globalThis.fetch=async(url,options)=>{sent.push({url,options});return new Response(JSON.stringify({id:'provider-id'}),{status:200});};
    try {
        const data=body();const id=await save(env,data,{waitUntil(promise){tasks.push(promise);}});
        await Promise.all(tasks);
        assert.equal(sent.length,1);assert.equal(sent[0].options.headers['Idempotency-Key'],'mak-quote-'+id);
        const payload=JSON.parse(sent[0].options.body);assert.deepEqual(payload.to,[env.NOTIFICATION_TO]);assert.ok(payload.text.includes(id));assert.ok(payload.text.includes('/admin'));assert.equal(payload.reply_to,data.email);
        assert.equal(env.DB.sqlite.prepare('SELECT state FROM quote_notifications WHERE quote_id=?').get(id).state,'submitted');
        const retry=await request('/api/quotes',env,{method:'POST',data});assert.equal(retry.status,200);assert.equal(sent.length,1);
        assert.equal((await request('/api/admin/notifications/retry',env,{method:'POST',headers:owner,data:{}})).status,200);assert.equal(sent.length,1);
    } finally {globalThis.fetch=originalFetch;}
});

test('email failure never loses an order and admin can retry with stable payload and idempotency key',async()=>{
    const env={...environment(),RESEND_API_KEY:'test-api-key',NOTIFICATION_FROM:'orders@example.com',SITE_ORIGIN:origin};
    const originalFetch=globalThis.fetch;const sent=[];let success=false;
    globalThis.fetch=async(url,options)=>{sent.push(options);return new Response(JSON.stringify(success?{id:'eventual-id'}:{message:'Temporary failure'}),{status:success?200:503});};
    try {
        const id=await save(env);const failed=env.DB.sqlite.prepare('SELECT * FROM quote_notifications WHERE quote_id=?').get(id);assert.equal(failed.state,'failed');assert.equal(failed.error_code,'provider_503');
        assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM quotes').get().n,1);
        assert.equal((await request('/api/admin/notifications/retry',env,{method:'POST',data:{}})).status,401);
        success=true;
        assert.equal((await request('/api/admin/notifications/retry',env,{method:'POST',headers:owner,data:{}})).status,200);
        assert.equal(sent.length,2);assert.equal(sent[0].body,sent[1].body);assert.deepEqual(sent[0].headers,sent[1].headers);
        assert.equal(env.DB.sqlite.prepare('SELECT state FROM quote_notifications WHERE quote_id=?').get(id).state,'submitted');
    } finally {globalThis.fetch=originalFetch;}
});

test('existing pre-dashboard requests stay intact after management migration',async()=>{
    const env=environment();
    env.DB.sqlite.exec('CREATE TABLE quotes (id TEXT PRIMARY KEY,request_id TEXT UNIQUE,name TEXT,email TEXT,phone TEXT,project_type TEXT,message TEXT,created_at TEXT)');
    const id=crypto.randomUUID();env.DB.sqlite.prepare('INSERT INTO quotes VALUES (?,?,?,?,?,?,?,?)').run(id,crypto.randomUUID(),'Old customer','old@example.com','','Home','Old request','2026-09-01T00:00:00Z');
    const data=await (await request('/api/quotes?limit=30',env,{headers:owner})).json();assert.equal(data.total,1);assert.equal(data.quotes[0].id,id);assert.equal(data.quotes[0].status,'new');assert.equal(data.quotes[0].notification.state,'not_requested');
});


test('ambiguous retries outside provider idempotency window require review instead of resending',async()=>{
    const env={...environment(),RESEND_API_KEY:'test-key',NOTIFICATION_FROM:'orders@example.com'};
    const originalFetch=globalThis.fetch;let calls=0;
    globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({error:'temporary'}),{status:503});};
    try{
        const id=await save(env);
        env.DB.sqlite.prepare("UPDATE quote_notifications SET first_attempt=?,next_attempt=0 WHERE quote_id=?").run(Math.floor(Date.now()/1000)-24*3600,id);
        await request('/api/admin/notifications/retry',env,{method:'POST',headers:owner,data:{}});
        assert.equal(calls,1);
        assert.equal(env.DB.sqlite.prepare('SELECT state FROM quote_notifications WHERE quote_id=?').get(id).state,'needs_review');
    }finally{globalThis.fetch=originalFetch;}
});
