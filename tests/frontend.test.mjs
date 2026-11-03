import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import worker from '../dist/server/index.js';
import { D1 } from './d1-helper.mjs';

const source=readFileSync('script.js','utf8');
const catalog=JSON.parse(readFileSync('data/catalog.json'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function app(send, { blockedPopup = false, selectedProduct = '', catalogFetcher } = {}) {
    const classes={add(){},remove(){},toggle(){},contains(){return false;}};
    const attributes=new Map();
    const button={disabled:false};
    const status={textContent:''};
    const deliveryActions={hidden:true};
    const code={textContent:''};
    const summary={textContent:''};
    const grid={innerHTML:''};
    const count={textContent:''};
    const events={};
    const fields={name:'Test', email:'', phone:'01000000000', projectType:'Home', message:selectedProduct?'':'Pipe 25 mm', deliveryChannel:'whatsapp'};
    const radios=[{value:'whatsapp',disabled:false},{value:'email',disabled:false}];
    const link={href:'',target:'',textContent:''};
    const opened=[];
    const destinations=[];
    const emailDestinations=[];
    const closed=[];
    const form={checkValidity:()=>true,reportValidity(){},addEventListener(name,handler){events[name]=handler;},querySelectorAll(){return radios;},querySelector(selector){return selector==='[type="submit"]'?button:selector==='[name="deliveryChannel"]:checked'?radios.find(r=>r.value===fields.deliveryChannel):{get value(){return fields.message;},set value(value){fields.message=value;},focus(){}};}};
    const mapping={'.contact-form':form,'.form-status':status,'.order-delivery-actions':deliveryActions,'[data-order-code]':code,'[data-order-summary]':summary};
    let ready;
    const document={documentElement:{classList:classes,setAttribute(k,v){attributes.set(k,v);},getAttribute(k){return attributes.get(k);}},body:{classList:classes},querySelector:(selector)=>mapping[selector]||null,querySelectorAll:(selector)=>selector==='[data-order-send]'?[link]:selector===".contact-form .button[type='submit']"?[button]:[],getElementById:(id)=>id==='catalog-grid'?grid:id==='catalog-count'?count:null,addEventListener(name,handler){if(name==='DOMContentLoaded')ready=handler;}};
    const requests=[];
    const context={document,window:{matchMedia:()=>({matches:false}),location:{pathname:'/',search:selectedProduct?'?product='+selectedProduct:'',assign(href){emailDestinations.push(href);}},open(url,target){
        opened.push({url,target});
        if(blockedPopup)return null;
        const popup={opener:{},closed:false,location:{replace(href){destinations.push(href);}},close(){popup.closed=true;closed.push(popup);}};
        return popup;
    },addEventListener(){},innerHeight:800,scrollY:0},localStorage:{getItem:()=>null,setItem(){}},FormData:class {constructor(){this.values=new Map(Object.entries(fields));}get(k){return this.values.get(k);}[Symbol.iterator](){return this.values[Symbol.iterator]();}},setTimeout:()=>1,clearTimeout(){},AbortController,URLSearchParams,AbortSignal,crypto,Intl,Date,requestAnimationFrame:()=>1,fetch:async(path,options)=>{
        if(path==='/api/products')return catalogFetcher?catalogFetcher(path,options):{ok:true,json:async()=>catalog};
        requests.push(JSON.parse(options.body)); return send(requests.at(-1));
    }};
    vm.runInNewContext(source,context);
    ready();
    return {events,fields,status,code,button,requests,grid,link,opened,destinations,emailDestinations,closed,radios,deliveryActions};
}

test('form confirms only successful persistence, keeps request ID on retry, and uses catalog records',async()=>{
    let failed=true;
    const instance=app(async()=>failed?{ok:false,status:503}:{ok:true,json:async()=>({ok:true,quoteId:'saved-receipt'})});
    await tick();
    assert.ok(instance.grid.innerHTML.includes(catalog.products[0].ar.name));
    await instance.events.submit({preventDefault(){}});
    assert.ok(instance.status.textContent.includes('لم يتم تأكيد'));
    assert.equal(instance.code.textContent,'');
    const requestId=instance.requests[0].requestId;
    failed=false;
    await instance.events.submit({preventDefault(){}});
    assert.equal(instance.requests[1].requestId,requestId);
    assert.equal(instance.code.textContent,'saved-receipt');
    assert.ok(instance.status.textContent.includes('تم حفظ'));
    instance.fields.message='Changed';
    instance.events.input();
    assert.equal(instance.code.textContent,'');
    await instance.events.submit({preventDefault(){}});
    assert.notEqual(instance.requests[2].requestId,requestId);
    assert.equal(instance.button.disabled,false);
});

test('double submission while saving creates one request and edits during save do not get old receipt',async()=>{
    let resolve;
    const instance=app(()=>new Promise(r=>{resolve=r;}));
    const saving=instance.events.submit({preventDefault(){}});
    assert.equal(instance.button.disabled,true);
    await instance.events.submit({preventDefault(){}});
    assert.equal(instance.requests.length,1);
    instance.fields.message='New unsaved edit';
    instance.events.input();
    resolve({ok:true,json:async()=>({ok:true,quoteId:'original-receipt'})});
    await saving;
    assert.equal(instance.code.textContent,'');
    assert.ok(instance.status.textContent.includes('التعديلات الجديدة لم'));
});

test('phone or email is required before contacting server',async()=>{
    const instance=app(()=>{throw new Error('should not send');});
    instance.fields.phone='';
    await instance.events.submit({preventDefault(){}});
    assert.equal(instance.requests.length,0);
    assert.ok(instance.status.textContent.includes('رقم الموبايل'));
});


test('WhatsApp opens one tab and only navigates to the saved selected draft',async()=>{
    let resolve;
    const instance=app(()=>new Promise(r=>{resolve=r;}));
    const saving=instance.events.submit({preventDefault(){}});
    assert.deepEqual(instance.opened,[{url:'about:blank',target:'_blank'}]);
    assert.equal(instance.destinations.length,0);
    assert.ok(instance.radios.every(r=>r.disabled));
    resolve({ok:true,json:async()=>({ok:true,quoteId:'wa-receipt'})});
    await saving;
    assert.equal(instance.destinations.length,1);
    const url=new URL(instance.destinations[0]);
    assert.equal(url.hostname,'wa.me');
    assert.ok(url.searchParams.get('text').includes('wa-receipt'));
    assert.equal(instance.emailDestinations.length,0);
    assert.ok(instance.radios.every(r=>!r.disabled));
    assert.equal(instance.requests[0].deliveryChannel,undefined);
});

test('email uses only the mail app, with saved receipt and correctly encoded text',async()=>{
    const instance=app(async()=>({ok:true,json:async()=>({ok:true,quoteId:'mail-receipt'})}));
    instance.fields.deliveryChannel='email';
    instance.events.change({target:{name:'deliveryChannel'}});
    await instance.events.submit({preventDefault(){}});
    assert.equal(instance.opened.length,0);
    assert.equal(instance.destinations.length,0);
    assert.equal(instance.emailDestinations.length,1);
    const url=new URL(instance.emailDestinations[0]);
    assert.equal(url.protocol,'mailto:');
    assert.ok(url.searchParams.get('body').includes('mail-receipt'));
    assert.ok(url.searchParams.get('body').includes('Pipe 25 mm'));
    assert.equal(instance.link.target,'_self');
});

test('failed save closes reserved tab and does not open WhatsApp or email',async()=>{
    const instance=app(async()=>({ok:false,status:503}));
    await instance.events.submit({preventDefault(){}});
    assert.equal(instance.closed.length,1);
    assert.equal(instance.deliveryActions.hidden,false);
    assert.equal(instance.destinations.length,0);
    assert.equal(instance.emailDestinations.length,0);
    assert.equal(instance.button.disabled,false);
});

test('blocked popup leaves a single manual link with receipt for selected channel',async()=>{
    const instance=app(async()=>({ok:true,json:async()=>({ok:true,quoteId:'blocked-receipt'})}),{blockedPopup:true});
    await instance.events.submit({preventDefault(){}});
    assert.ok(instance.status.textContent.includes('تم حفظ'));
    assert.ok(instance.status.textContent.includes('اضغط زر'));
    assert.equal(instance.deliveryActions.hidden,false);
    assert.ok(new URL(instance.link.href).searchParams.get('text').includes('blocked-receipt'));
    assert.equal(instance.emailDestinations.length,0);
    instance.fields.deliveryChannel='email';
    instance.events.change({target:{name:'deliveryChannel'}});
    assert.equal(instance.code.textContent,'blocked-receipt');
    assert.equal(new URL(instance.link.href).protocol,'mailto:');
    assert.ok(new URL(instance.link.href).searchParams.get('body').includes('blocked-receipt'));
});

test('product selection submits only product ID and quantity and sends the server-confirmed prices with the receipt',async()=>{
    const selected=catalog.products[0];
    const appInstance=app(async body=>({ok:true,json:async()=>({ok:true,quoteId:'priced-order',currency:'EGP',items:[{productId:body.items[0].productId,quantity:1,name:selected.ar.name,nameEn:selected.en.name,unitPrice:123.45,total:123.45}]})}),{selectedProduct:selected.id});
    await tick();await appInstance.events.submit({preventDefault(){}});
    assert.deepEqual(appInstance.requests[0].items,[{productId:selected.id,quantity:1}]);
    assert.equal(appInstance.requests[0].price,undefined);
    assert.equal(appInstance.requests[0].items[0].unitPrice,undefined);
    const message=new URL(appInstance.destinations[0]).searchParams.get('text');
    assert.ok(message.includes('أسعار المنتجات المحفوظة وقت إنشاء الطلب'));
    assert.ok(message.includes('١٢٣٫٤٥'));assert.ok(message.includes('priced-order'));
});

class MemoryR2 {
    objects=new Map();
    async put(key,data,options={}){this.objects.set(key,{key,data,...options,size:new TextEncoder().encode(data).length,uploaded:new Date()});}
    async get(key){const object=this.objects.get(key);return object?{...object,text:async()=>object.data}:null;}
    async list({prefix='',limit=1000,cursor}={}){const keys=[...this.objects.keys()].filter(key=>key.startsWith(prefix)&&(!cursor||key>cursor)).sort();const selected=keys.slice(0,limit);return{objects:selected.map(key=>this.objects.get(key)),truncated:keys.length>limit,cursor:selected.at(-1)};}
    async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])this.objects.delete(key);}
}

test('safe end-to-end quotation uses the real frontend and Worker with ephemeral D1/R2 and a fake mail provider',async()=>{
    const workerOrigin='https://worker.example.test';
    const pageOrigin='https://khaledkotb611-max.github.io';
    const owner={'oai-authenticated-user-id':'test-owner','oai-authenticated-user-email':'owner@example.com'};
    const env={DB:new D1(),BACKUPS:new MemoryR2(),ADMIN_EMAILS:'owner@example.com',TRUSTED_SITES_IDENTITY:'true',RESEND_API_KEY:'test-only-key',NOTIFICATION_FROM:'orders@example.test',NOTIFICATION_TO:'owner@example.test'};
    const tasks=[];const sent=[];let submittedReceipt;
    const originalFetch=globalThis.fetch;
    globalThis.fetch=async(url,options)=>{sent.push({url,options});return new Response(JSON.stringify({id:'test-provider-id'}),{status:200,headers:{'Content-Type':'application/json'}});};
    const call=(path,{method='GET',headers={},body,ctx}={})=>worker.fetch(new Request(workerOrigin+path,{method,headers,...(body?{body}: {})}),env,ctx);
    try{
        const preflight=await call('/api/quotes',{method:'OPTIONS',headers:{Origin:pageOrigin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});
        assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),pageOrigin);

        const selected=catalog.products[0];
        const instance=app(async body=>{
            const response=await call('/api/quotes',{method:'POST',headers:{Origin:pageOrigin,'Content-Type':'application/json','CF-Connecting-IP':'198.51.100.25'},body:JSON.stringify(body),ctx:{waitUntil(task){tasks.push(task);}}});
            if(response.ok)submittedReceipt=await response.clone().json();
            return response;
        },{selectedProduct:selected.id,catalogFetcher:(_path,options)=>call('/api/products',{headers:{Origin:pageOrigin,...options.headers}})});
        for(let attempt=0;attempt<20&&!instance.grid.innerHTML.includes(selected.ar.name);attempt++)await tick();
        assert.ok(instance.grid.innerHTML.includes(selected.ar.name),instance.status.textContent);
        await instance.events.submit({preventDefault(){}});
        await Promise.all(tasks);
        assert.ok(instance.status.textContent.includes('تم حفظ'));
        assert.equal(submittedReceipt.ok,true);
        assert.deepEqual(instance.requests[0].items,[{productId:selected.id,quantity:1}]);
        assert.equal(instance.requests[0].price,undefined);
        assert.equal(submittedReceipt.items[0].unitPrice,selected.price);
        assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS count FROM quotes').get().count,1);
        assert.equal(env.DB.sqlite.prepare('SELECT unit_price FROM quote_items').get().unit_price,selected.price);
        assert.equal(sent.length,1);assert.equal(sent[0].url,'https://api.resend.com/emails');
        assert.equal(env.DB.sqlite.prepare('SELECT state FROM quote_notifications').get().state,'submitted');
        const duplicate=await call('/api/quotes',{method:'POST',headers:{Origin:pageOrigin,'Content-Type':'application/json','CF-Connecting-IP':'198.51.100.25'},body:JSON.stringify(instance.requests[0])});
        assert.equal(duplicate.status,200);assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS count FROM quotes').get().count,1);assert.equal(sent.length,1);

        const adminList=await call('/api/quotes?limit=30',{headers:owner});
        assert.equal(adminList.status,200);
        const orders=await adminList.json();assert.equal(orders.total,1);assert.equal(orders.quotes[0].id,submittedReceipt.quoteId);
        assert.equal(orders.quotes[0].items[0].unitPrice,selected.price);

        const changed=await call('/api/quotes/'+submittedReceipt.quoteId,{method:'PATCH',headers:{...owner,Origin:workerOrigin,'Content-Type':'application/json'},body:JSON.stringify({status:'contacted',notes:'Local end-to-end check',version:0})});
        assert.equal(changed.status,200);
        const history=await call('/api/quotes/'+submittedReceipt.quoteId+'/history',{headers:owner});
        const events=(await history.json()).events;assert.equal(events.length,1);assert.equal(events[0].status,'contacted');assert.equal(events[0].actor,'owner@example.com');

        const backupsResponse=await call('/api/admin/backups',{headers:owner});
        const backups=await backupsResponse.json();assert.equal(backupsResponse.status,200);assert.ok(backups.backups.length>=1);
        assert.equal(backups.state.revision,backups.state.saved_revision);
        const backupId=backups.backups[0].id;
        const preview=await call('/api/admin/backups/'+backupId+'/restore',{method:'POST',headers:{...owner,Origin:workerOrigin,'Content-Type':'application/json'},body:JSON.stringify({mode:'preview'})});
        const previewBody=await preview.json();assert.equal(preview.status,200);assert.equal(previewBody.missing,0);assert.equal(previewBody.preserved,1);
        assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS count FROM quotes').get().count,1);
    }finally{globalThis.fetch=originalFetch;}
});
