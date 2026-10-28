// Explicit, directional synchronization through the existing protected product API.
// No database credentials, implicit background replication, or secret values in arguments/logs.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const content=p=>({id:p.id,category:p.category,price:p.price,image:p.image,ar:p.ar,en:p.en,active:typeof p.active==='boolean'?p.active:true});
const canonical=value=>value && typeof value==='object' && !Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(content(a)))===JSON.stringify(canonical(content(b)));

export function syncPlan(source,target,{prune=false}={}) {
    if(source.currency!=='EGP' || target.currency!=='EGP' || !Array.isArray(source.products) || !Array.isArray(target.products))throw new Error('Invalid catalog');
    const sourceMap=new Map(source.products.map(p=>[p.id,p])),targetMap=new Map(target.products.map(p=>[p.id,p]));
    if(sourceMap.size!==source.products.length || targetMap.size!==target.products.length)throw new Error('Duplicate IDs');
    const changes=[];
    for(const sourceProduct of source.products){
        const old=targetMap.get(sourceProduct.id);
        const product=old && typeof sourceProduct.active!=='boolean'?{...sourceProduct,active:old.active}:sourceProduct;
        if(!old)changes.push({method:'POST',path:'/api/products',body:content(product)});
        else if(!same(product,old))changes.push({method:'PUT',path:'/api/products/'+encodeURIComponent(product.id),body:{...content(product),version:old.version}});
    }
    if(prune)for(const p of target.products)if(!sourceMap.has(p.id))changes.push({method:'DELETE',path:'/api/products/'+encodeURIComponent(p.id),body:{version:p.version}});
    return changes;
}

function origin(value) {
    const url=new URL(value);
    if(url.username || url.password || !['https:','http:'].includes(url.protocol) || url.protocol==='http:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.pathname!=='/' || url.search || url.hash)throw new Error('Use an HTTPS origin, or local HTTP, without a path or credentials');
    return url.origin;
}

async function api(base,token,path,method='GET',body) {
    const response=await fetch(base+path,{method,redirect:'error',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error(`Catalog API failed (${response.status}). Changes may be partially applied; rerun the preview before retrying.`);
    return response.json();
}

async function main() {
    const usage='Usage: node scripts/sync-catalog.mjs (--source ORIGIN | --catalog FILE) --target ORIGIN [--apply] [--prune]';
    const args=process.argv.slice(2),allowed=new Set(['--source','--catalog','--target','--apply','--prune']);
    const values={};for(let i=0;i<args.length;i++){const key=args[i];if(!allowed.has(key))throw new Error(usage);values[key]=['--apply','--prune'].includes(key)?true:args[++i];}
    const hasSource=Boolean(values['--source']),hasCatalog=Boolean(values['--catalog']);
    if(hasSource===hasCatalog || !values['--target'])throw new Error(usage);
    const target=origin(values['--target']);
    const source=hasSource?origin(values['--source']):'';
    if(source===target)throw new Error('Source and target must be different');
    const sourceCatalogPromise=hasSource
        ? api(source,process.env.MAK_CATALOG_SOURCE_TOKEN,'/api/products?includeInactive=1')
        : readFile(values['--catalog'],'utf8').then(text=>{
            const catalog=JSON.parse(text);
            if(!Array.isArray(catalog.products))throw new Error('Invalid catalog file');
            return catalog;
        });
    const [sourceCatalog,targetCatalog]=await Promise.all([sourceCatalogPromise,api(target,process.env.MAK_CATALOG_TARGET_TOKEN,'/api/products?includeInactive=1')]);
    const plan=syncPlan(sourceCatalog,targetCatalog,{prune:values['--prune']===true});
    const summary={mode:values['--apply']?'apply':'preview',source:hasSource?'origin':'file',add:plan.filter(p=>p.method==='POST').length,update:plan.filter(p=>p.method==='PUT').length,delete:plan.filter(p=>p.method==='DELETE').length,extraTargetProducts:targetCatalog.products.filter(p=>!sourceCatalog.products.some(s=>s.id===p.id)).length};
    process.stdout.write(JSON.stringify(summary)+'\n');
    if(values['--apply']) {
        for(const step of plan)await api(target,process.env.MAK_CATALOG_TARGET_TOKEN,step.path,step.method,step.body);
        const verified=await api(target,process.env.MAK_CATALOG_TARGET_TOKEN,'/api/products?includeInactive=1');
        if(syncPlan(sourceCatalog,verified,{prune:values['--prune']===true}).length)throw new Error('Catalog changed during verification. Run preview again.');
        process.stdout.write('Catalog transfer verified.\n');
    }
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
