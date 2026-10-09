// Explicit, directional synchronization through the existing protected product API.
// No database credentials, implicit background replication, or secret values in arguments/logs.
import {pathToFileURL} from 'node:url';

const content=p=>({id:p.id,category:p.category,price:p.price,image:p.image,ar:p.ar,en:p.en,active:p.active});
const canonical=value=>value && typeof value==='object' && !Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(content(a)))===JSON.stringify(canonical(content(b)));

export function syncPlan(source,target,{prune=false}={}) {
    if(source.currency!=='EGP' || target.currency!=='EGP' || !Array.isArray(source.products) || !Array.isArray(target.products))throw new Error('Invalid catalog');
    const sourceMap=new Map(source.products.map(p=>[p.id,p])),targetMap=new Map(target.products.map(p=>[p.id,p]));
    if(sourceMap.size!==source.products.length || targetMap.size!==target.products.length)throw new Error('Duplicate IDs');
    const changes=[];
    for(const p of source.products){const old=targetMap.get(p.id);if(!old)changes.push({method:'POST',path:'/api/products',body:content(p)});else if(!same(p,old))changes.push({method:'PUT',path:'/api/products/'+encodeURIComponent(p.id),body:{...content(p),version:old.version}});}
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
    const args=process.argv.slice(2),allowed=new Set(['--source','--target','--apply','--prune']);
    const values={};for(let i=0;i<args.length;i++){const key=args[i];if(!allowed.has(key))throw new Error('Usage: node scripts/sync-catalog.mjs --source ORIGIN --target ORIGIN [--apply] [--prune]');values[key]=['--apply','--prune'].includes(key)?true:args[++i];}
    const source=origin(values['--source']),target=origin(values['--target']);if(source===target)throw new Error('Source and target must be different');
    const [sourceCatalog,targetCatalog]=await Promise.all([api(source,process.env.MAK_CATALOG_SOURCE_TOKEN,'/api/products?includeInactive=1'),api(target,process.env.MAK_CATALOG_TARGET_TOKEN,'/api/products?includeInactive=1')]);
    const plan=syncPlan(sourceCatalog,targetCatalog,{prune:values['--prune']===true});
    const summary={mode:values['--apply']?'apply':'preview',add:plan.filter(p=>p.method==='POST').length,update:plan.filter(p=>p.method==='PUT').length,delete:plan.filter(p=>p.method==='DELETE').length,extraTargetProducts:targetCatalog.products.filter(p=>!sourceCatalog.products.some(s=>s.id===p.id)).length};
    process.stdout.write(JSON.stringify(summary)+'\n');
    if(values['--apply']) {
        for(const step of plan)await api(target,process.env.MAK_CATALOG_TARGET_TOKEN,step.path,step.method,step.body);
        const verified=await api(target,process.env.MAK_CATALOG_TARGET_TOKEN,'/api/products?includeInactive=1');
        if(syncPlan(sourceCatalog,verified,{prune:values['--prune']===true}).length)throw new Error('Catalog changed during verification. Run preview again.');
        process.stdout.write('Catalog transfer verified.\n');
    }
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
