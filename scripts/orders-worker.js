const orderStatuses = ["new", "contacted", "fulfilled"];
const orderSelect = `SELECT q.*, COALESCE(a.status, 'new') AS status, COALESCE(a.notes, '') AS notes,
    COALESCE(a.version, 0) AS version, COALESCE(a.updated_at, q.created_at) AS updated_at,
    COALESCE(n.state, 'not_requested') AS notification_state, COALESCE(n.error_code, '') AS notification_error
    FROM quotes q LEFT JOIN quote_admin a ON a.quote_id = q.id LEFT JOIN quote_notifications n ON n.quote_id = q.id`;

function signedInAdmin(request, env) {
    const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
    const id = request.headers.get("oai-authenticated-user-id");
    return !!id && !!email && (env.ADMIN_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean).includes(email);
}

function managedOrder(row) {
    return { ...serialize(row), status: row.status, notes: row.notes, version: row.version,
        updatedAt: row.updated_at, notification: { state: row.notification_state, error: row.notification_error } };
}

function notificationConfigured(env) { return !!(env.RESEND_API_KEY && env.NOTIFICATION_FROM && env.NOTIFICATION_TO); }

async function listOrders(request, env) {
    if (!await adminAuthorized(request, env)) return json({ error: "Admin authorization required" }, 401);
    const db = await database(env);
    const params = new URL(request.url).searchParams;
    // Preserve the original API shape for existing consumers; the dashboard opts into paging.
    if (!params.has("limit")) {
        const { results } = await db.prepare(`${orderSelect} ORDER BY q.created_at DESC, q.id DESC LIMIT 100`).all();
        return json({ quotes: await attachOrderItems(db,results.map(managedOrder)) });
    }
    const limit = Math.min(100, Math.max(1, Number.parseInt(params.get("limit"),10) || 30));
    const offset = Math.min(1000000, Math.max(0, Number.parseInt(params.get("offset"),10) || 0));
    const status = params.get("status") || "";
    if (status && !orderStatuses.includes(status)) return json({ error: "Invalid status" }, 400);
    const q = (params.get("q") || "").trim().slice(0,160);
    const createdFrom=params.get('createdFrom') || '',createdBefore=params.get('createdBefore') || '';
    const validDate=value=>!value || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).getUTCFullYear()>0 && new Date(value).toISOString()===value;
    if(!validDate(createdFrom) || !validDate(createdBefore) || createdFrom && createdBefore && createdFrom>=createdBefore)return json({error:'Invalid date range'},400);
    const conditions = []; const values = [];
    if (status) { conditions.push("COALESCE(a.status, 'new') = ?"); values.push(status); }
    if(createdFrom){conditions.push('julianday(q.created_at) >= julianday(?)');values.push(createdFrom);}
    if(createdBefore){conditions.push('julianday(q.created_at) < julianday(?)');values.push(createdBefore);}
    if (q) {
        conditions.push("(q.name LIKE ? OR q.email LIKE ? OR q.phone LIKE ? OR q.message LIKE ? OR q.id LIKE ?)");
        for(let i=0;i<5;i++)values.push(`%${q}%`);
    }
    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    const [rows, filtered, summary] = await db.batch([
        db.prepare(`${orderSelect}${where} ORDER BY q.created_at DESC, q.id DESC LIMIT ? OFFSET ?`).bind(...values,limit,offset),
        db.prepare(`SELECT COUNT(*) AS total FROM quotes q LEFT JOIN quote_admin a ON a.quote_id = q.id${where}`).bind(...values),
        db.prepare(`SELECT COUNT(*) AS total,
            SUM(CASE WHEN COALESCE(a.status, 'new') = 'new' THEN 1 ELSE 0 END) AS new,
            SUM(CASE WHEN a.status = 'contacted' THEN 1 ELSE 0 END) AS contacted,
            SUM(CASE WHEN a.status = 'fulfilled' THEN 1 ELSE 0 END) AS fulfilled
            FROM quotes q LEFT JOIN quote_admin a ON a.quote_id = q.id`)
    ]);
    return json({ quotes: await attachOrderItems(db,rows.results.map(managedOrder)), total: filtered.results[0].total, summary: summary.results[0], limit, offset,
        notificationSettings: { configured: notificationConfigured(env), recipient: env.NOTIFICATION_TO || "", from: env.NOTIFICATION_FROM || "" } });
}

async function updateOrder(request, env, id, ctx) {
    if (!await adminAuthorized(request, env)) return json({ error: "Admin authorization required" }, 401);
    if (request.method !== "PATCH") return json({ error: "Method not allowed" }, 405);
    if (request.headers.get("Origin") && request.headers.get("Origin") !== new URL(request.url).origin) return json({ error: "Origin not allowed" }, 403);
    if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json") return json({ error: "JSON required" }, 415);
    let body;
    try { const text=await request.text(); if(text.length>10000)return json({error:"Body too large"},413);body=JSON.parse(text); } catch { return json({error:"Invalid update"},400); }
    if (!body || !orderStatuses.includes(body.status) || typeof body.notes !== "string" || [...body.notes].length > 4000 || !Number.isInteger(body.version) || body.version < 0 || body.version>=2147483647) return json({ error: "Invalid update" }, 400);
    const db = await database(env);
    if (!await db.prepare("SELECT id FROM quotes WHERE id = ?").bind(id).first()) return json({error:"Not found"},404);
    const now = new Date().toISOString();
    const eventId=crypto.randomUUID();
    const actor=signedInAdmin(request,env)?request.headers.get('oai-authenticated-user-email').trim().toLowerCase():'server-api';
    const results = await db.batch([
        db.prepare("INSERT OR IGNORE INTO quote_admin (quote_id, updated_at) VALUES (?, ?)").bind(id,now),
        db.prepare('INSERT INTO quote_events (id,quote_id,version,actor,previous_status,status,notes_changed,created_at) SELECT ?,quote_id,version+1,?,status,?,CASE WHEN notes!=? THEN 1 ELSE 0 END,? FROM quote_admin WHERE quote_id=? AND version=?').bind(eventId,actor,body.status,body.notes,now,id,body.version),
        db.prepare("UPDATE quote_admin SET status=?, notes=?, version=version+1, updated_at=? WHERE quote_id=? AND version=? RETURNING quote_id").bind(body.status,body.notes,now,id,body.version),
        db.prepare('UPDATE backup_state SET revision=revision+1 WHERE id=1 AND EXISTS (SELECT 1 FROM quote_events WHERE id=?)').bind(eventId)
    ]);
    if (!results[2].results.length) return json({error:"Order changed; refresh before saving"},409);
    const saved = await db.prepare(`${orderSelect} WHERE q.id = ?`).bind(id).first();
    if (saved.version !== body.version + 1 || saved.status !== body.status || saved.notes !== body.notes) return json({error:"Order changed; refresh before saving"},409);
    const backup=ensureBackup(env).catch(()=>{});if(ctx?.waitUntil)ctx.waitUntil(backup);else await backup;
    return json({ quote: {...managedOrder(saved),items:await savedOrderItems(db,id)} });
}

async function finishNotification(db,claimed,state,error='',providerId='',nextAttempt=0) {
    await db.batch([
        db.prepare("UPDATE backup_state SET revision=revision+1 WHERE id=1 AND EXISTS (SELECT 1 FROM quote_notifications WHERE quote_id=? AND state='sending' AND locked_until=?)").bind(claimed.quote_id,claimed.locked_until),
        db.prepare("UPDATE quote_notifications SET state=?,error_code=?,provider_id=?,next_attempt=?,locked_until=0 WHERE quote_id=? AND state='sending' AND locked_until=?").bind(state,error,providerId,nextAttempt,claimed.quote_id,claimed.locked_until)
    ]);
}

async function deliverNotification(env, quoteId) {
    const db = await database(env);
    if (!notificationConfigured(env)) {
        await db.prepare("UPDATE quote_notifications SET state = 'blocked', error_code = 'not_configured' WHERE quote_id = ? AND state IN ('pending','failed','blocked')").bind(quoteId).run();
        return;
    }
    const now = Math.floor(Date.now()/1000);
    const claimed = await db.prepare(`UPDATE quote_notifications SET state='sending', locked_until=?, attempts=attempts+1, first_attempt=CASE WHEN first_attempt=0 THEN ? ELSE first_attempt END
        WHERE quote_id=? AND state IN ('pending','failed','blocked','sending') AND locked_until <= ? AND next_attempt <= ? RETURNING *`).bind(now+60,now,quoteId,now,now).first();
    if (!claimed) return;
    // Resend retains idempotency keys for 24 hours; ambiguous old attempts need review.
    if (now - claimed.first_attempt > 23*3600) {
        await finishNotification(db,claimed,'needs_review','retry_window_expired');
        return;
    }
    const quote = await db.prepare("SELECT * FROM quotes WHERE id = ?").bind(quoteId).first();
    if (!quote) {await finishNotification(db,claimed,'needs_review','order_missing');return;}
    let payload = claimed.payload;
    if (!payload) {
        const items=await savedOrderItems(db,quoteId);
        const prices=items.map(item=>`${item.name} — ${item.quantity} × ${item.unitPrice.toFixed(2)} ج.م = ${item.total.toFixed(2)} ج.م`).join('\n');
        payload = JSON.stringify({ from: env.NOTIFICATION_FROM, to: [env.NOTIFICATION_TO], subject: `طلب جديد من MAK — ${quote.id.slice(0,8)}`,
            text: `وصل طلب جديد إلى MAK\n\nرقم الطلب: ${quote.id}\nالاسم: ${quote.name}\nالموبايل: ${quote.phone || 'غير مضاف'}\nالإيميل: ${quote.email || 'غير مضاف'}\nنوع الطلب: ${quote.project_type}\nالتفاصيل:\n${quote.message}\n\nمتابعة الطلب: ${env.SITE_ORIGIN || ''}/admin${prices?'\n\nأسعار المنتجات المحفوظة مع الطلب:\n'+prices:''}`,
            ...(quote.email ? { reply_to: quote.email } : {}) });
        await db.prepare("UPDATE quote_notifications SET payload=? WHERE quote_id=?").bind(payload,quoteId).run();
    }
    let state='failed',code='network_error',delay=Math.min(3600,60*2**Math.min(claimed.attempts,6));
    try {
        const response = await fetch("https://api.resend.com/emails", { method:"POST", headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,"Content-Type":"application/json","Idempotency-Key":`mak-quote-${quoteId}`},body:payload,signal:AbortSignal.timeout(10000) });
        const result = await response.json().catch(()=>null);
        if (!response.ok) {
            code=`provider_${response.status}`;
            const name=result?.name || '';
            state=response.status===409 && name!=='concurrent_idempotent_requests'?'needs_review':response.status===429 && ['daily_quota_exceeded','monthly_quota_exceeded'].includes(name)?'action_required':[408,409,429].includes(response.status) || response.status>=500?'failed':'action_required';
            const retry=response.headers.get('Retry-After');
            if(retry){const seconds=/^\d+(\.\d+)?$/.test(retry)?Number(retry):(Date.parse(retry)-Date.now())/1000;if(Number.isFinite(seconds) && seconds>=0 && seconds<=86400)delay=Math.max(delay,Math.ceil(seconds));}
            throw new Error('Provider rejected request');
        }
        if (!result || typeof result.id !== "string" || !result.id) throw new Error('Invalid response');
        await finishNotification(db,claimed,'submitted','',result.id);
    } catch {
        await finishNotification(db,claimed,state,code,'',Math.floor(Date.now()/1000)+delay);
    }
}

async function flushNotifications(env) {
    if (!notificationConfigured(env)) return;
    const db=await database(env);const now=Math.floor(Date.now()/1000);
    const {results}=await db.prepare("SELECT quote_id FROM quote_notifications WHERE state IN ('pending','failed','blocked','sending') AND locked_until <= ? AND next_attempt <= ? ORDER BY rowid LIMIT 5").bind(now,now).all();
    for(const row of results)await deliverNotification(env,row.quote_id);
}

async function adminSession(request, env) {
    if (!await adminAuthorized(request,env))return json({error:"Admin authorization required"},401);
    return json({ok:true,email:signedInAdmin(request,env)?request.headers.get('oai-authenticated-user-email'):""});
}

async function orderHistory(request,env,id) {
    if(!await adminAuthorized(request,env))return json({error:'Admin authorization required'},401);
    if(request.method!=='GET')return json({error:'Method not allowed'},405);
    const db=await database(env);
    if(!await db.prepare('SELECT 1 FROM quotes WHERE id=?').bind(id).first())return json({error:'Not found'},404);
    const before=new URL(request.url).searchParams.get('before') || '';
    if(before && !/^\d{1,10}$/.test(before))return json({error:'Invalid history cursor'},400);
    const {results}=await db.prepare('SELECT * FROM quote_events WHERE quote_id=? AND version<? ORDER BY version DESC LIMIT 31').bind(id,before?Number(before):2147483648).all();
    const events=results.slice(0,30).map(row=>({id:row.id,version:row.version,actor:row.actor,previousStatus:row.previous_status,status:row.status,notesChanged:!!row.notes_changed,createdAt:row.created_at}));
    return json({events,nextBefore:results.length>30?events.at(-1).version:null});
}

async function adminHealth(request,env) {
    if(!await adminAuthorized(request,env))return json({error:'Admin authorization required'},401);
    if(request.method!=='GET')return json({error:'Method not allowed'},405);
    const db=await database(env);
    const [counts,oldest,backup]=await db.batch([
        db.prepare('SELECT state,COUNT(*) AS count FROM quote_notifications GROUP BY state'),
        db.prepare("SELECT MIN(q.created_at) AS oldest FROM quotes q JOIN quote_notifications n ON q.id=n.quote_id WHERE n.state IN ('pending','failed','sending')"),
        db.prepare('SELECT * FROM backup_state WHERE id=1')
    ]);
    return json({notifications:{configured:notificationConfigured(env),counts:Object.fromEntries(counts.results.map(row=>[row.state,row.count])),oldestPending:oldest.results[0].oldest},
        worker:{mode:'traffic',state:'on_request'},backup:backup.results[0] || null});
}
