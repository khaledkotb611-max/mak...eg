const $ = id => document.getElementById(id);
const statuses = { new: 'جديد', contacted: 'تم التواصل', fulfilled: 'تم التنفيذ' };
const mailStates = { pending: 'الإيميل في انتظار الإرسال', sending: 'جاري إرسال الإيميل', submitted: 'الإيميل قُبل للإرسال', failed: 'تعذّر إرسال الإيميل', needs_review: 'تنبيه الإيميل يحتاج مراجعة يدوية', blocked: 'إرسال الإيميل غير مُفعّل', not_requested: 'طلب سابق لتفعيل التنبيهات' };
mailStates.action_required='تنبيه الإيميل يحتاج إصلاح إعدادات الإرسال';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formatDate = value => new Intl.DateTimeFormat('ar-EG', { timeZone:'Africa/Cairo', dateStyle:'medium', timeStyle:'short' }).format(new Date(value));
let token = '';
let djangoSession = false;
let csrfToken = '';
let offset = 0;
let orders = new Map();
let selectedOrder = null;
let lastTotal = null;
let unseen = 0;
let authenticated = false;
let requestController = null;
let pollTimer = null;
let debounce = null;
let updating = false;
let restoring=false;
let restoreId='';
let testEmailId='';
let historyCursor=null;
let historyGeneration=0;
let historyLoading=false;

function cairoDay(value = new Date()) {
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);
    const fields=Object.fromEntries(parts.map(part=>[part.type,part.value]));
    return `${fields.year}-${fields.month}-${fields.day}`;
}

function shiftDay(day, days) {
    return new Date(Date.parse(day+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
}

function cairoDayStart(day) {
    const midnight=Date.parse(day+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0,10)!==day)throw new Error('Invalid date range');
    // Find the first instant in the Cairo calendar day, including DST transitions.
    let low=midnight/1000-86400,high=midnight/1000+86400;
    while(low<high){const middle=Math.floor((low+high)/2);if(cairoDay(new Date(middle*1000))>=day)high=middle;else low=middle+1;}
    return new Date(low*1000).toISOString();
}

function syncDatePeriod() {
    const period=$('date-period').value;
    if(period==='custom')return;
    const today=cairoDay();
    $('date-from').value=period?shiftDay(today,period==='week'?-6:period==='month'?-29:0):'';
    $('date-to').value=period?today:'';
}

function orderFilters() {
    syncDatePeriod();
    const from=$('date-from').value,to=$('date-to').value;
    if(from && to && from>to)throw new Error('Invalid date range');
    if(to)cairoDayStart(to);
    return {status:$('status-filter').value,q:$('search').value.trim(),createdFrom:from?cairoDayStart(from):'',createdBefore:to?cairoDayStart(shiftDay(to,1)):''};
}

function whatsappNumber(phone) {
    const number = String(phone || '').trim().replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[\s()-]/g, '');
    if (/^01[0125]\d{8}$/.test(number)) return '20' + number.slice(1);
    const international = number.replace(/^\+|^00/, '');
    if (/^20/.test(international)) return /^201[0125]\d{8}$/.test(international) ? international : '';
    return (number.startsWith('+') || number.startsWith('00')) && /^[1-9]\d{7,14}$/.test(international) ? international : '';
}

function orderSummary(order) {
    return [`طلب عرض سعر — MAK`, `رقم الطلب: ${order.id}`, `العميل: ${order.name}`, order.phone && `الموبايل: ${order.phone}`, order.email && `الإيميل: ${order.email}`, `نوع المشروع: ${order.projectType}`, `الحالة: ${statuses[order.status]}`, '', 'طلب العميل:', order.message, ...(order.items || []).map(item=>`${item.name} — ${item.quantity} × ${item.unitPrice} ج.م = ${item.total} ج.م`)].filter(value => value !== false && value !== undefined && value !== null).join('\n');
}

function excelCairoDate(value) {
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));
    const date=Object.fromEntries(parts.map(part=>[part.type,part.value]));
    return new Date(Date.UTC(Number(date.year),Number(date.month)-1,Number(date.day),Number(date.hour),Number(date.minute),Number(date.second)));
}

async function ordersXlsx(rows) {
    const workbook=new ExcelJS.Workbook();workbook.creator='MAK';
    const sheet=workbook.addWorksheet('الطلبات',{views:[{state:'frozen',ySplit:1,rightToLeft:true}]});
    const headers=['رقم الطلب','تاريخ الطلب (بتوقيت القاهرة)','اسم العميل','الموبايل','الإيميل','نوع المشروع','الحالة','تفاصيل الطلب','ملاحظات المتابعة','تنبيه الإيميل'];
    const widths=[38,27,26,22,34,24,20,60,45,34];
    sheet.columns=headers.map((header,index)=>({header,width:widths[index]}));
    sheet.getColumn(2).numFmt='yyyy-mm-dd hh:mm';sheet.getColumn(4).numFmt='@';
    for(const order of rows) {
        // Explicit strings keep Arabic and phone zeros, and never become formulas.
        const text=value=>String(value ?? '');
        const row=sheet.addRow([
            text(order.id),excelCairoDate(order.createdAt),text(order.name),text(order.phone),text(order.email),text(order.projectType),statuses[order.status],text(order.message)+(order.items?.length?'\n\nأسعار المنتجات المحفوظة:\n'+order.items.map(item=>`${item.name} — ${item.quantity} × ${item.unitPrice} ج.م = ${item.total} ج.م`).join('\n'):''),text(order.notes),mailStates[order.notification.state] || text(order.notification.state)
        ]);
        row.height=60;row.font={name:'Arial',size:11};row.alignment={vertical:'top',horizontal:'right',wrapText:true};
        for(const index of [1,2,4,5])row.getCell(index).alignment={vertical:'top',horizontal:'left',wrapText:true};
    }
    const heading=sheet.getRow(1);heading.height=36;
    heading.eachCell(cell=>{cell.font={name:'Arial',size:11,bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF0A6FD1'}};cell.alignment={vertical:'middle',horizontal:'right',wrapText:true};});
    sheet.autoFilter={from:{row:1,column:1},to:{row:rows.length+1,column:headers.length}};
    return workbook.xlsx.writeBuffer();
}

$('export-orders').addEventListener('click',async()=>{
    if(!authenticated || $('export-orders').disabled)return;
    let filters;try{filters=orderFilters();}catch{$('export-status').textContent='تاريخ البداية لازم يكون قبل تاريخ النهاية أو نفس اليوم.';return;}
    const rows=new Map();let expected=null;let position=0;
    $('export-orders').disabled=true;$('export-status').textContent='جاري تجهيز الطلبات المطابقة للبحث والحالة…';
    try {
        do {
            const data=await api('/api/quotes?'+new URLSearchParams({...filters,limit:'100',offset:String(position)}));
            if(!authenticated)throw new Error('Session ended');
            if(expected===null)expected=data.total;
            if(expected>10000)throw new Error('Too many orders');
            if(data.total!==expected || (position<expected && !data.quotes.length))throw new Error('Orders changed');
            data.quotes.forEach(order=>rows.set(order.id,order));position+=data.quotes.length;
            $('export-status').textContent=`تم تجهيز ${rows.size.toLocaleString('ar-EG')} من ${expected.toLocaleString('ar-EG')} طلب…`;
        } while(position<expected);
        if(rows.size!==expected)throw new Error('Orders changed');
        if(!rows.size){$('export-status').textContent='لا توجد طلبات مطابقة للتصدير.';return;}
        const buffer=await ordersXlsx([...rows.values()]);
        if(!authenticated)throw new Error('Session ended');
        const blob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
        const url=URL.createObjectURL(blob);const link=document.createElement('a');
        link.href=url;link.download=`MAK-orders-${new Date().toISOString().slice(0,10)}.xlsx`;document.body.append(link);link.click();link.remove();
        setTimeout(()=>URL.revokeObjectURL(url),30000);
        $('export-status').textContent=`تم تجهيز ملف ${rows.size.toLocaleString('ar-EG')} طلب للتحميل. افتحه في Excel.`;
    } catch(error) {
        if(error.status===401 || error.status===403)lockDashboard();
        $('export-status').textContent=error.message==='Too many orders'?'النتيجة أكبر من ١٠٬٠٠٠ طلب. حدّد البحث أو الحالة لتصدير عدد أقل.':error.message==='Orders changed'?'الطلبات اتغيّرت أثناء التجهيز. أعد التصدير للحصول على ملف كامل.':'تعذّر تصدير الطلبات. راجع اتصالك وتسجيل الدخول وأعد المحاولة.';
    } finally {$('export-orders').disabled=false;}
});

async function api(path, options = {}) {
    const unsafe = !['GET','HEAD','OPTIONS'].includes((options.method || 'GET').toUpperCase());
    const response = await fetch(path, { ...options, headers: { ...(token ? { Authorization:`Bearer ${token}` } : {}), ...(djangoSession && unsafe ? {'X-CSRFToken':csrfToken} : {}), ...options.headers }, cache:'no-store', signal:options.signal || AbortSignal.timeout(15000) });
    if (!response.ok) {
        if(response.status===401){try{const body=await response.json();if(body.authMode==='django')djangoSession=true;}catch{}}
        const error = new Error('Request failed'); error.status=response.status; throw error;
    }
    return response.json();
}

function lockDashboard() {
    authenticated=false;token='';clearTimeout(pollTimer);requestController?.abort();orders.clear();selectedOrder=null;
    $('order-list').replaceChildren();$('dashboard').hidden=true;$('local-login').hidden=djangoSession;$('session-login').hidden=!djangoSession;
    $('order-dialog').close();if(typeof adminProducts!=='undefined'){adminProducts.clear();productEtag='';$('products-list').replaceChildren();adminProductEditor.lock();}restoreId='';$('restore-preview').hidden=true;$('page-status').textContent='سجّل الدخول لمتابعة الطلبات.';
    historyGeneration++;historyLoading=false;historyCursor=null;$('history-list').replaceChildren();$('history-more').hidden=true;
}

async function loadServiceHealth() {
    try {
        const health=await api('/api/admin/health');if(!authenticated)return;
        const counts=health.notifications.counts;
        const queued=(counts.pending || 0)+(counts.sending || 0)+(counts.failed || 0);
        const review=(counts.action_required || 0)+(counts.needs_review || 0);
        $('queue-status').textContent=`تنبيهات منتظرة: ${queued.toLocaleString('ar-EG')} · تحتاج مراجعة: ${review.toLocaleString('ar-EG')} · غير مفعّلة: ${(counts.blocked || 0).toLocaleString('ar-EG')}`;
        const messages=[];
        if(health.worker.mode==='continuous')messages.push(health.worker.state!=='running'?'معالجة التنبيهات والنسخ التلقائية متوقفة أو متأخرة. راجع تشغيل السيرفر.':health.worker.error?'معالجة الخلفية تعمل مع مشكلة مؤقتة؛ راجع التنبيهات والنسخ الاحتياطي.':'معالجة التنبيهات والنسخ التلقائية تعمل.');
        else messages.push('التنبيهات تُعالج بعد حفظ الطلبات وعند زيارات الموقع.');
        if(!health.notifications.configured)messages.push('إرسال الإيميل يحتاج إكمال الإعدادات.');
        if(health.backup?.last_error)messages.push('آخر محاولة لحفظ النسخة الاحتياطية تعثّرت.');
        else if(health.backup && health.backup.saved_revision<health.backup.revision)messages.push('في انتظار حفظ آخر التغييرات في النسخة الاحتياطية.');
        $('service-status').textContent=messages.join(' ');
    }catch(error){if(!authenticated)return;$('service-status').textContent='تعذّر التحقق من حالة الخدمات. أعد التحديث.';if(error.status===401 || error.status===403)lockDashboard();}
}

async function loadHistory(more=false) {
    if(!selectedOrder || historyLoading)return;
    const id=selectedOrder.id,generation=historyGeneration;
    historyLoading=true;$('history-more').disabled=true;$('history-status').textContent='جاري تحميل سجل المتابعة…';
    try {
        const data=await api('/api/quotes/'+id+'/history'+(more && historyCursor?'?before='+historyCursor:''));
        if(!authenticated || selectedOrder?.id!==id || historyGeneration!==generation)return;
        const html=data.events.map(event=>`<li><strong>${escapeHtml(event.actor==='server-api'?'أداة الإدارة':event.actor)}</strong> · ${escapeHtml(statuses[event.previousStatus] || event.previousStatus)} ← ${escapeHtml(statuses[event.status] || event.status)}${event.notesChanged?' · تعديل ملاحظات المتابعة':''}<time>${escapeHtml(formatDate(event.createdAt))}</time></li>`).join('');
        $('history-list').innerHTML=(more?$('history-list').innerHTML:'')+html;
        historyCursor=data.nextBefore;$('history-more').hidden=!historyCursor;
        $('history-status').textContent=$('history-list').innerHTML?'':'لا توجد تعديلات مسجلة بعد. السجل متاح للتعديلات من وقت تفعيل الميزة.';
    }catch(error){if(selectedOrder?.id===id && historyGeneration===generation)$('history-status').textContent='تعذّر تحميل السجل. أغلق تفاصيل الطلب وافتحها مرة أخرى.';if(error.status===401 || error.status===403)lockDashboard();}
    finally{if(historyGeneration===generation){historyLoading=false;$('history-more').disabled=false;}}
}
$('history-more').addEventListener('click',()=>void loadHistory(true));

function newOrderAlert(total) {
    if(lastTotal!==null && total>lastTotal) {
        unseen+=total-lastTotal;
        $('new-alert').hidden=false;
        $('new-alert-text').textContent=`وصل ${unseen.toLocaleString('ar-EG')} طلب جديد من الموقع`;
        document.title=`(${unseen}) طلبات جديدة | MAK`;
        if('Notification' in window && Notification.permission==='granted') {
            const notification=new Notification('MAK — وصل طلب جديد',{body:'افتح لوحة الطلبات لمراجعة التفاصيل.',tag:'mak-new-orders'});
            notification.onclick=()=>{window.focus();notification.close();};
        }
    }
    lastTotal=total;
}

function renderOrders(data) {
    newOrderAlert(data.summary.total);
    orders=new Map(data.quotes.map(q=>[q.id,q]));
    for(const key of ['total','new','contacted','fulfilled'])$(key+'-count').textContent=Number(data.summary[key] || 0).toLocaleString('ar-EG');
    $('result-count').textContent=`${data.total.toLocaleString('ar-EG')} طلب يطابق الفلتر`;
    $('last-update').textContent=`آخر تحديث: ${new Intl.DateTimeFormat('ar-EG',{timeZone:'Africa/Cairo',timeStyle:'short'}).format(new Date())}`;
    $('page-number').textContent=`صفحة ${(Math.floor(offset/30)+1).toLocaleString('ar-EG')} من ${Math.max(1,Math.ceil(data.total/30)).toLocaleString('ar-EG')}`;
    $('previous').disabled=offset===0;$('next').disabled=offset+30>=data.total;
    const settings=data.notificationSettings;
    $('email-status').textContent=settings.configured?`تنبيه كل طلب جديد إلى ${settings.recipient}`:`تنبيهات الإيميل غير مفعّلة بعد. المستقبِل: ${settings.recipient || 'غير محدد'}. يلزم ربط Resend وعنوان على دومين مُفعّل للإرسال.`;
    $('retry-email').disabled=!settings.configured;
    $('test-email').disabled=!settings.configured;
    $('order-list').innerHTML=data.quotes.length?data.quotes.map(q=>`<article class="order-row"><div><h3>${escapeHtml(q.name)}</h3><p>${escapeHtml(formatDate(q.createdAt))}</p></div><div><span class="badge badge-${q.status}">${statuses[q.status]}</span><p class="notification-state">${mailStates[q.notification.state] || 'حالة الإيميل غير معروفة'}</p></div><div><p>${escapeHtml(q.projectType)}</p><p class="preview">${escapeHtml(q.message)}</p></div><div><p dir="ltr">${escapeHtml(q.phone || q.email)}</p></div><button class="secondary open-order" type="button" data-id="${escapeHtml(q.id)}">تفاصيل</button></article>`).join(''):'<p class="empty">لا توجد طلبات تطابق البحث أو الحالة المختارة.</p>';
    $('page-status').textContent='التحديث تلقائي كل 15 ثانية أثناء فتح اللوحة.';
}

async function loadOrders() {
    if(!authenticated)return;
    requestController?.abort();const controller=new AbortController();requestController=controller;
    const timer=setTimeout(()=>controller.abort(),15000);
    try {
        const params=new URLSearchParams({limit:'30',offset:String(offset),...orderFilters()});
        const data=await api('/api/quotes?'+params,{signal:controller.signal});
        if(requestController!==controller)return;
        if(offset && offset>=data.total){offset=0;await loadOrders();return;}
        renderOrders(data);
        void loadBackups();
        void loadServiceHealth();
        if(typeof loadAdminProducts==='function')void loadAdminProducts();
    } catch(error) {
        if(requestController!==controller)return;
        if(error.status===401 || error.status===403)lockDashboard();
        else $('page-status').textContent=error.message==='Invalid date range'?'تاريخ البداية لازم يكون قبل تاريخ النهاية أو نفس اليوم.':'تعذّر تحديث الطلبات. آخر بيانات معروضة قديمة؛ جارٍ إعادة المحاولة.';
    } finally {
        clearTimeout(timer);
        if(requestController===controller){requestController=null;clearTimeout(pollTimer);if(authenticated && !document.hidden)pollTimer=setTimeout(loadOrders,15000);}
    }
}

function openOrder(id) {
    selectedOrder=orders.get(id);if(!selectedOrder)return;
    historyGeneration++;historyLoading=false;historyCursor=null;$('history-list').replaceChildren();$('history-more').hidden=true;
    $('dialog-title').textContent=selectedOrder.name;$('dialog-code').textContent=selectedOrder.id;
    $('order-message').textContent=selectedOrder.message;$('order-status').value=selectedOrder.status;$('order-notes').value=selectedOrder.notes;$('dialog-status').textContent='';
    $('customer-details').replaceChildren();
    const contacts=[['tel:',selectedOrder.phone],['mailto:',selectedOrder.email]];
    for(const [prefix,value] of contacts)if(value){const link=document.createElement('a');link.href=prefix+encodeURIComponent(value);link.textContent=value;link.dir='ltr';$('customer-details').append(link);}
    $('order-items').hidden=!selectedOrder.items?.length;
    $('order-items').textContent=(selectedOrder.items || []).map(item=>`${item.name} — ${item.quantity} × ${Number(item.unitPrice).toLocaleString('ar-EG')} ج.م = ${Number(item.total).toLocaleString('ar-EG')} ج.م`).join('\n');
    const number=whatsappNumber(selectedOrder.phone);
    $('contact-whatsapp').hidden=!number;
    if(number) {
        const message=`أهلاً ${selectedOrder.name}، معك MAK المصرية للتجارة والتوزيع. بنتواصل معاك بخصوص طلب عرض السعر رقم ${selectedOrder.id}.`;
        $('contact-whatsapp').href=`https://wa.me/${number}?text=${encodeURIComponent(message)}`;
    } else $('contact-whatsapp').removeAttribute('href');
    $('contact-hint').hidden=!!number;
    $('copy-status').textContent='';
    $('order-dialog').showModal();
    void loadHistory();
}

$('copy-order').addEventListener('click',async()=>{
    if(!selectedOrder)return;
    const order=selectedOrder;
    try {
        await navigator.clipboard.writeText(orderSummary(order));
        if(selectedOrder?.id===order.id)$('copy-status').textContent='تم نسخ ملخص الطلب.';
    } catch {
        if(selectedOrder?.id===order.id)$('copy-status').textContent='تعذّر النسخ. اسمح للمتصفح بالنسخ وأعد المحاولة.';
    }
});

async function startDashboard() {
    const session=await api('/api/admin/session');djangoSession=session.authMode==='django';csrfToken=session.csrfToken || '';
    authenticated=true;$('local-login').hidden=true;$('session-login').hidden=true;$('dashboard').hidden=false;
    $('admin-key').value='';await loadOrders();
}

$('local-login').addEventListener('submit',async event=>{event.preventDefault();token=$('admin-key').value.trim();try{await startDashboard();}catch{token='';$('page-status').textContent='تعذّر الدخول. راجع مفتاح الإدارة واتصال الإنترنت.';}});
$('refresh').addEventListener('click',()=>{if(authenticated)void loadOrders();});
$('search').addEventListener('input',()=>{clearTimeout(debounce);debounce=setTimeout(()=>{offset=0;void loadOrders();},300);});
$('status-filter').addEventListener('change',()=>{offset=0;syncFilters();void loadOrders();});
$('date-period').addEventListener('change',()=>{offset=0;syncDatePeriod();void loadOrders();});
for(const id of ['date-from','date-to'])$(id).addEventListener('change',()=>{$('date-period').value='custom';offset=0;void loadOrders();});
$('clear-filters').addEventListener('click',()=>{$('search').value='';$('status-filter').value='';$('date-period').value='';syncDatePeriod();offset=0;syncFilters();void loadOrders();});
function syncFilters(){document.querySelectorAll('[data-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.filter===$('status-filter').value)));}
document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{$('status-filter').value=button.dataset.filter;offset=0;syncFilters();void loadOrders();}));
$('previous').addEventListener('click',()=>{offset=Math.max(0,offset-30);void loadOrders();});
$('next').addEventListener('click',()=>{offset+=30;void loadOrders();});
$('order-list').addEventListener('click',event=>{const button=event.target.closest('[data-id]');if(button)openOrder(button.dataset.id);});
$('close-dialog').addEventListener('click',()=>{if(!updating)$('order-dialog').close();});
$('order-dialog').addEventListener('cancel',event=>{if(updating)event.preventDefault();});
$('update-order').addEventListener('submit',async event=>{
    event.preventDefault();if(!selectedOrder || updating)return;updating=true;
    $('save-order').disabled=true;$('close-dialog').disabled=true;$('order-status').disabled=true;$('order-notes').disabled=true;
    try {
        const result=await api('/api/quotes/'+selectedOrder.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:$('order-status').value,notes:$('order-notes').value,version:selectedOrder.version})});
        selectedOrder=result.quote;$('dialog-status').textContent='تم حفظ حالة الطلب والملاحظات.';historyGeneration++;historyLoading=false;void loadHistory();await loadOrders();
    } catch(error){$('dialog-status').textContent=error.status===409?'الطلب اتعدّل من جلسة أخرى. أغلق التفاصيل وافتحها مجددًا قبل الحفظ.':'تعذّر الحفظ. الملاحظات المكتوبة ما زالت موجودة؛ أعد المحاولة.';if(error.status===401 || error.status===403)lockDashboard();}
    finally{updating=false;$('save-order').disabled=false;$('close-dialog').disabled=false;$('order-status').disabled=false;$('order-notes').disabled=false;}
});
$('show-new').addEventListener('click',()=>{unseen=0;$('new-alert').hidden=true;document.title='متابعة الطلبات | MAK';$('status-filter').value='new';$('search').value='';$('date-period').value='';syncDatePeriod();offset=0;syncFilters();void loadOrders();});
$('enable-notifications').addEventListener('click',async()=>{
    if(!('Notification' in window)){$('page-status').textContent='المتصفح لا يدعم الإشعارات؛ التنبيه داخل اللوحة والإيميل يظلان متاحين.';return;}
    const permission=await Notification.requestPermission();$('enable-notifications').textContent=permission==='granted'?'إشعارات المتصفح مُفعّلة':'إشعارات المتصفح غير مُفعّلة';
});
async function loadBackups() {
    if(!authenticated)return;
    try {
        const data=await api('/api/admin/backups');if(!authenticated)return;
        const selected=$('backup-version').value;
        $('backup-version').innerHTML=data.backups.length?data.backups.map(backup=>`<option value="${escapeHtml(backup.id)}">${escapeHtml(formatDate(backup.createdAt))} — ${Number(backup.quoteCount).toLocaleString('ar-EG')} طلب</option>`).join(''):'<option value="">لا توجد نسخ بعد</option>';
        if(data.backups.some(backup=>backup.id===selected))$('backup-version').value=selected;
        else $('backup-version').value=data.backups[0]?.id || '';
        $('download-backup').disabled=!data.backups.length;$('preview-restore').disabled=!data.backups.length || restoring;
        const state=data.state;
        $('backup-health').textContent=!state?'النسخ المحفوظة متاحة للتنزيل، لكن تعذّر قراءة حالة قاعدة الطلبات.':state.last_error?'تعذّر حفظ آخر نسخة. الطلبات محفوظة في قاعدة البيانات؛ النسخ الاحتياطي يحتاج إعادة المحاولة.':state.revision>state.saved_revision?'فيه تعديلات في انتظار النسخ الاحتياطي. جاري تجهيز نسخة جديدة.':state.last_at?`آخر نسخة ناجحة: ${formatDate(state.last_at)}. محفوظة بشكل خاص، ويمكن تنزيلها من هنا.`:'جاري حفظ أول نسخة.';
    } catch {$('backup-health').textContent='تعذّر التحقق من النسخ الاحتياطية. أعد المحاولة.';}
}

$('create-backup').addEventListener('click',async()=>{
    $('create-backup').disabled=true;
    try{const result=await api('/api/admin/backups',{method:'POST'});$('backup-action-status').textContent=result.pending?'فيه نسخة جاري تجهيزها. انتظر قليلًا.':'تم حفظ نسخة احتياطية جديدة.';await loadBackups();}
    catch{$('backup-action-status').textContent='تعذّر حفظ النسخة. طلباتك لم تتغيّر؛ أعد المحاولة.';}
    finally{$('create-backup').disabled=false;}
});
$('download-backup').addEventListener('click',async()=>{
    const id=$('backup-version').value;if(!id)return;$('download-backup').disabled=true;
    try {
        const data=await api('/api/admin/backups/'+encodeURIComponent(id));if(!authenticated)return;
        const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json;charset=utf-8'}));
        const link=document.createElement('a');link.href=url;link.download='MAK-orders-backup.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
        $('backup-action-status').textContent='تم تجهيز النسخة للتحميل. احتفظ بالملف في مكان خاص.';
    } catch {$('backup-action-status').textContent='تعذّر تنزيل النسخة. أعد المحاولة.';}
    finally{$('download-backup').disabled=false;}
});
$('preview-restore').addEventListener('click',async()=>{
    const id=$('backup-version').value;if(!id || restoring)return;$('preview-restore').disabled=true;
    try {
        const data=await api('/api/admin/backups/'+encodeURIComponent(id)+'/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'preview'})});
        restoreId=id;$('restore-description').textContent=`سيتم استرجاع ${data.missing.toLocaleString('ar-EG')} طلب مفقود. ${data.preserved.toLocaleString('ar-EG')} طلب موجود سيظل محفوظًا بتعديلاته الحالية.`;
        $('confirm-restore').disabled=!data.missing;$('restore-preview').hidden=false;
    } catch {$('backup-action-status').textContent='تعذّرت مراجعة النسخة. أعد المحاولة.';}
    finally{$('preview-restore').disabled=false;}
});
$('cancel-restore').addEventListener('click',()=>{if(!restoring){restoreId='';$('restore-preview').hidden=true;}});
$('backup-version').addEventListener('change',()=>{if(!restoring){restoreId='';$('restore-preview').hidden=true;}});
$('confirm-restore').addEventListener('click',async()=>{
    if(!restoreId || restoring)return;restoring=true;$('confirm-restore').disabled=true;$('cancel-restore').disabled=true;
    try {
        const data=await api('/api/admin/backups/'+encodeURIComponent(restoreId)+'/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'restore',confirm:restoreId})});
        $('backup-action-status').textContent=`تم استرجاع ${data.restored.toLocaleString('ar-EG')} طلب مفقود.`;restoreId='';$('restore-preview').hidden=true;await loadOrders();
    } catch {$('backup-action-status').textContent='تعذّر اكتمال الاسترجاع. أعد مراجعة النسخة لمعرفة الطلبات المتبقية.';}
    finally{restoring=false;$('confirm-restore').disabled=false;$('cancel-restore').disabled=false;}
});
$('test-email').addEventListener('click',async()=>{
    $('test-email').disabled=true;testEmailId ||= crypto.randomUUID();
    try{await api('/api/admin/notifications/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:testEmailId})});testEmailId='';$('test-email-status').textContent='خدمة البريد قبلت رسالة الاختبار. راجع الوارد والبريد غير المرغوب فيه.';}
    catch{$('test-email-status').textContent='تعذّر إرسال الاختبار. راجع ربط Resend وعنوان الإرسال.';}
    finally{$('test-email').disabled=false;}
});
$('retry-email').addEventListener('click',async()=>{
    $('retry-email').disabled=true;
    try{const result=await api('/api/admin/notifications/retry',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});await loadOrders();$('page-status').textContent=result.state==='queued'?'التنبيهات في انتظار إعادة الإرسال. راجع حالة الإيميل أمام الطلب.':'تمت إعادة محاولة الإرسال. راجع حالة الإيميل أمام الطلب.';}
    catch{$('page-status').textContent='تعذّرت إعادة المحاولة. راجع إعدادات إرسال الإيميل.';}
    finally{$('retry-email').disabled=false;}
});
$('signout').addEventListener('click',async event=>{
    if(djangoSession){
        event.preventDefault();
        try{
            const response=await fetch('/admin/logout',{method:'POST',headers:{'X-CSRFToken':csrfToken},cache:'no-store',signal:AbortSignal.timeout(15000)});
            if(!response.ok)throw new Error('Logout failed');
            lockDashboard();window.location.assign('/admin/login');
        }catch{$('page-status').textContent='تعذّر تسجيل الخروج. أعد المحاولة.';}
        return;
    }
    token='';authenticated=false;clearTimeout(pollTimer);
});
document.addEventListener('visibilitychange',()=>{clearTimeout(pollTimer);if(!document.hidden && authenticated)void loadOrders();});
window.addEventListener('online',()=>{if(authenticated && !document.hidden)void loadOrders();});
void startDashboard().catch(()=>lockDashboard());
