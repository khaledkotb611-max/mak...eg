// Build embeds public assets and the one-time migration seed. Runtime reads only the database.
const fieldNames = ["name", "email", "phone", "projectType", "message"];
const fieldLimits = [120, 160, 40, 80, 2000];
const publicSiteOrigin = "https://khaledkotb611-max.github.io";

function publicCorsRoute(pathname, method) {
    const isProductRead = ["/api/catalog", "/api/products"].includes(pathname) || /^\/api\/products\/[a-z0-9][a-z0-9-]{0,119}$/.test(pathname);
    return method === "GET" && isProductRead || method === "POST" && pathname === "/api/quotes";
}

function withPublicCors(request, response) {
    if (request.headers.get("Origin") !== publicSiteOrigin) return response;
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", publicSiteOrigin);
    headers.set("Access-Control-Expose-Headers", "ETag");
    headers.set("Vary", headers.has("Vary") ? `${headers.get("Vary")}, Origin` : "Origin");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function publicCorsPreflight(method) {
    return new Response(null, { status: 204, headers: {
        "Access-Control-Allow-Origin": publicSiteOrigin,
        "Access-Control-Allow-Methods": `${method}, OPTIONS`,
        "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
        "Access-Control-Max-Age": "600",
        "Vary": "Origin"
    } });
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...(status === 429 ? { "Retry-After": "600" } : {}) }
});

async function database(env) {
    if (!env.DB) throw new Error("Storage unavailable");
    // Sites applies the versioned migrations before publishing this Worker.
    await env.DB.prepare('INSERT OR IGNORE INTO backup_state (id) VALUES (1)').run();
    await seedCatalog(env.DB);
    return env.DB;
}

async function digest(value) {
    return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function adminAuthorized(request, env) {
    if (signedInAdmin(request, env)) return true;
    if (!env.ADMIN_TOKEN) return false;
    const [actual, expected] = await Promise.all([digest(request.headers.get("Authorization") || ""), digest(`Bearer ${env.ADMIN_TOKEN}`)]);
    let difference = 0;
    for (let i = 0; i < expected.length; i++) difference |= actual[i] ^ expected[i];
    return difference === 0;
}

function serialize(row) {
    return { id: row.id, name: row.name, email: row.email, phone: row.phone, projectType: row.project_type, message: row.message, createdAt: row.created_at };
}

async function quoteBody(request) {
    const reader = request.body?.getReader();
    if (!reader) return null;
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 16384) {
                await reader.cancel();
                return { tooLarge: true };
            }
            chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        if (!body || typeof body !== "object" || Array.isArray(body)) return null;
        const fields = {};
        for (let i = 0; i < fieldNames.length; i++) {
            const key = fieldNames[i];
            const value = body[key] ?? "";
            if (typeof value !== "string" || [...value.trim()].length > fieldLimits[i]) return null;
            fields[key] = value.trim();
        }
        if (!fields.name || !fields.projectType || !fields.message || (!fields.email && !fields.phone)) return null;
        if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) return null;
        if (fields.phone && !/^[+\d\s().-]{7,40}$/.test(fields.phone)) return null;
        if (typeof body.requestId !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.requestId)) return null;
        fields.requestId = body.requestId.toLowerCase();
        fields.items=validateItems(body);
        return fields;
    } catch { return null; }
    finally { reader.releaseLock(); }
}

async function handleQuotes(request, env, ctx) {
    if (request.method === "GET") return listOrders(request,env);
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") return json({ error: "JSON content type required" }, 415);
    const fields = await quoteBody(request);
    if (fields?.tooLarge) return json({ error: "Request body is too large" }, 413);
    if (!fields) return json({ error: "Invalid quote request" }, 400);
    const db = await database(env);
    const existing = await db.prepare("SELECT * FROM quotes WHERE request_id = ?").bind(fields.requestId).first();
    const receipt = async (row, status) => {
        if(!row)return json({error:'Product unavailable',code:'product_unavailable'},409);
        const saved = serialize(row);
        if (fieldNames.some((key) => saved[key] !== fields[key])) return json({ error: "Request ID already used" }, 409);
        const items=await savedOrderItems(db,row.id);
        if(JSON.stringify(items.map(({productId,quantity})=>({productId,quantity})))!==JSON.stringify(fields.items))return json({error:'Request ID already used'},409);
        return json({ ok: true, quoteId: saved.id,...(items.length?{items,currency:'EGP'}:{}) }, status);
    };
    if (existing) return receipt(existing, 200);
    const now = Math.floor(Date.now() / 1000);
    const clientKey = Array.from(await digest(request.headers.get("CF-Connecting-IP") || "unknown"), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const [, rate] = await db.batch([
        db.prepare("DELETE FROM quote_rate_limits WHERE window_start <= ?").bind(now - 600),
        db.prepare(`INSERT INTO quote_rate_limits (client_key, window_start, attempts) VALUES (?, ?, 1)
            ON CONFLICT(client_key) DO UPDATE SET
            attempts = CASE WHEN quote_rate_limits.window_start <= ? THEN 1 ELSE quote_rate_limits.attempts + 1 END,
            window_start = CASE WHEN quote_rate_limits.window_start <= ? THEN excluded.window_start ELSE quote_rate_limits.window_start END
            RETURNING attempts`).bind(clientKey, now, now - 600, now - 600)
    ]);
    if (rate.results[0].attempts > 5) return json({ error: "Too many quote requests" }, 429);
    const id=crypto.randomUUID();
    await db.batch([
        db.prepare("INSERT OR IGNORE INTO quotes SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM json_each(?) i LEFT JOIN products p ON p.id=json_extract(i.value,'$.productId') WHERE p.id IS NULL OR p.active!=1 OR p.deleted_at!='')").bind(id,fields.requestId,fields.name,fields.email,fields.phone,fields.projectType,fields.message,new Date().toISOString(),JSON.stringify(fields.items)),
        db.prepare("INSERT INTO quote_items SELECT ?,p.id,json_extract(i.value,'$.quantity'),p.price,p.name,p.name_en,p.version FROM json_each(?) i JOIN products p ON p.id=json_extract(i.value,'$.productId') WHERE EXISTS (SELECT 1 FROM quotes WHERE id=?)").bind(id,JSON.stringify(fields.items),id),
        db.prepare("INSERT OR IGNORE INTO quote_notifications (quote_id) SELECT id FROM quotes WHERE request_id=?").bind(fields.requestId),
        db.prepare('UPDATE backup_state SET revision=revision+1 WHERE id=1 AND EXISTS (SELECT 1 FROM quotes WHERE id=?)').bind(id)
    ]);
    const saved = await db.prepare("SELECT * FROM quotes WHERE request_id = ?").bind(fields.requestId).first();
    if(!saved)return json({error:'Product unavailable',code:'product_unavailable'},409);
    const maintain=async()=>{await deliverNotification(env,saved.id).catch(()=>{});await ensureBackup(env).catch(()=>{});};
    if (ctx?.waitUntil) ctx.waitUntil(maintain());
    else await maintain();
    return receipt(saved, 201);
}

const decodedAssets = new Map();
function readAsset(pathname) {
    if (decodedAssets.has(pathname)) return decodedAssets.get(pathname);
    const asset = assets[pathname];
    if (!asset) return null;
    const binary = atob(asset.body);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const decoded = { bytes, contentType: asset.contentType };
    decodedAssets.set(pathname, decoded);
    return decoded;
}

export default {
    async scheduled(_controller, env) {
        // Keep delivery and backups moving when the hosted platform enables
        // a Cron Trigger, even if the site receives no visitor traffic.
        const results = await Promise.allSettled([
            flushNotifications(env),
            ensureBackup(env)
        ]);
        if (results.some((result) => result.status === "rejected")) {
            throw new Error("Scheduled backend maintenance failed");
        }
    },
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        if (ctx?.waitUntil && !(url.pathname === "/api/quotes" && request.method === "POST")) ctx.waitUntil((async()=>{await flushNotifications(env).catch(()=>{});await ensureBackup(env).catch(()=>{});})());
        if (url.pathname.startsWith("/api/")) {
            const origin = request.headers.get("Origin");
            const crossOrigin = origin && origin !== url.origin;
            if (crossOrigin) {
                const requestedMethod = request.headers.get("Access-Control-Request-Method") || "";
                const requestedHeaders = (request.headers.get("Access-Control-Request-Headers") || "").toLowerCase().split(",").map(value => value.trim()).filter(Boolean);
                const allowedHeaders = new Set(["content-type", "if-none-match"]);
                const preflightAllowed = origin === publicSiteOrigin && request.method === "OPTIONS"
                    && publicCorsRoute(url.pathname, requestedMethod)
                    && requestedHeaders.every(header => allowedHeaders.has(header));
                if (preflightAllowed) return publicCorsPreflight(requestedMethod);
                if (origin !== publicSiteOrigin || !publicCorsRoute(url.pathname, request.method)) return json({ error: "Origin not allowed" }, 403);
            }
            const cors = (response) => crossOrigin ? withPublicCors(request, response) : response;
            try {
                if (url.pathname === "/api/quotes") return cors(await handleQuotes(request, env, ctx));
                if (["/api/catalog","/api/products"].includes(url.pathname))return cors(await catalogApi(request,env));
                const productMatch=url.pathname.match(/^\/api\/products\/([a-z0-9][a-z0-9-]{0,119})$/);
                if(productMatch)return cors(await catalogApi(request,env,productMatch[1]));
                if (url.pathname === "/api/admin/session" && request.method === "GET") return await adminSession(request,env);
                if (url.pathname === '/api/admin/health') return await adminHealth(request,env);
                const historyMatch=url.pathname.match(/^\/api\/quotes\/([0-9a-f-]{36})\/history$/i);
                if(historyMatch)return await orderHistory(request,env,historyMatch[1]);
                if(url.pathname.startsWith('/api/admin/backups'))return await backupApi(request,env);
                if(url.pathname==='/api/admin/notifications/test')return await testNotification(request,env);
                const match=url.pathname.match(/^\/api\/quotes\/([0-9a-f-]{36})$/i);
                if(match) return await updateOrder(request,env,match[1],ctx);
                if (url.pathname === "/api/admin/notifications/retry") {
                    if (!await adminAuthorized(request,env))return json({error:"Admin authorization required"},401);
                    if(request.method!=="POST")return json({error:"Method not allowed"},405);
                    if(request.headers.get("Origin") && request.headers.get("Origin")!==url.origin)return json({error:"Origin not allowed"},403);
                    if(!notificationConfigured(env))return json({error:"Email not configured"},503);
                    const db=await database(env);
                    await db.prepare("UPDATE quote_notifications SET state='failed',next_attempt=CASE WHEN error_code IN ('provider_429','provider_409') THEN next_attempt ELSE 0 END WHERE state IN ('failed','blocked','action_required')").run();
                    const retry=flushNotifications(env).catch(()=>{});
                    if(ctx?.waitUntil)ctx.waitUntil(retry);else await retry;
                    return json({ok:true,state:'queued'});
                }
                if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
                if (url.pathname === "/api/health") { await database(env); return json({ ok: true, service: "mak-backend", storage: "ready" }); }
                return cors(json({ error: "Not found" }, 404));
            } catch { return cors(json({ error: "Storage unavailable. Retry later." }, 503)); }
        }
        if (!["GET", "HEAD"].includes(request.method)) return json({ error: "Method not allowed" }, 405);
        let pathname = url.pathname;
        if (["/admin","/admin/","/admin.html"].includes(pathname)) {
            if (!request.headers.get("oai-authenticated-user-id") || !request.headers.get("oai-authenticated-user-email")) return new Response(null,{status:302,headers:{Location:"/signin-with-chatgpt?return_to=%2Fadmin","Cache-Control":"no-store"}});
            if(!signedInAdmin(request,env))return new Response("هذا الحساب لا يملك صلاحية متابعة الطلبات.",{status:403,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}});
            pathname="/admin.html";
        }
        if (pathname === "/") pathname = "/index.html";
        if (pathname === "/products" || pathname === "/products/") pathname = "/products.html";
        if (pathname.startsWith("/product/")) {
            let id;
            try { id = decodeURIComponent(pathname.slice("/product/".length)); } catch { return new Response("", { status: 404 }); }
            try {
                const db=await database(env);
                if(!await db.prepare("SELECT 1 FROM products WHERE id=? AND active=1 AND deleted_at=''").bind(id).first())return new Response('',{status:404});
            }catch{return json({error:'Catalog unavailable'},503);}
            pathname = "/product.html";
        }
        const asset = readAsset(pathname);
        if (!asset) return new Response("", { status: 404 });
        const headers = {
            "Content-Type": asset.contentType,
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "strict-origin-when-cross-origin",
            "X-Frame-Options": "SAMEORIGIN",
            "Cache-Control": pathname === "/admin.html" ? "no-store" : "no-cache, max-age=0, must-revalidate"
        };
        return new Response(request.method === "HEAD" ? null : asset.bytes, { headers });
    }
};
