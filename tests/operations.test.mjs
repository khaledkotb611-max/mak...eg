import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import {D1} from './d1-helper.mjs';

const owner={'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.com'};
const environment=()=>({DB:new D1(),ADMIN_EMAILS:'owner@example.com',RESEND_API_KEY:'fake-key',NOTIFICATION_FROM:'orders@example.com',NOTIFICATION_TO:'owner@example.com'});
const call=(path,env,{method='GET',headers=owner,body,ctx}={})=>worker.fetch(new Request('https://mak.example'+path,{method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);
const save=async env=>{const response=await call('/api/quotes',env,{method:'POST',headers:{},body:{requestId:crypto.randomUUID(),name:'عميل',phone:'01000000000',projectType:'Home',message:'طلب'},ctx:{waitUntil(){}}});assert.equal(response.status,201);return (await response.json()).quoteId;};
const notice=(env,id)=>env.DB.sqlite.prepare('SELECT * FROM quote_notifications WHERE quote_id=?').get(id);

test('history pagination is private, durable and excludes unsuccessful updates',async()=>{
    const env=environment();env.RESEND_API_KEY='';const id=await save(env);const path='/api/quotes/'+id;
    for(let version=0;version<32;version++)assert.equal((await call(path,env,{method:'PATCH',body:{status:version%2?'fulfilled':'contacted',notes:'Internal note',version}})).status,200);
    assert.equal((await call(path,env,{method:'PATCH',body:{status:'new',notes:'Stale',version:31}})).status,409);
    const page=await (await call(path+'/history',env)).json();assert.equal(page.events.length,30);assert.equal(page.events[0].version,32);assert.equal(page.events[0].actor,'owner@example.com');assert.ok(!JSON.stringify(page).includes('Internal note'));
    const older=await (await call(path+'/history?before='+page.nextBefore,env)).json();assert.equal(older.events.length,2);assert.equal(older.nextBefore,null);
    assert.equal((await call(path+'/history',env,{headers:{}})).status,401);
    assert.equal((await call(path+'/history?before=bad',env)).status,400);
    env.DB.sqlite.exec("CREATE TRIGGER reject_event BEFORE INSERT ON quote_events BEGIN SELECT RAISE(ABORT,'test failure'); END");
    assert.equal((await call(path,env,{method:'PATCH',body:{status:'new',notes:'Other',version:32}})).status,503);
    assert.equal(env.DB.sqlite.prepare('SELECT version FROM quote_admin WHERE quote_id=?').get(id).version,32);
});

test('operational health exposes only authorized counts and accurately identifies traffic-driven delivery',async()=>{
    const env=environment();env.RESEND_API_KEY='';await save(env);
    assert.equal((await call('/api/admin/health',env,{headers:{}})).status,401);
    const data=await (await call('/api/admin/health',env)).json();assert.equal(data.worker.mode,'traffic');assert.equal(data.notifications.configured,false);
    assert.ok(!JSON.stringify(data).includes('owner@example.com'));assert.ok(!JSON.stringify(data).includes('fake-key'));
    assert.equal((await call('/api/admin/health',{...env,DB:{prepare(){throw new Error('failure');}}})).status,503);
});

test('mail retry classification pauses permanent errors and respects provider delays even on manual retry',async()=>{
    const original=globalThis.fetch;
    try{
        for(const [status,name,state] of [[403,'validation_error','action_required'],[409,'invalid_idempotent_request','needs_review'],[409,'concurrent_idempotent_requests','failed'],[429,'rate_limit_exceeded','failed'],[429,'monthly_quota_exceeded','action_required'],[503,'service_unavailable','failed']]){
            const env=environment();let calls=0;
            globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({name}),{status,headers:{'Retry-After':'900'}});};
            const id=await (async()=>{const result=await call('/api/quotes',env,{method:'POST',headers:{},body:{requestId:crypto.randomUUID(),name:'Customer',phone:'01000000000',projectType:'Home',message:'Order'}});assert.equal(result.status,201);return (await result.json()).quoteId;})();
            const row=notice(env,id);assert.equal(row.state,state,status+' '+name);
            await call('/api/admin/notifications/retry',env,{method:'POST'});
            if(status===409 || status===429){assert.equal(notice(env,id).next_attempt,row.next_attempt);assert.equal(calls,1);}
            if(state==='needs_review')assert.equal(notice(env,id).state,'needs_review');
        }
    }finally{globalThis.fetch=original;}
});

test('a delayed delivery completion cannot overwrite a newer worker result',async()=>{
    const original=globalThis.fetch;const env=environment();
    try{
        globalThis.fetch=async()=>{
            env.DB.sqlite.prepare("UPDATE quote_notifications SET state='submitted',provider_id='newer',locked_until=0").run();
            return new Response('{"id":"late"}',{status:200});
        };
        const response=await call('/api/quotes',env,{method:'POST',headers:{},body:{requestId:crypto.randomUUID(),name:'Customer',phone:'01000000000',projectType:'Home',message:'Order'}});
        const id=(await response.json()).quoteId;assert.equal(notice(env,id).provider_id,'newer');assert.equal(notice(env,id).state,'submitted');
    }finally{globalThis.fetch=original;}
});
