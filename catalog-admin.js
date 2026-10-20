let adminProducts=new Map();
let productLoading=null;
let productEtag='';
let productRefreshPending=false;

function renderAdminProducts() {
    const query=$('product-search').value.trim().toLowerCase();
    const visible=[...adminProducts.values()].filter(p=>[p.id,p.ar.name,p.en.name,p.ar.size,p.en.size].join(' ').toLowerCase().includes(query));
    $('products-count').textContent=`${visible.length.toLocaleString('ar-EG')} من ${adminProducts.size.toLocaleString('ar-EG')} منتج`;
    $('products-list').innerHTML=visible.length?visible.map(p=>`<article class="product-admin-row"><div><h3>${escapeHtml(p.ar.name)}</h3><p>${escapeHtml([p.ar.size,p.ar.spec].filter(Boolean).join(' · '))}</p></div><strong>${Number(p.price).toLocaleString('ar-EG',{maximumFractionDigits:2})} ج.م</strong><span class="product-inactive">${p.active?'مفعّل':'متوقف'}</span><button type="button" class="secondary" data-edit-product="${escapeHtml(p.id)}">تعديل</button></article>`).join(''):'<p class="empty">لا توجد منتجات تطابق البحث.</p>';
    adminProductEditor.reconcile([...adminProducts.values()]);
}

async function loadAdminProducts({force=false}={}) {
    if(!authenticated || document.hidden)return;
    if(productLoading){productRefreshPending=true;return productLoading;}
    productLoading=(async()=>{
        try {
            const response=await fetch('/api/products?includeInactive=1',{headers:{...(token?{Authorization:`Bearer ${token}`}:{}) ,...(productEtag?{'If-None-Match':productEtag}:{})},cache:'no-store',signal:AbortSignal.timeout(15000)});
            if(response.status===401 || response.status===403){lockDashboard();return;}
            if(!authenticated || productRefreshPending)return;
            if(response.status!==304) {
                if(!response.ok)throw new Error('Catalog unavailable');
                const data=await response.json();if(!Array.isArray(data.products))throw new Error('Invalid catalog');
                productEtag=response.headers.get('ETag') || '';
                adminProducts=new Map(data.products.map(p=>[p.id,p]));renderAdminProducts();
            }
            $('products-status').textContent='المنتجات والأسعار محفوظة في قاعدة البيانات. التحديث تلقائي كل 15 ثانية أثناء عرض اللوحة.';
        }catch{$('products-status').textContent='تعذّر تحديث المنتجات. البيانات المعروضة قديمة؛ راجع اتصالك أو اضغط تحديث الطلبات للمحاولة.';}
        finally{productLoading=null;if(productRefreshPending){productRefreshPending=false;productEtag='';void loadAdminProducts();}}
    })();
    return productLoading;
}

const adminProductEditor=window.MakProductEditor.mount({
    request:api,isAuthorized:()=>authenticated,onUnauthorized:lockDashboard,
    onSaved(product){adminProducts.set(product.id,product);renderAdminProducts();productEtag='';void loadAdminProducts({force:true});},
    onDeleted(product){adminProducts.delete(product.id);renderAdminProducts();productEtag='';$('products-status').textContent='تم حذف المنتج. الطلبات السابقة محفوظة.';void loadAdminProducts({force:true});}
});
$('product-search').addEventListener('input',renderAdminProducts);
$('add-product').addEventListener('click',()=>{if(authenticated)adminProductEditor.open();});
$('products-list').addEventListener('click',event=>{const button=event.target.closest('[data-edit-product]');if(button && authenticated)adminProductEditor.open(adminProducts.get(button.dataset.editProduct));});
