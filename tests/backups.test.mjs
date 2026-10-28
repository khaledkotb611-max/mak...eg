import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../dist/server/index.js';
import {D1} from './d1-helper.mjs';
const origin='https://mak.example';
const catalogSeed=JSON.parse(readFileSync('data/catalog.json','utf8'));
const owner={'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.com'};
class R2 {
    objects=new Map();fail=false;
    async put(key,data,options={}){if(this.fail)throw new Error('storage unavailable');this.objects.set(key,{data,...options,uploaded:new Date(),size:new TextEncoder().encode(data).length});}
    async get(key){const object=this.objects.get(key);return object?{...object,text:async()=>object.data}:null;}
    async list({prefix='',limit=1000,cursor}={}){const keys=[...this.objects.keys()].filter(key=>key.startsWith(prefix) && (!cursor || key>cursor)).sort();const selected=keys.slice(0,limit);return {objects:selected.map(key=>({key,...this.objects.get(key)})),truncated:keys.length>limit,cursor:selected.at(-1)};}
    async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])this.objects.delete(key);}
}
const env=()=>({DB:new D1(),BACKUPS:new R2(),ADMIN_EMAILS:'owner@example.com'});
const call=(path,environment,{method='GET',headers=owner,body}={})=>worker.fetch(new Request(origin+path,{method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),environment);
const quote=()=>({requestId:crypto.randomUUID(),name:'خالد',email:'customer@example.com',phone:'01000000000',projectType:'Home',message:'ماسورة ٢٥ مم'});
const save=async environment=>{const response=await call('/api/quotes',environment,{method:'POST',headers:{},body:quote()});assert.equal(response.status,201);return (await response.json()).quoteId;};

test('interrupted history restoration can resume without replacing current followup',async()=>{
    const environment=env();const id=await save(environment);
    await call('/api/quotes/'+id,environment,{method:'PATCH',body:{status:'contacted',notes:'Original followup',version:0}});
    const backup=(await (await call('/api/admin/backups',environment,{method:'POST'})).json()).backup.id;
    environment.DB.sqlite.exec('DELETE FROM quote_events; DELETE FROM quote_admin; DELETE FROM quote_notifications; DELETE FROM quotes');
    environment.DB.sqlite.exec("CREATE TRIGGER reject_history BEFORE INSERT ON quote_events BEGIN SELECT RAISE(ABORT,'test failure'); END");
    const restore={method:'POST',body:{mode:'restore',confirm:backup}};
    assert.equal((await call('/api/admin/backups/'+backup+'/restore',environment,restore)).status,503);
    environment.DB.sqlite.exec('DROP TRIGGER reject_history');
    await call('/api/quotes/'+id,environment,{method:'PATCH',body:{status:'fulfilled',notes:'Latest followup',version:1}});
    assert.equal((await call('/api/admin/backups/'+backup+'/restore',environment,restore)).status,200);
    const history=await (await call('/api/quotes/'+id+'/history',environment)).json();assert.equal(history.events.length,2);
    assert.equal(environment.DB.sqlite.prepare('SELECT notes FROM quote_admin WHERE quote_id=?').get(id).notes,'Latest followup');
    assert.equal(environment.DB.sqlite.prepare('SELECT state FROM quote_notifications WHERE quote_id=?').get(id).state,'needs_review');
});

test('backup versions are private, preserve Arabic, include notes and are separate from live D1',async()=>{
    const environment=env();const id=await save(environment);
    const updated=await call('/api/quotes/'+id,environment,{method:'PATCH',body:{status:'contacted',notes:'اتصل بالعميل',version:0}});assert.equal(updated.status,200);
    const listed=await (await call('/api/admin/backups',environment)).json();assert.equal(listed.state.revision,listed.state.saved_revision);assert.equal(listed.backups.length,2);
    const backup=listed.state.last_id;
    assert.equal((await call('/api/admin/backups/'+backup,environment,{headers:{}})).status,401);
    assert.equal((await call('/orders/v1/'+backup+'.json',environment,{headers:{}})).status,404);
    const response=await call('/api/admin/backups/'+backup,environment);assert.equal(response.headers.get('Cache-Control'),'no-store');
    const envelope=await response.json(),snapshot=JSON.parse(envelope.data);
    assert.equal(snapshot.tables.quotes[0].name,'خالد');assert.equal(snapshot.tables.quote_admin[0].notes,'اتصل بالعميل');assert.equal(snapshot.catalog.products.length,catalogSeed.products.length);
    assert.ok(!envelope.data.includes('ADMIN_EMAILS'));assert.ok(!envelope.data.includes('RESEND_API_KEY'));
    const failedDatabase={...environment,DB:undefined};
    assert.equal((await call('/api/admin/backups/'+backup,failedDatabase)).status,200);
    assert.equal((await (await call('/api/admin/backups',failedDatabase)).json()).state,null);
});

test('R2 failure leaves orders saved and dirty, then safely retries after recovery',async()=>{
    const environment=env();environment.BACKUPS.fail=true;const id=await save(environment);
    const state=environment.DB.sqlite.prepare('SELECT * FROM backup_state').get();assert.equal(state.saved_revision,0);assert.equal(state.last_error,'backup_failed');
    assert.equal(environment.DB.sqlite.prepare('SELECT id FROM quotes').get().id,id);
    environment.BACKUPS.fail=false;assert.equal((await call('/api/admin/backups',environment,{method:'POST'})).status,201);
    const recovered=environment.DB.sqlite.prepare('SELECT * FROM backup_state').get();assert.equal(recovered.saved_revision,recovered.revision);assert.equal(recovered.last_error,'');
});

test('restoration previews changes, preserves current notes and never emails historical orders',async()=>{
    const environment=env();const first=await save(environment),second=await save(environment);
    const snapshot=environment.DB.sqlite.prepare('SELECT last_id FROM backup_state').get().last_id;
    await call('/api/quotes/'+first,environment,{method:'PATCH',body:{status:'fulfilled',notes:'تم التنفيذ حديثًا',version:0}});
    environment.DB.sqlite.prepare('DELETE FROM quote_notifications WHERE quote_id=?').run(second);environment.DB.sqlite.prepare('DELETE FROM quotes WHERE id=?').run(second);
    const path='/api/admin/backups/'+snapshot+'/restore';
    assert.deepEqual(await (await call(path,environment,{method:'POST',body:{mode:'preview'}})).json(),{missing:1,preserved:1});
    assert.equal((await call(path,environment,{method:'POST',body:{mode:'restore'}})).status,400);
    assert.equal((await call(path,environment,{method:'POST',headers:{...owner,Origin:'https://evil.example'},body:{mode:'restore',confirm:snapshot}})).status,403);
    const result=await (await call(path,environment,{method:'POST',body:{mode:'restore',confirm:snapshot}})).json();assert.equal(result.restored,1);
    assert.equal(environment.DB.sqlite.prepare('SELECT notes FROM quote_admin WHERE quote_id=?').get(first).notes,'تم التنفيذ حديثًا');
    assert.equal(environment.DB.sqlite.prepare('SELECT state FROM quote_notifications WHERE quote_id=?').get(second).state,'needs_review');
    assert.equal((await (await call(path,environment,{method:'POST',body:{mode:'restore',confirm:snapshot}})).json()).restored,0);
    const key='orders/v1/'+snapshot+'.json';environment.BACKUPS.objects.get(key).data=JSON.stringify({format:'mak-backup-envelope',sha256:'invalid',data:'{}'});
    assert.equal((await call(path,environment,{method:'POST',body:{mode:'restore',confirm:snapshot}})).status,422);
});

test('retention keeps 30 complete versions and test email uses only the configured recipient',async()=>{
    const environment=env();await save(environment);
    for(let index=0;index<32;index++)await call('/api/admin/backups',environment,{method:'POST'});
    assert.equal(environment.BACKUPS.objects.size,30);
    assert.equal((await call('/api/admin/notifications/test',environment,{method:'POST',body:{}})).status,503);
    Object.assign(environment,{RESEND_API_KEY:'test-key',NOTIFICATION_FROM:'orders@example.com',NOTIFICATION_TO:'khaledkotb611@icloud.com'});
    const original=globalThis.fetch;const sent=[];globalThis.fetch=async(url,options)=>{sent.push(options);return new Response(JSON.stringify({id:'provider-test-id'}));};
    try {
        const requestId=crypto.randomUUID();const response=await call('/api/admin/notifications/test',environment,{method:'POST',body:{requestId}});
        assert.equal(response.status,200);assert.equal((await response.json()).state,'submitted');assert.equal(sent.length,1);
        assert.deepEqual(JSON.parse(sent[0].body).to,['khaledkotb611@icloud.com']);assert.equal(sent[0].headers['Idempotency-Key'],'mak-test-'+requestId);
        assert.equal((await call('/api/admin/notifications/test',environment,{method:'POST',headers:{},body:{requestId}})).status,401);
        assert.equal(sent.length,1);
    } finally {globalThis.fetch=original;}
});
