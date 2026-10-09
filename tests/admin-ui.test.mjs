import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync('admin.js','utf8');
const excelModule={exports:{}};
new Function('module','exports',readFileSync('vendor/exceljs-4.4.0.min.js','utf8'))(excelModule,excelModule.exports);
const ExcelJS=excelModule.exports;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function dashboard(session={ok:true}){
    const elements=new Map();
    function element(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',hidden:['new-alert','dashboard','local-login'].includes(id),disabled:false,events:{},addEventListener(name,handler){this.events[name]=handler;},replaceChildren(){this.innerHTML='';},append(){},close(){this.open=false;},showModal(){this.open=true;},setAttribute(){},removeAttribute(name){delete this[name];}});return elements.get(id);}
    const quote={id:'a5e152b0-2f6c-42c2-a2b8-91f241c983c2',name:'<img src=x onerror=alert(1)>',phone:'01000000000',email:'customer@example.com',message:'25 mm pipe',projectType:'Home',createdAt:'2026-10-02T12:00:00Z',status:'new',notes:'',version:0,notification:{state:'pending'}};
    let total=1;let fail=false;const updates=[];const requests=[];
    let health={notifications:{configured:false,counts:{pending:1}},worker:{mode:'traffic',state:'on_request'},backup:{revision:1,saved_revision:1}};
    let history=[];
    const timers=[];
    const context={ExcelJS,document:{title:'',addEventListener(){},getElementById:element,querySelectorAll:()=>[],createElement:()=>element('link')},window:{focus(){},addEventListener(){}},setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){},AbortController,AbortSignal,URLSearchParams,Intl,Date,fetch:async(path,options)=>{
        requests.push({path,...options});
        if(fail)return {ok:false,status:503};
        if(path==='/api/admin/session')return {ok:true,json:async()=>session};
        if(path==='/api/admin/health')return {ok:true,json:async()=>health};
        if(path.includes('/history'))return {ok:true,json:async()=>({events:history,nextBefore:null})};
        if(path==='/api/admin/backups')return {ok:true,json:async()=>({state:{revision:1,saved_revision:1,last_at:'2026-10-04T12:00:00Z'},backups:[]})};
        if(options.method==='PATCH'){updates.push(JSON.parse(options.body));return {ok:true,json:async()=>({quote:{...quote,...updates.at(-1),version:updates.at(-1).version+1}})};}
        return {ok:true,json:async()=>({quotes:[quote],total,summary:{total,new:total,contacted:0,fulfilled:0},notificationSettings:{configured:false,recipient:'',from:''}})};
    }};
    context.dashboardTimer=context.setTimeout;context.dashboardClearTimer=context.clearTimeout;
    context.setTimeout=setTimeout;context.clearTimeout=clearTimeout;context.setImmediate=setImmediate;
    vm.createContext(context);
    vm.runInContext(readFileSync('vendor/exceljs-4.4.0.min.js','utf8'),context);
    context.ExcelJS=context.window.ExcelJS;
    vm.runInContext('(function(setTimeout,clearTimeout){'+source+'; Object.assign(globalThis,{ordersXlsx,whatsappNumber,cairoDayStart,orderFilters});})(dashboardTimer,dashboardClearTimer);',context);
    return {element,elements,context,updates,requests,setTotal(value){total=value;},setFailure(value){fail=value;},setHealth(value){health=value;},setHistory(value){history=value;}};
}

test('service status shows stale workers and order history escapes administrator names',async()=>{
    const app=dashboard();await tick();
    app.setHealth({notifications:{configured:true,counts:{failed:2,action_required:1}},worker:{mode:'continuous',state:'stale'},backup:{revision:2,saved_revision:1}});
    app.element('refresh').events.click();await tick();
    assert.ok(app.element('service-status').textContent.includes('متوقفة أو متأخرة'));
    assert.ok(app.element('queue-status').textContent.includes('٢'));
    app.setHistory([{actor:'<img src=x onerror=alert(1)>',previousStatus:'new',status:'contacted',notesChanged:true,createdAt:'2026-10-08T12:00:00Z'}]);
    app.element('order-list').events.click({target:{closest(){return {dataset:{id:'a5e152b0-2f6c-42c2-a2b8-91f241c983c2'}};}}});await tick();
    assert.ok(app.element('history-list').innerHTML.includes('&lt;img'));
    assert.ok(!app.element('history-list').innerHTML.includes('<img src=x'));
    assert.ok(app.element('history-list').innerHTML.includes('تعديل ملاحظات المتابعة'));
});

test('Django sessions attach CSRF only to mutations and logout uses POST',async()=>{
    const app=dashboard({ok:true,authMode:'django',csrfToken:'session-csrf-token'});await tick();
    const quoteId='a5e152b0-2f6c-42c2-a2b8-91f241c983c2';
    app.element('order-list').events.click({target:{closest(){return {dataset:{id:quoteId}};}}});
    app.element('order-notes').value='Called';app.element('order-status').value='contacted';
    await app.element('update-order').events.submit({preventDefault(){}});
    assert.equal(app.requests.find(request=>request.method==='PATCH').headers['X-CSRFToken'],'session-csrf-token');
    assert.equal(app.requests.find(request=>request.path.startsWith('/api/quotes?')).headers['X-CSRFToken'],undefined);
    let prevented=false;let destination='';app.context.window.location={assign(value){destination=value;}};
    await app.element('signout').events.click({preventDefault(){prevented=true;}});
    const logout=app.requests.find(request=>request.path==='/admin/logout');
    assert.equal(prevented,true);assert.equal(logout.method,'POST');assert.equal(logout.headers['X-CSRFToken'],'session-csrf-token');
    assert.equal(destination,'/admin/login');assert.equal(app.element('session-login').hidden,false);
});

test('dashboard displays actual orders safely, detects new arrivals once, and preserves baseline during outages',async()=>{
    const app=dashboard();await tick();
    assert.equal(app.element('new-alert').hidden,true);
    assert.equal(app.element('new-alert-text').textContent,'');
    assert.ok(app.element('order-list').innerHTML.includes('&lt;img'));
    assert.ok(!app.element('order-list').innerHTML.includes('<img src=x'));
    app.setTotal(3);await app.element('refresh').events.click();await tick();
    assert.ok(app.element('new-alert-text').textContent.includes('٢'));
    const text=app.element('new-alert-text').textContent;
    app.setFailure(true);app.element('refresh').events.click();await tick();
    assert.ok(app.element('page-status').textContent.includes('قديمة'));
    app.setFailure(false);app.element('refresh').events.click();await tick();assert.equal(app.element('new-alert-text').textContent,text);
});

test('editing an order sends its version and selected status while automatic refresh keeps the draft',async()=>{
    const app=dashboard();await tick();
    app.element('order-list').events.click({target:{closest(){return {dataset:{id:'a5e152b0-2f6c-42c2-a2b8-91f241c983c2'}};}}});
    app.element('order-notes').value='Called customer';app.element('order-status').value='contacted';
    app.element('refresh').events.click();await tick();assert.equal(app.element('order-notes').value,'Called customer');
    await app.element('update-order').events.submit({preventDefault(){}});
    assert.deepEqual(app.updates[0],{status:'contacted',notes:'Called customer',version:0});
    assert.ok(app.element('dialog-status').textContent.includes('تم حفظ'));
});

test('WhatsApp handles Egyptian and explicit international numbers without guessing missing country codes',()=>{
    const app=dashboard();
    for(const [input,expected] of [['01000000000','201000000000'],['٠١٢ ٣٤٥٦ ٧٨٩٠','201234567890'],['+20 (10) 0000-0000','201000000000'],['00201000000000','201000000000'],['+44 7700 900123','447700900123'],['201000000000','201000000000'],['',''],['01000',''],['02012345678',''],['7700900123',''],['+20 2 12345678',''],['javascript:alert(1)','']]) {
        assert.equal(app.context.whatsappNumber(input),expected,input);
    }
});

test('order contact opens a draft only and clipboard reports success or failure accurately',async()=>{
    const app=dashboard();await tick();
    app.element('order-list').events.click({target:{closest(){return {dataset:{id:'a5e152b0-2f6c-42c2-a2b8-91f241c983c2'}};}}});
    const url=new URL(app.element('contact-whatsapp').href);
    assert.equal(url.origin,'https://wa.me');assert.equal(url.pathname,'/201000000000');
    assert.ok(url.searchParams.get('text').includes('a5e152b0-2f6c-42c2-a2b8-91f241c983c2'));
    let copied='';app.context.navigator={clipboard:{async writeText(text){copied=text;}}};
    await app.element('copy-order').events.click();
    assert.ok(copied.includes('25 mm pipe'));assert.ok(copied.includes('customer@example.com'));
    assert.equal(app.element('copy-status').textContent,'تم نسخ ملخص الطلب.');
    app.context.navigator.clipboard.writeText=async()=>{throw new Error('denied');};
    await app.element('copy-order').events.click();assert.ok(app.element('copy-status').textContent.includes('تعذّر النسخ'));
});

test('XLSX round-trip preserves Arabic, literal formulas, phone numbers and Cairo dates',async()=>{
    const app=dashboard();
    const input={id:'id',name:'خالد، "قطب"',createdAt:'2026-10-02T12:00:00Z',phone:'01000000000',email:'customer@example.com',projectType:'منزل',status:'new',message:'طلب ماسورة\n٢٥ مم',notes:'=HYPERLINK("x")',notification:{state:'blocked'}};
    const buffer=await app.context.ordersXlsx([input,{...input,phone:'+201000000000',createdAt:'2026-01-02T12:00:00Z'}]);
    assert.equal(buffer[0],0x50);assert.equal(buffer[1],0x4b);
    const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);
    const sheet=workbook.getWorksheet('الطلبات');assert.equal(sheet.rowCount,3);
    assert.equal(sheet.getCell('A1').value,'رقم الطلب');assert.equal(sheet.getCell('C2').value,input.name);
    assert.equal(sheet.getCell('D2').value,'01000000000');assert.equal(sheet.getCell('D3').value,'+201000000000');
    assert.equal(sheet.getCell('H2').value,input.message);assert.equal(sheet.getCell('I2').value,input.notes);
    assert.equal(sheet.getCell('I2').type,ExcelJS.ValueType.String);
    assert.equal(sheet.getCell('B2').value.toISOString(),'2026-10-02T15:00:00.000Z');
    assert.equal(sheet.getCell('B3').value.toISOString(),'2026-01-02T14:00:00.000Z');
    assert.equal(sheet.views[0].rightToLeft,true);assert.equal(sheet.views[0].ySplit,1);
    assert.equal(sheet.getCell('H2').alignment.wrapText,true);assert.equal(sheet.autoFilter,'A1:J3');
});

test('export gathers every filtered page and never downloads an incomplete result',async()=>{
    const app=dashboard();await tick();
    const requests=[];let downloads=0;let blob;
    const row=index=>({id:String(index),name:'عميل',createdAt:'2026-10-02T12:00:00Z',phone:'01000000000',email:'',projectType:'Home',status:'new',message:'طلب',notes:'',notification:{state:'blocked'}});
    app.context.Blob=Blob;app.context.URL={createObjectURL(value){blob=value;return 'blob:test';},revokeObjectURL(){}};
    app.context.document.body={append(){}};app.element('link').click=()=>downloads++;app.element('link').remove=()=>{};
    app.element('status-filter').value='new';app.element('search').value=' عميل ';
    app.element('date-period').value='custom';app.element('date-from').value='2026-10-02';app.element('date-to').value='2026-10-02';
    app.context.fetch=async path=>{const params=new URL('https://example.com'+path).searchParams;requests.push(params);const offset=Number(params.get('offset'));return {ok:true,json:async()=>({total:101,quotes:Array.from({length:offset?1:100},(_,i)=>row(offset+i))})};};
    await app.element('export-orders').events.click();
    assert.equal(downloads,1);assert.equal(requests.length,2);assert.equal(requests[1].get('offset'),'100');
    assert.equal(requests[1].get('q'),'عميل');assert.equal(requests[1].get('status'),'new');
    assert.equal(requests[1].get('createdFrom'),'2026-10-01T21:00:00.000Z');assert.equal(requests[1].get('createdBefore'),'2026-10-02T21:00:00.000Z');
    assert.equal(app.element('link').download.endsWith('.xlsx'),true);
    assert.equal(blob.type,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await blob.arrayBuffer());
    assert.equal(workbook.getWorksheet('الطلبات').getCell('A102').value,'100');assert.equal(app.element('export-orders').disabled,false);
    let page=0;app.context.fetch=async()=>({ok:true,json:async()=>({total:page++?102:101,quotes:Array.from({length:100},(_,i)=>row(i))})});
    await app.element('export-orders').events.click();assert.equal(downloads,1);assert.ok(app.element('export-status').textContent.includes('اتغيّرت'));
    app.context.fetch=async()=>({ok:false,status:503});
    await app.element('export-orders').events.click();assert.equal(downloads,1);assert.ok(app.element('export-status').textContent.includes('تعذّر'));
});

test('Cairo date filters cover complete calendar days through DST and reject reversed ranges',async()=>{
    const app=dashboard();await tick();
    const start=app.context.cairoDayStart;
    assert.equal(start('2026-01-02'),'2026-01-01T22:00:00.000Z');
    assert.equal(Date.parse(start('2026-04-25'))-Date.parse(start('2026-04-24')),23*3600000);
    assert.equal(Date.parse(start('2026-10-30'))-Date.parse(start('2026-10-29')),25*3600000);
    assert.throws(()=>start('2026-02-30'),/Invalid date range/);
    app.element('date-period').value='custom';app.element('date-from').value='2026-10-03';app.element('date-to').value='2026-10-02';
    assert.throws(()=>app.context.orderFilters(),/Invalid date range/);
    app.element('clear-filters').events.click();await tick();assert.equal(app.element('date-from').value,'');assert.equal(app.element('date-to').value,'');
});

test('backup restoration requires preview then explicit confirmation',async()=>{
    const app=dashboard();await tick();const calls=[];
    const id='9000000000000-a5e152b0-2f6c-42c2-a2b8-91f241c983c2';
    app.context.fetch=async(path,options)=>{
        calls.push({path,body:options.body && JSON.parse(options.body)});
        if(path.endsWith('/restore'))return {ok:true,json:async()=>JSON.parse(options.body).mode==='preview'?{missing:1,preserved:2}:{ok:true,restored:1}};
        if(path==='/api/admin/backups')return {ok:true,json:async()=>({state:{revision:1,saved_revision:1,last_at:'2026-10-04T12:00:00Z'},backups:[{id,createdAt:'2026-10-04T12:00:00Z',quoteCount:3}]})};
        return {ok:true,json:async()=>({quotes:[],total:0,summary:{total:0},notificationSettings:{configured:false}})};
    };
    app.element('backup-version').value=id;
    await app.element('preview-restore').events.click();
    assert.equal(app.element('restore-preview').hidden,false);assert.ok(!calls.some(call=>call.body?.mode==='restore'));
    await app.element('confirm-restore').events.click();
    const restore=calls.find(call=>call.body?.mode==='restore');assert.equal(restore.body.confirm,id);assert.equal(app.element('restore-preview').hidden,true);
});
