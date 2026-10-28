import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import worker from '../dist/server/index.js';
import {D1} from './d1-helper.mjs';
import {syncPlan} from '../scripts/sync-catalog.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const settle=async(app)=>{
    for(let i=0;i<8;i++){
        if(app?.pendingRequests.size)await Promise.allSettled([...app.pendingRequests]);
        await tick();
        if(app)for(const [id,timer] of app.timers)if(timer.delay===0){app.timers.delete(id);await timer.callback();}
    }
};
const seed=JSON.parse(readFileSync('data/catalog.json','utf8'));
const adminHeaders={'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.com'};
function dom() {
    const elements=new Map(),listeners=new Map(),timers=new Map(),appended=[];let timerId=0;
    const classes={add(){},remove(){},toggle(){},contains(){return false;}};
    const element=id=>{if(!elements.has(id))elements.set(id,{id,value:'',checked:true,innerHTML:'',textContent:'',hidden:false,disabled:false,events:{},dataset:{},classList:classes,addEventListener(name,handler){this.events[name]=handler;},querySelectorAll(){return [];},reportValidity(){return true;},replaceChildren(){this.innerHTML='';},append(){},setAttribute(){},removeAttribute(){},close(){this.open=false;this.events.close?.();},showModal(){this.open=true;}});return elements.get(id);};
    const document={hidden:false,title:'',body:{classList:classes,append(node){appended.push(node);}},documentElement:{classList:classes,setAttribute(){},getAttribute(){return 'light';}},getElementById:element,querySelectorAll:()=>[],querySelector:()=>null,createElement:()=>element('new'),importNode:node=>element(node.id),addEventListener(name,callback){const previous=listeners.get(name);listeners.set(name,previous?(...args)=>{previous(...args);callback(...args);}:callback);}};
    const context={document,window:{addEventListener(){},confirm:()=>true,matchMedia:()=>({matches:false}),location:{hostname:'mak.example',href:'https://mak.example/',pathname:'/',search:''},focus(){}},DOMParser:class {parseFromString(html){assert.ok(html.includes('id="product-dialog"'));return {getElementById:id=>({id})};}},AbortController,AbortSignal,URL,URLSearchParams,crypto,Intl,Date,setTimeout(callback,delay){timers.set(++timerId,{callback,delay});return timerId;},clearTimeout(id){timers.delete(id);},requestAnimationFrame:()=>1,localStorage:{getItem:()=>null,setItem(){}}};
    return {context,element,elements,timers,listeners,document,appended,pendingRequests:new Set()};
}
const trackFetch=(app,fetch)=>{app.context.fetch=(...args)=>{const request=Promise.resolve().then(()=>fetch(...args));app.pendingRequests.add(request);return request.finally(()=>app.pendingRequests.delete(request));};};

test('admin form CRUD reaches the real Worker database; public polling reflects changes, stops while hidden and recovers from failure',async()=>{
    const env={DB:new D1(),ADMIN_EMAILS:'owner@example.com'};
    const requests=[];let offline=false;
    const frontend=dom();trackFetch(frontend,async(path,options={})=>{const request={path,...options};requests.push(request);if(offline)throw new TypeError('Network offline');const response=await worker.fetch(new Request('https://mak.example'+path,options),env);request.status=response.status;if(path==='/api/products' && response.status===200)request.productNames=(await response.clone().json()).products.map(product=>product.ar.name);return response;});
    vm.createContext(frontend.context);vm.runInContext(readFileSync('script.js','utf8'),frontend.context);frontend.listeners.get('DOMContentLoaded')();await settle(frontend);
    assert.ok(frontend.element('catalog-grid').innerHTML.includes(seed.products[0].ar.name));
    const dashboard=dom();trackFetch(dashboard,(path,options={})=>worker.fetch(new Request('https://mak.example'+path,{...options,headers:{...options.headers,...adminHeaders}}),env));
    vm.createContext(dashboard.context);vm.runInContext(readFileSync('admin.js','utf8')+'\n'+readFileSync('product-editor.js','utf8')+'\n'+readFileSync('catalog-admin.js','utf8'),dashboard.context);await settle(dashboard);
    dashboard.element('add-product').events.click();
    dashboard.element('product-id').value='ui-added-product';dashboard.element('product-price').value='23.45';dashboard.element('product-ar-name').value='منتج من اللوحة';dashboard.element('product-en-name').value='Created in dashboard';
    await dashboard.element('product-form').events.submit({preventDefault(){}});await settle(dashboard);
    assert.equal(env.DB.sqlite.prepare('SELECT price FROM products WHERE id=?').get('ui-added-product').price,23.45);
    assert.ok(dashboard.element('products-list').innerHTML.includes('منتج من اللوحة'));
    frontend.document.hidden=true;frontend.listeners.get('visibilitychange')();assert.equal(frontend.timers.size,0);
    frontend.document.hidden=false;frontend.listeners.get('visibilitychange')();await settle(frontend);
    assert.ok(frontend.element('catalog-grid').innerHTML.includes('منتج من اللوحة'),JSON.stringify(requests.map(({path,status,productNames})=>({path,status,hasProduct:productNames?.includes('منتج من اللوحة')}))));
    dashboard.element('product-price').value='31.25';await dashboard.element('product-form').events.submit({preventDefault(){}});await settle(dashboard);
    const poll=[...frontend.timers.values()].find(timer=>timer.delay===30000);assert.ok(poll);await poll.callback();await settle(frontend);
    assert.ok(frontend.element('catalog-grid').innerHTML.includes('٣١٫٢٥'));assert.equal(env.DB.sqlite.prepare('SELECT price FROM products WHERE id=?').get('ui-added-product').price,31.25);
    env.DB.sqlite.prepare('UPDATE products SET price=? WHERE id=?').run(42.75,'ui-added-product');
    await [...frontend.timers.values()].find(t=>t.delay===30000).callback();await settle(frontend);assert.ok(frontend.element('catalog-grid').innerHTML.includes('٤٢٫٧٥'));
    offline=true;await [...frontend.timers.values()].find(t=>t.delay===30000).callback();await settle(frontend);assert.ok(frontend.element('catalog-sync-status').textContent.includes('قديمة'));assert.ok(frontend.element('catalog-grid').innerHTML.includes('٤٢٫٧٥'));
    offline=false;await [...frontend.timers.values()].find(t=>t.delay===60000).callback();await settle(frontend);assert.equal(frontend.element('catalog-sync-status').textContent,'');
    // Reload the direct database change explicitly before saving, preserving version safety.
    dashboard.element('reload-product').hidden=false;await dashboard.element('reload-product').events.click();dashboard.element('product-active').checked=false;
    await dashboard.element('product-form').events.submit({preventDefault(){}});await settle(dashboard);
    await [...frontend.timers.values()].find(t=>t.delay===30000).callback();await settle(frontend);assert.ok(!frontend.element('catalog-grid').innerHTML.includes('منتج من اللوحة'));
    await dashboard.element('delete-product').events.click();await settle(dashboard);assert.ok(!dashboard.element('products-list').innerHTML.includes('منتج من اللوحة'));
    assert.ok(env.DB.sqlite.prepare('SELECT deleted_at FROM products WHERE id=?').get('ui-added-product').deleted_at);
    assert.ok(requests.every(request=>!request.path.includes('catalog.json')));
});

test('GitHub Pages falls back to the static catalog and links to static product pages',async()=>{
    const app=dom();app.context.window.location.hostname='khaledkotb611-max.github.io';app.context.window.location.href='https://khaledkotb611-max.github.io/makc-company/';
    const requests=[];app.context.fetch=async(path)=>{requests.push(path);if(path==='/api/products')throw new TypeError('API unavailable');assert.equal(path,'https://khaledkotb611-max.github.io/makc-company/data/catalog.json');return {ok:true,json:async()=>seed};};
    vm.createContext(app.context);vm.runInContext(readFileSync('script.js','utf8'),app.context);app.listeners.get('DOMContentLoaded')();await settle(app);
    const product=seed.products[0];const grid=app.element('catalog-grid').innerHTML;
    assert.ok(grid.includes(product.ar.name));assert.ok(grid.includes('product.html?id='+encodeURIComponent(product.id)));assert.equal(requests.length,2);
    assert.equal(app.element('catalog-sync-status').textContent,'');
});

test('directional catalog synchronization reuses CRUD APIs, compares real content and makes deletion opt-in',()=>{
    const p={...seed.products[0],active:true,version:8};const source={currency:'EGP',products:[{...p,price:3.45}]};const target={currency:'EGP',products:[p,{...p,id:'extra-product'}]};
    let plan=syncPlan(source,target);assert.equal(plan.length,1);assert.equal(plan[0].method,'PUT');assert.equal(plan[0].body.version,8);
    assert.equal(syncPlan(source,source).length,0);plan=syncPlan(source,target,{prune:true});assert.equal(plan[1].method,'DELETE');
    assert.equal(syncPlan({currency:'EGP',products:[p]},{currency:'EGP',products:[]})[0].method,'POST');
});

async function frontendApp(env,{admin=true,transport}={}) {
    const app=dom();app.signedIn=admin;app.requests=[];
    trackFetch(app,async(path,options={})=>{
        app.requests.push({path,...options});
        const run=()=>worker.fetch(new Request('https://mak.example'+path,{...options,headers:{...options.headers,...(app.signedIn?adminHeaders:{})}}),env);
        return transport?transport(path,options,run):run();
    });
    vm.createContext(app.context);
    vm.runInContext(['product-editor.js','catalog-frontend.js','script.js'].map(file=>readFileSync(file,'utf8')).join('\n'),app.context);
    app.listeners.get('DOMContentLoaded')();await settle(app);return app;
}
async function dashboardApp(env) {
    const app=dom();trackFetch(app,(path,options={})=>worker.fetch(new Request('https://mak.example'+path,{...options,headers:{...options.headers,...adminHeaders}}),env));
    vm.createContext(app.context);vm.runInContext(['admin.js','product-editor.js','catalog-admin.js'].map(file=>readFileSync(file,'utf8')).join('\n'),app.context);await settle(app);return app;
}
async function poll(app,delay) {
    const entry=[...app.timers.entries()].find(([,timer])=>timer.delay===delay);assert.ok(entry,`Missing ${delay}ms poll`);
    app.timers.delete(entry[0]);await entry[1].callback();await settle(app);
}
const fill=(app,id,name,price)=>{
    app.element('product-id').value=id;app.element('product-price').value=String(price);
    app.element('product-ar-name').value=name;app.element('product-en-name').value='English '+name;
    app.element('product-ar-size').value='٤ بوصة';app.element('product-en-size').value='4 inch';
    app.element('product-ar-finish').value='أخضر';app.element('product-en-finish').value='Green';app.element('product-image').value='/images/ppr.jpg';
};
const submit=async app=>{await app.element('product-form').events.submit({preventDefault(){}});await settle(app);};
async function editPublic(app,id) {
    app.listeners.get('click')({target:{closest(selector){return selector==='[data-manage-product]'?{dataset:{manageProduct:id}}:null;}},preventDefault(){}});await settle(app);
    assert.equal(app.element('product-dialog').open,true);
}
const editAdmin=(app,id)=>app.element('products-list').events.click({target:{closest(){return {dataset:{editProduct:id}};}}});

test('both actual management surfaces persist Add/Edit/Delete in one D1 binding and poll each other; historical orders remain priced at purchase',async()=>{
    const env={DB:new D1(),ADMIN_EMAILS:'owner@example.com'};
    const front=await frontendApp(env),admin=await dashboardApp(env);
    const originals=env.DB.sqlite.prepare('SELECT * FROM products ORDER BY id').all();assert.equal(originals.length,seed.products.length);
    assert.equal(front.element('catalog-management').hidden,false);
    assert.ok(front.element('catalog-grid').innerHTML.includes('data-manage-product='));
    assert.equal(front.requests.filter(r=>r.path==='/admin.html').length,0);
    front.element('catalog-add-product').events.click();await settle(front);fill(front,'outside-added','إضافة من الموقع',21.25);await submit(front);
    assert.equal(front.appended.length,1);assert.equal(front.element('product-dialog').open,false);
    assert.equal(env.DB.sqlite.prepare('SELECT price FROM products WHERE id=?').get('outside-added').price,21.25);
    await poll(admin,15000);assert.ok(admin.element('products-list').innerHTML.includes('إضافة من الموقع'));
    const order={requestId:crypto.randomUUID(),name:'Test Client',phone:'01000000000',projectType:'Home',message:'Test quantity',items:[{productId:'outside-added',quantity:2}]};
    const receiptResponse=await worker.fetch(new Request('https://mak.example/api/quotes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(order)}),env);
    assert.equal(receiptResponse.status,201);const receipt=await receiptResponse.json();
    await editPublic(front,'outside-added');front.element('product-price').value='32.50';front.element('product-ar-name').value='تعديل من الموقع';await submit(front);
    await poll(admin,15000);assert.ok(admin.element('products-list').innerHTML.includes('تعديل من الموقع'));assert.ok(admin.element('products-list').innerHTML.includes('٣٢٫٥'));
    await editPublic(front,'outside-added');front.element('product-active').checked=false;await submit(front);await poll(admin,15000);
    assert.ok(!front.element('catalog-grid').innerHTML.includes('تعديل من الموقع'));assert.ok(admin.element('products-list').innerHTML.includes('تعديل من الموقع'));assert.ok(admin.element('products-list').innerHTML.includes('متوقف'));
    editAdmin(admin,'outside-added');admin.element('product-active').checked=true;await submit(admin);await poll(front,30000);assert.ok(front.element('catalog-grid').innerHTML.includes('تعديل من الموقع'));
    await editPublic(front,'outside-added');await front.element('delete-product').events.click();await settle(front);await poll(admin,15000);
    assert.ok(!admin.element('products-list').innerHTML.includes('تعديل من الموقع'));assert.ok(env.DB.sqlite.prepare('SELECT deleted_at FROM products WHERE id=?').get('outside-added').deleted_at);
    admin.element('add-product').events.click();fill(admin,'inside-added','إضافة من اللوحة',55.75);await submit(admin);await poll(front,30000);
    assert.ok(front.element('catalog-grid').innerHTML.includes('إضافة من اللوحة'));assert.equal(env.DB.sqlite.prepare('SELECT price FROM products WHERE id=?').get('inside-added').price,55.75);
    admin.element('product-price').value='66.25';admin.element('product-ar-name').value='تعديل من اللوحة';await submit(admin);await poll(front,30000);
    assert.ok(front.element('catalog-grid').innerHTML.includes('تعديل من اللوحة'));assert.ok(front.element('catalog-grid').innerHTML.includes('٦٦٫٢٥'));
    await admin.element('delete-product').events.click();await settle(admin);await poll(front,30000);assert.ok(!front.element('catalog-grid').innerHTML.includes('تعديل من اللوحة'));
    const stored=env.DB.sqlite.prepare('SELECT unit_price,quantity FROM quote_items WHERE quote_id=?').get(receipt.quoteId);
    assert.equal(stored.unit_price,21.25);assert.equal(stored.quantity,2);
    assert.deepEqual(env.DB.sqlite.prepare('SELECT * FROM products WHERE id NOT IN (?,?) ORDER BY id').all('outside-added','inside-added'),originals);
    assert.ok(front.requests.filter(r=>r.path.startsWith('/api/') && /POST|PATCH|DELETE/.test(r.method || '')).every(r=>r.path.startsWith('/api/products')));
    assert.equal(front.requests.some(r=>r.path==='/api/catalog' || r.path.includes('catalog.json')),false);
});

test('ordinary visitors have no management UI or writes; an expired admin session closes the editor and never submits a mutation',async()=>{
    const env={DB:new D1(),ADMIN_EMAILS:'owner@example.com'};
    const visitor=await frontendApp(env,{admin:false});
    assert.equal(visitor.element('catalog-management').hidden,true);assert.ok(!visitor.element('catalog-grid').innerHTML.includes('data-manage-product='));
    visitor.element('catalog-add-product').events.click();await settle(visitor);assert.equal(visitor.requests.some(r=>r.path==='/admin.html'),false);
    assert.equal((await worker.fetch(new Request('https://mak.example/api/products',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),env)).status,401);
    const owner=await frontendApp(env);owner.element('catalog-add-product').events.click();await settle(owner);fill(owner,'expired-product','لا يُحفظ',10);
    owner.signedIn=false;await submit(owner);
    assert.equal(owner.element('catalog-management').hidden,true);assert.equal(owner.element('product-dialog').open,false);
    assert.equal(owner.requests.filter(r=>r.method==='POST').length,0);assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM products WHERE id=?').get('expired-product').n,0);
});

test('public product editor preserves drafts across network failures and concurrent admin changes, requires reload and prevents duplicate writes',async()=>{
    const env={DB:new D1(),ADMIN_EMAILS:'owner@example.com'};let failed=false,release=null,hold=false;
    const front=await frontendApp(env,{transport:async(path,options,run)=>{
        if(options.method==='PATCH' && failed)throw new TypeError('Offline');
        if(options.method==='PATCH' && hold)await new Promise(resolve=>release=resolve);
        return run();
    }});const admin=await dashboardApp(env);const id=seed.products[0].id;
    await editPublic(front,id);front.element('product-price').value='19.50';failed=true;await submit(front);
    assert.equal(front.element('product-price').value,'19.50');assert.equal(front.element('product-dialog').open,true);assert.ok(front.element('product-save-status').textContent.includes('أعد المحاولة'));
    editAdmin(admin,id);admin.element('product-price').value='22.75';await submit(admin);
    await poll(front,30000);assert.equal(front.element('product-price').value,'19.50');assert.equal(front.element('save-product').disabled,true);assert.equal(front.element('reload-product').hidden,false);
    const before=front.requests.filter(r=>r.method==='PATCH').length;failed=false;await submit(front);assert.equal(front.requests.filter(r=>r.method==='PATCH').length,before);
    await front.element('reload-product').events.click();assert.equal(front.element('product-price').value,22.75);front.element('product-price').value='33.25';hold=true;
    const pending=front.element('product-form').events.submit({preventDefault(){}});await settle();await front.element('product-form').events.submit({preventDefault(){}});await settle();assert.equal(front.requests.filter(r=>r.method==='PATCH').length,before+1);
    release();await pending;await settle(front);assert.equal(env.DB.sqlite.prepare('SELECT price FROM products WHERE id=?').get(id).price,33.25);
    await poll(admin,15000);assert.equal(admin.element('save-product').disabled,true);assert.equal(admin.element('product-price').value,'22.75');
});

test('public management keeps the existing Django session CSRF contract on writes only',async()=>{
    const env={DB:new D1(),ADMIN_EMAILS:'owner@example.com'};
    const front=await frontendApp(env,{transport:async(path,options,run)=>path==='/api/admin/session'?new Response(JSON.stringify({ok:true,authMode:'django',csrfToken:'existing-session-csrf'}),{headers:{'Content-Type':'application/json'}}):run()});
    front.element('catalog-add-product').events.click();await settle(front);fill(front,'django-ui-product','جلسة الإدارة',12.25);await submit(front);
    assert.equal(front.requests.find(r=>r.method==='POST').headers['X-CSRFToken'],'existing-session-csrf');
    assert.ok(front.requests.filter(r=>!r.method).every(r=>!r.headers?.['X-CSRFToken']));
    assert.equal(front.requests.find(r=>r.method==='POST').credentials,'same-origin');
});

test('saving while an earlier catalog request is in flight forces a fresh read in both surfaces instead of restoring old data',async()=>{
    const env={DB:new D1(),ADMIN_EMAILS:'owner@example.com'};let hold=false,release;
    const front=await frontendApp(env,{transport:async(path,options,run)=>{
        if(path==='/api/products' && hold){hold=false;const old=await run();await new Promise(resolve=>release=resolve);return old;}
        return run();
    }});const id=seed.products[0].id;
    await editPublic(front,id);front.element('product-price').value='41.25';hold=true;
    const timer=[...front.timers.entries()].find(([,t])=>t.delay===30000);front.timers.delete(timer[0]);const reading=timer[1].callback();await settle();
    await front.element('product-form').events.submit({preventDefault(){}});await settle();release();await reading;await settle(front);
    assert.ok(front.element('catalog-grid').innerHTML.includes('٤١٫٢٥'));
    const admin=await dashboardApp(env);editAdmin(admin,id);admin.element('product-price').value='52.75';
    const transport=admin.context.fetch;let adminRelease,adminHold=true;
    admin.context.fetch=async(path,options)=>{
        if(path==='/api/products?includeInactive=1' && adminHold){adminHold=false;const old=await transport(path,options);await new Promise(resolve=>adminRelease=resolve);return old;}
        return transport(path,options);
    };
    const fetching=vm.runInContext('loadAdminProducts()',admin.context);await settle();await admin.element('product-form').events.submit({preventDefault(){}});await settle();adminRelease();await fetching;await settle(admin);
    assert.ok(admin.element('products-list').innerHTML.includes('٥٢٫٧٥'));assert.equal(admin.element('save-product').disabled,false);
});
