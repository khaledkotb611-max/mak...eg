const backupPrefix='orders/v1/';
const backupKey=id=>backupPrefix+id+'.json';
const validBackupId=id=>/^\d{13}-[0-9a-f-]{36}$/.test(id);
const hexDigest=async value=>Array.from(await digest(value),byte=>byte.toString(16).padStart(2,'0')).join('');

async function ensureBackup(env,force=false,round=0) {
    if(!env.BACKUPS)return null;
    const db=await database(env),now=Math.floor(Date.now()/1000);
    const state=await db.prepare(`UPDATE backup_state SET lease_until=? WHERE id=1 AND lease_until<=?
        AND (?=1 OR revision>saved_revision OR last_at='' OR julianday(last_at)<julianday('now','-1 day')) RETURNING *`).bind(now+120,now,force?1:0).first();
    if(!state)return null;
    try {
        const [quotes,admin,notifications,revision,events,products,items,meta]=await db.batch([
            db.prepare('SELECT * FROM quotes ORDER BY id'),db.prepare('SELECT * FROM quote_admin ORDER BY quote_id'),
            db.prepare('SELECT * FROM quote_notifications ORDER BY quote_id'),db.prepare('SELECT revision FROM backup_state WHERE id=1'),
            db.prepare('SELECT e.* FROM quote_events e JOIN quotes q ON q.id=e.quote_id ORDER BY e.quote_id,e.version'),
            db.prepare('SELECT * FROM products ORDER BY position,id'),db.prepare('SELECT * FROM quote_items ORDER BY quote_id,product_id'),db.prepare('SELECT imported_at FROM catalog_meta WHERE id=1')
        ]);
        const createdAt=new Date().toISOString(),savedRevision=revision.results[0].revision;
        const snapshot={format:'mak-orders-backup',version:1,createdAt,revision:savedRevision,tables:{quotes:quotes.results,quote_admin:admin.results,quote_notifications:notifications.results,quote_events:events.results,products:products.results,quote_items:items.results},catalog:{currency:'EGP',updatedAt:products.results.reduce((latest,p)=>p.updated_at>latest?p.updated_at:latest,meta.results[0].imported_at),products:products.results.filter(p=>!p.deleted_at).map(serializeProduct)}};
        const data=JSON.stringify(snapshot),sha256=await hexDigest(data);
        const id=String(9999999999999-Date.now()).padStart(13,'0')+'-'+crypto.randomUUID();
        await env.BACKUPS.put(backupKey(id),JSON.stringify({format:'mak-backup-envelope',sha256,data}),{
            httpMetadata:{contentType:'application/json'},customMetadata:{createdAt,quoteCount:String(quotes.results.length),revision:String(savedRevision),sha256}
        });
        // Mark the revision only after R2 has accepted the complete snapshot.
        await db.prepare("UPDATE backup_state SET saved_revision=?,last_id=?,last_at=?,last_error='',lease_until=0 WHERE id=1 AND lease_until=? AND saved_revision<=?").bind(savedRevision,id,createdAt,state.lease_until,savedRevision).run();
        await pruneBackups(env).catch(()=>{});
        const current=await db.prepare('SELECT revision FROM backup_state WHERE id=1').first();
        if(current.revision>savedRevision && round<4)await ensureBackup(env,false,round+1);
        return {id,createdAt,quoteCount:quotes.results.length,revision:savedRevision};
    } catch(error) {
        await db.prepare("UPDATE backup_state SET lease_until=0,last_error='backup_failed' WHERE id=1 AND lease_until=?").bind(state.lease_until).run();
        throw error;
    }
}

async function pruneBackups(env) {
    // Retain the most recent 30 complete versions; reverse timestamps sort newest first.
    let cursor;let kept=0;
    do {
        const page=await env.BACKUPS.list({prefix:backupPrefix,limit:1000,...(cursor?{cursor}:{})});
        const remove=page.objects.filter(()=>++kept>30).map(object=>object.key);
        if(remove.length)await env.BACKUPS.delete(remove);
        cursor=page.truncated?page.cursor:undefined;
    } while(cursor);
}

async function readBackup(env,id) {
    if(!validBackupId(id))throw new Error('Invalid backup');
    const object=await env.BACKUPS.get(backupKey(id));if(!object)throw new Error('Backup not found');
    if(object.size>64*1024*1024)throw new Error('Backup too large');
    const envelope=JSON.parse(await object.text());
    if(envelope.format!=='mak-backup-envelope' || typeof envelope.data!=='string' || await hexDigest(envelope.data)!==envelope.sha256)throw new Error('Backup checksum failed');
    const snapshot=JSON.parse(envelope.data);validateSnapshot(snapshot);
    return {snapshot,envelope};
}

function validateSnapshot(snapshot) {
    if(snapshot.format!=='mak-orders-backup' || snapshot.version!==1 || !snapshot.tables)throw new Error('Invalid backup');
    const {quotes,quote_admin:admin,quote_notifications:notifications}=snapshot.tables;
    if(![quotes,admin,notifications].every(Array.isArray))throw new Error('Invalid backup');
    const ids=new Set(),requests=new Set();
    for(const row of quotes) {
        if(!row || !['id','request_id','name','email','phone','project_type','message','created_at'].every(key=>typeof row[key]==='string') || !row.id || !row.request_id || ids.has(row.id) || requests.has(row.request_id))throw new Error('Invalid backup');
        ids.add(row.id);requests.add(row.request_id);
    }
    for(const row of admin)if(!row || !ids.has(row.quote_id) || !orderStatuses.includes(row.status) || typeof row.notes!=='string' || !Number.isInteger(row.version) || row.version<0 || typeof row.updated_at!=='string')throw new Error('Invalid backup');
    for(const row of notifications)if(!row || !ids.has(row.quote_id) || typeof row.state!=='string' || typeof row.provider_id!=='string')throw new Error('Invalid backup');
    const events=snapshot.tables.quote_events===undefined?[]:snapshot.tables.quote_events;
    const items=snapshot.tables.quote_items ?? [];
    if(!Array.isArray(items))throw new Error('Invalid order items');
    for(const item of items)if(!item || !ids.has(item.quote_id) || !['product_id','product_name','product_name_en'].every(key=>typeof item[key]==='string') || !Number.isInteger(item.quantity) || item.quantity<1 || item.quantity>9999 || typeof item.unit_price!=='number' || !Number.isFinite(item.unit_price) || item.unit_price<0 || !Number.isInteger(item.product_version))throw new Error('Invalid order items');
    if(!Array.isArray(events))throw new Error('Invalid history');
    for(const event of events)if(!event || !['id','quote_id','actor','previous_status','status','created_at'].every(key=>typeof event[key]==='string') || !ids.has(event.quote_id) || !Number.isInteger(event.version) || event.version<1 || ![0,1].includes(event.notes_changed) || !orderStatuses.includes(event.status) || !orderStatuses.includes(event.previous_status))throw new Error('Invalid history');
}

async function backupApi(request,env) {
    if(!await adminAuthorized(request,env))return json({error:'Admin authorization required'},401);
    if(!env.BACKUPS)return json({error:'Backup storage not configured'},503);
    const url=new URL(request.url);
    if(request.method==='POST' && request.headers.get('Origin') && request.headers.get('Origin')!==url.origin)return json({error:'Origin not allowed'},403);
    if(url.pathname==='/api/admin/backups') {
        if(request.method==='POST') {
            const backup=await ensureBackup(env,true);return json({ok:true,backup,pending:!backup},backup?201:202);
        }
        if(request.method!=='GET')return json({error:'Method not allowed'},405);
        let state=null;try{const db=await database(env);state=await db.prepare('SELECT * FROM backup_state WHERE id=1').first();}catch{}
        const page=await env.BACKUPS.list({prefix:backupPrefix,limit:30,include:['customMetadata']});
        return json({state,backups:page.objects.map(object=>({id:object.key.slice(backupPrefix.length,-5),createdAt:object.customMetadata?.createdAt || object.uploaded?.toISOString(),quoteCount:Number(object.customMetadata?.quoteCount || 0)})),retainedVersions:30});
    }
    const match=url.pathname.match(/^\/api\/admin\/backups\/([^/]+)(\/restore)?$/);
    if(!match || !validBackupId(match[1]))return json({error:'Not found'},404);
    let backup;try{backup=await readBackup(env,match[1]);}catch{return json({error:'Backup missing or invalid'},422);}
    if(!match[2]) {
        if(request.method!=='GET')return json({error:'Method not allowed'},405);
        return new Response(JSON.stringify(backup.envelope),{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="MAK-backup-${backup.snapshot.createdAt.slice(0,10)}.json"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    }
    const db=await database(env);
    if(request.method!=='POST')return json({error:'Method not allowed'},405);
    if(request.headers.get('Content-Type')?.split(';')[0]!=='application/json')return json({error:'JSON required'},415);
    let body;try{const text=await request.text();if(text.length>1000)throw new Error();body=JSON.parse(text);}catch{return json({error:'Invalid restore request'},400);}
    if(!['preview','restore'].includes(body.mode) || body.mode==='restore' && body.confirm!==match[1])return json({error:'Restore confirmation required'},400);
    const present=await db.prepare('SELECT id,request_id FROM quotes').all(),ids=new Set(present.results.map(row=>row.id)),requests=new Set(present.results.map(row=>row.request_id));
    const missing=backup.snapshot.tables.quotes.filter(row=>!ids.has(row.id) && !requests.has(row.request_id));
    if(body.mode==='preview')return json({missing:missing.length,preserved:backup.snapshot.tables.quotes.length-missing.length});
    const admin=new Map(backup.snapshot.tables.quote_admin.map(row=>[row.quote_id,row]));
    const notifications=new Map(backup.snapshot.tables.quote_notifications.map(row=>[row.quote_id,row]));
    for(let position=0;position<missing.length;position+=50) {
        const operations=[];
        for(const row of missing.slice(position,position+50)) {
            operations.push(db.prepare('INSERT OR IGNORE INTO quotes VALUES (?,?,?,?,?,?,?,?)').bind(row.id,row.request_id,row.name,row.email,row.phone,row.project_type,row.message,row.created_at));
            const notes=admin.get(row.id);
            if(notes)operations.push(db.prepare('INSERT OR IGNORE INTO quote_admin (quote_id,status,notes,version,updated_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM quotes WHERE id=?)').bind(row.id,notes.status,notes.notes,notes.version,notes.updated_at,row.id));
            const notice=notifications.get(row.id);
            // Restore historical email state without sending old orders again.
            operations.push(db.prepare("INSERT OR IGNORE INTO quote_notifications (quote_id,state,provider_id,error_code) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM quotes WHERE id=?)").bind(row.id,notice?.state==='submitted'?'submitted':'needs_review',notice?.provider_id || '',notice?.state==='submitted'?'':'restored_backup',row.id));
        }
        operations.push(db.prepare('UPDATE backup_state SET revision=revision+1 WHERE id=1'));
        await db.batch(operations);
    }
    // Completing missing history is repeatable after a partially interrupted restore.
    // Existing history wins; current notes/status are never replaced.
    const archivedRequests=new Map(backup.snapshot.tables.quotes.map(row=>[row.id,row.request_id]));
    const items=backup.snapshot.tables.quote_items || [];
    for(let position=0;position<items.length;position+=50){
        const operations=items.slice(position,position+50).map(item=>db.prepare('INSERT OR IGNORE INTO quote_items SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM quotes WHERE id=? AND request_id=?)').bind(item.quote_id,item.product_id,item.quantity,item.unit_price,item.product_name,item.product_name_en,item.product_version,item.quote_id,archivedRequests.get(item.quote_id)));
        operations.push(db.prepare('UPDATE backup_state SET revision=revision+1 WHERE id=1'));
        await db.batch(operations);
    }
    const history=backup.snapshot.tables.quote_events || [];
    for(let position=0;position<history.length;position+=50){
        const operations=history.slice(position,position+50).map(event=>db.prepare('INSERT OR IGNORE INTO quote_events (id,quote_id,version,actor,previous_status,status,notes_changed,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM quotes q JOIN quote_admin a ON a.quote_id=q.id WHERE q.id=? AND q.request_id=? AND a.version>=?)').bind(event.id,event.quote_id,event.version,event.actor,event.previous_status,event.status,event.notes_changed,event.created_at,event.quote_id,archivedRequests.get(event.quote_id),event.version));
        operations.push(db.prepare('UPDATE backup_state SET revision=revision+1 WHERE id=1'));
        await db.batch(operations);
    }
    await ensureBackup(env).catch(()=>{});
    return json({ok:true,restored:missing.length,preserved:backup.snapshot.tables.quotes.length-missing.length});
}

async function testNotification(request,env) {
    if(!await adminAuthorized(request,env))return json({error:'Admin authorization required'},401);
    if(request.method!=='POST')return json({error:'Method not allowed'},405);
    if(request.headers.get('Origin') && request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'Origin not allowed'},403);
    if(!notificationConfigured(env))return json({error:'Email not configured'},503);
    let body;try{const text=await request.text();if(text.length>1000)throw new Error();body=JSON.parse(text);}catch{return json({error:'Invalid test request'},400);}
    if(!/^[0-9a-f-]{36}$/.test(body?.requestId || ''))return json({error:'Invalid test request'},400);
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`mak-test-${body.requestId}`},body:JSON.stringify({from:env.NOTIFICATION_FROM,to:[env.NOTIFICATION_TO],subject:'اختبار تنبيهات الطلبات — MAK',text:`دي رسالة اختبار من لوحة طلبات MAK.\nالتنبيهات مُجهزة للإرسال إلى ${env.NOTIFICATION_TO}.\n${env.SITE_ORIGIN || ''}/admin`}),signal:AbortSignal.timeout(10000)});
    const result=await response.json();
    return response.ok && result && typeof result.id==='string' && result.id?json({ok:true,state:'submitted'}):json({error:'Email provider rejected test'},502);
}
