// Same database schema, validation and response contract as mak_backend/catalog.py.
const productColumns=['id','name','description','name_en','description_en','category','price','image','details_ar','details_en','active','created_at','updated_at','position','version','deleted_at'];
function validateProduct(body) {
    if(!body || typeof body!=='object' || Array.isArray(body) || typeof body.id!=='string' || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(body.id))throw new Error('Invalid ID');
    if(!['pipes','fittings','poly'].includes(body.category) || typeof (Object.hasOwn(body,'active')?body.active:true)!=='boolean')throw new Error('Invalid category or availability');
    if(typeof body.price!=='number' || !Number.isFinite(body.price) || body.price<0 || body.price>9999999999.99 || Number(body.price.toFixed(2))!==body.price)throw new Error('Invalid price');
    const image=Object.hasOwn(body,'image')?body.image:'';
    if(typeof image!=='string' || image.length>1000 || image && !/^(\/images\/[A-Za-z0-9_.-]+|https:\/\/[^\s<>"']+)$/.test(image))throw new Error('Invalid image');
    if(image.startsWith('https://')){const url=new URL(image);if(!url.hostname || url.username || url.password)throw new Error('Invalid image');}
    const product={id:body.id,category:body.category,price:body.price,image,active:Object.hasOwn(body,'active')?body.active:true};
    for(const lang of ['ar','en']) {
        const local=body[lang];if(!local || typeof local!=='object' || Array.isArray(local))throw new Error('Both languages required');
        product[lang]={};
        for(const [key,limit] of [['name',200],['description',3000],['category',120],['size',120],['spec',250],['unit',80]]) {
            const value=Object.hasOwn(local,key)?local[key]:'';
            if(typeof value!=='string' || [...value.trim()].length>limit || key==='name' && !value.trim())throw new Error('Invalid product text');
            product[lang][key]=value.trim();
        }
        if(Object.hasOwn(local,'finish')){if(typeof local.finish!=='string' || [...local.finish.trim()].length>120)throw new Error('Invalid finish');product[lang].finish=local.finish.trim();}
    }
    return product;
}

function productValues(p,now,position=0) {
    const details=lang=>JSON.stringify(Object.fromEntries(Object.entries(p[lang]).filter(([key])=>!['name','description'].includes(key))));
    return [p.id,p.ar.name,p.ar.description,p.en.name,p.en.description,p.category,p.price,p.image,details('ar'),details('en'),p.active?1:0,now,now,position,0,''];
}

async function seedCatalog(db) {
    if(await db.prepare("SELECT name FROM app_migrations WHERE name='catalog_seed_v1'").first())return;
    // One transaction, including the marker. Parallel requests cannot seed again or overwrite an edit.
    const now=catalogSeed.updatedAt+'T00:00:00.000Z';
    const rows=catalogSeed.products.map((p,index)=>productValues(validateProduct(p),now,index));
    await db.batch([
        db.prepare(`INSERT OR IGNORE INTO products (${productColumns.join(',')}) SELECT ${productColumns.map((_,i)=>`json_extract(value,'$[${i}]')`).join(',')} FROM json_each(?) WHERE NOT EXISTS (SELECT 1 FROM app_migrations WHERE name='catalog_seed_v1')`).bind(JSON.stringify(rows)),
        db.prepare('INSERT OR IGNORE INTO catalog_meta VALUES (1,?)').bind(catalogSeed.updatedAt),
        db.prepare("INSERT OR IGNORE INTO app_migrations (name) VALUES ('catalog_seed_v1')")
    ]);
}

function serializeProduct(row) {
    return {id:row.id,category:row.category,price:Number(row.price),image:row.image,
        ar:{...JSON.parse(row.details_ar),name:row.name,description:row.description},en:{...JSON.parse(row.details_en),name:row.name_en,description:row.description_en},
        active:!!row.active,createdAt:row.created_at,updatedAt:row.updated_at,version:row.version};
}

async function readCatalog(db,includeInactive=false) {
    const [rows,latest,meta]=await db.batch([
        db.prepare("SELECT * FROM products WHERE deleted_at=''"+(includeInactive?'':' AND active=1')+' ORDER BY position,id'),
        db.prepare('SELECT MAX(updated_at) AS latest FROM products'),db.prepare('SELECT imported_at FROM catalog_meta WHERE id=1')
    ]);
    return {currency:'EGP',updatedAt:latest.results[0].latest || meta.results[0].imported_at,products:rows.results.map(serializeProduct)};
}

async function catalogApi(request,env,id=null) {
    const url=new URL(request.url),method=request.method;
    if(method==='GET') {
        const includeInactive=url.searchParams.get('includeInactive')==='1';
        if(includeInactive && !await adminAuthorized(request,env))return json({error:'Admin authorization required'},401);
        const db=await database(env);
        if(id) {
            const row=await db.prepare("SELECT * FROM products WHERE id=? AND deleted_at=''").bind(id).first();
            if(!row || !row.active && !await adminAuthorized(request,env))return json({error:'Not found'},404);
            return json({product:serializeProduct(row)});
        }
        const catalog=await readCatalog(db,includeInactive),etag='"'+await hexDigest(JSON.stringify(catalog))+'"';
        const headers={'ETag':etag,'Cache-Control':'private, no-cache, must-revalidate','X-Content-Type-Options':'nosniff'};
        if(request.headers.get('If-None-Match')===etag)return new Response(null,{status:304,headers});
        const response=json(catalog);for(const [key,value] of Object.entries(headers))response.headers.set(key,value);return response;
    }
    if(url.pathname==='/api/catalog')return json({error:'Method not allowed'},405);
    if(!await adminAuthorized(request,env))return json({error:'Admin authorization required'},401);
    if(!(id?['PATCH','PUT','DELETE']:['POST']).includes(method))return json({error:'Method not allowed'},405);
    if(request.headers.get('Origin') && request.headers.get('Origin')!==url.origin)return json({error:'Origin not allowed'},403);
    if(request.headers.get('Content-Type')?.split(';')[0]!=='application/json')return json({error:'JSON required'},415);
    let body;try{const text=await request.text();if(new TextEncoder().encode(text).length>24000)return json({error:'Body too large'},413);body=JSON.parse(text);if(!body || typeof body!=='object' || Array.isArray(body))throw new Error();}catch{return json({error:'Invalid product'},400);}
    const db=await database(env),old=await db.prepare('SELECT * FROM products WHERE id=?').bind(id || (typeof body.id==='string'?body.id:'')).first();
    if(id) {
        if(!old)return json({error:'Not found'},404);
        if(!Number.isInteger(body.version) || body.version<0 || body.version>=2147483647)return json({error:'Version required'},400);
        if(old.deleted_at)return method==='DELETE' && old.version===body.version+1?json({ok:true}):json({error:'Not found'},404);
        if(method==='DELETE') {
            const now=new Date().toISOString();
            const result=await db.prepare("UPDATE products SET active=0,deleted_at=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND deleted_at='' RETURNING id").bind(now,now,id,body.version).first();
            return result?json({ok:true}):json({error:'Product changed; reload before deleting'},409);
        }
        if(body.id!==undefined && body.id!==id)return json({error:'ID cannot change'},400);
    }
    let product;
    try {
        const merged=id && method==='PATCH'?{...serializeProduct(old),...body,id}:{...body,id:id || body.id};
        if(id && method==='PATCH')for(const lang of ['ar','en'])if(body[lang]!==undefined){if(!body[lang] || typeof body[lang]!=='object' || Array.isArray(body[lang]))throw new Error();merged[lang]={...serializeProduct(old)[lang],...body[lang]};}
        product=validateProduct(merged);
    }catch{return json({error:'Invalid product or price'},400);}
    const same=old && JSON.stringify(validateProduct(serializeProduct(old)))===JSON.stringify(product);
    if(id && old.version!==body.version)return old.version===body.version+1 && same?json({product:serializeProduct(old)}):json({error:'Product changed; reload before saving'},409);
    const now=new Date().toISOString();
    if(id) {
        const values=productValues(product,now,old.position);
        const fields=[...productColumns.slice(1,11),'updated_at','version'];
        const saved=await db.prepare(`UPDATE products SET ${fields.map(key=>key+'=?').join(',')} WHERE id=? AND version=? AND deleted_at='' RETURNING *`).bind(...values.slice(1,11),now,body.version+1,id,body.version).first();
        return saved?json({product:serializeProduct(saved)}):json({error:'Product changed; reload before saving'},409);
    }
    if(old)return !old.deleted_at && same?json({product:serializeProduct(old)}):json({error:'Product ID already used'},409);
    const values=productValues(product,now);
    await db.prepare(`INSERT OR IGNORE INTO products (${productColumns.join(',')}) SELECT ${productColumns.map((key,i)=>key==='position'?'(SELECT COALESCE(MAX(position),-1)+1 FROM products)':'?').join(',')}`).bind(...values.filter((_,i)=>i!==13)).run();
    const saved=await db.prepare('SELECT * FROM products WHERE id=?').bind(product.id).first();
    if(saved.deleted_at || JSON.stringify(validateProduct(serializeProduct(saved)))!==JSON.stringify(product))return json({error:'Product ID already used'},409);
    return json({product:serializeProduct(saved)},201);
}

function validateItems(body) {
    const items=Object.hasOwn(body,'items')?body.items:[];
    if(!Array.isArray(items) || items.length>50 || ['price','total','unitPrice','status','notes'].some(key=>Object.hasOwn(body,key)))throw new Error('Invalid items');
    const ids=new Set();
    for(const item of items) {
        if(!item || typeof item!=='object' || Object.keys(item).sort().join(',')!=='productId,quantity' || typeof item.productId!=='string' || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(item.productId) || !Number.isInteger(item.quantity) || item.quantity<1 || item.quantity>9999 || ids.has(item.productId))throw new Error('Invalid item');
        ids.add(item.productId);
    }
    return [...items].sort((a,b)=>a.productId<b.productId?-1:a.productId>b.productId?1:0);
}

async function savedOrderItems(db,id) {
    const {results}=await db.prepare('SELECT * FROM quote_items WHERE quote_id=? ORDER BY product_id').bind(id).all();
    return results.map(row=>({productId:row.product_id,quantity:row.quantity,unitPrice:Number(row.unit_price),name:row.product_name,nameEn:row.product_name_en,productVersion:row.product_version,total:Math.round(row.unit_price*100)*row.quantity/100}));
}

async function attachOrderItems(db,quotes) {
    const {results}=await db.prepare('SELECT * FROM quote_items WHERE quote_id IN (SELECT value FROM json_each(?)) ORDER BY product_id').bind(JSON.stringify(quotes.map(q=>q.id))).all();
    return quotes.map(q=>({...q,items:results.filter(row=>row.quote_id===q.id).map(row=>({productId:row.product_id,quantity:row.quantity,unitPrice:Number(row.unit_price),name:row.product_name,nameEn:row.product_name_en,productVersion:row.product_version,total:Math.round(row.unit_price*100)*row.quantity/100}))}));
}
