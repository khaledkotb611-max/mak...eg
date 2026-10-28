/* Authenticated management on the public catalog, using the existing API/session. */
(() => {
    window.MakCatalogManager={start({refresh,onAuthorityChange,getLanguage}) {
        const $=id=>document.getElementById(id);
        let authorized=false,csrfToken='',djangoSession=false,checking=null,preparing=false,editor=null;
        const message=text=>{const status=$('catalog-management-status');if(status)status.textContent=text;};
        const labels=()=>{
            const english=getLanguage()==='en';
            if($('catalog-add-product'))$('catalog-add-product').textContent=english?'Add product':'إضافة منتج';
            if($('catalog-admin-link'))$('catalog-admin-link').textContent=english?'Orders and products dashboard':'لوحة الطلبات والمنتجات';
        };
        const setAuthority=value=>{
            const changed=authorized!==value;authorized=value;
            if($('catalog-management'))$('catalog-management').hidden=!value;
            if(!value){csrfToken='';editor?.lock();message('');}
            labels();if(changed)onAuthorityChange(value);
        };
        const checkSession=()=>{
            if(checking)return checking;
            checking=(async()=>{
                try {
                    const response=await fetch('/api/admin/session',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)});
                    if(response.status===401 || response.status===403){setAuthority(false);return false;}
                    if(!response.ok)throw new Error('Session unavailable');
                    const session=await response.json();
                    djangoSession=session.authMode==='django';csrfToken=session.csrfToken || '';
                    setAuthority(session.ok===true);return authorized;
                }catch{if(authorized)message('تعذّر التحقق من الجلسة. راجع الاتصال وأعد المحاولة.');return false;}
                finally{checking=null;}
            })();return checking;
        };
        const request=async(path,options={})=>{
            const unsafe=!['GET','HEAD','OPTIONS'].includes((options.method || 'GET').toUpperCase());
            // Existing server authorization remains decisive; refresh Django CSRF before a write.
            if(!authorized || (unsafe && !await checkSession())){const error=new Error('Sign in required');error.status=authorized?0:401;throw error;}
            const response=await fetch(path,{...options,credentials:'same-origin',cache:'no-store',headers:{...(djangoSession && unsafe?{'X-CSRFToken':csrfToken}:{}),...options.headers},signal:AbortSignal.timeout(15000)});
            if(!response.ok){const error=new Error('Request failed');error.status=response.status;throw error;}
            return response.json();
        };
        const prepareEditor=async()=>{
            if(editor)return editor;
            // Import only the protected product dialog; do not execute dashboard scripts.
            const response=await fetch('/admin.html',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)});
            if(!response.ok){const error=new Error('Form unavailable');error.status=response.status;throw error;}
            const form=new DOMParser().parseFromString(await response.text(),'text/html').getElementById('product-dialog');
            if(!form)throw new Error('Invalid product form');
            document.body.append(document.importNode(form,true));
            editor=window.MakProductEditor.mount({request,isAuthorized:()=>authorized,onUnauthorized:()=>setAuthority(false),
                onSaved(product){editor.lock();message(getLanguage()==='en'?'Product saved.':'تم حفظ المنتج.');refresh(product?.id);},
                onDeleted(){message(getLanguage()==='en'?'Product deleted; previous orders preserved.':'تم حذف المنتج. الطلبات السابقة محفوظة.');refresh();}
            });return editor;
        };
        const open=async(id=null)=>{
            if(preparing || editor?.busy || !authorized)return;
            preparing=true;if($('catalog-add-product'))$('catalog-add-product').disabled=true;message(getLanguage()==='en'?'Loading product form…':'جاري تحميل نموذج المنتج…');
            try {
                if(!await checkSession())return;
                const manager=await prepareEditor();
                const product=id?(await request('/api/products/'+encodeURIComponent(id))).product:null;
                if(authorized){manager.open(product);message('');}
            }catch(error){if(error.status===401 || error.status===403)setAuthority(false);else message(error.status===404?'المنتج اتحذف أو اتوقف. جاري تحديث القائمة.':'تعذّر فتح نموذج المنتج. راجع الاتصال وأعد المحاولة.');if(error.status===404)refresh();}
            finally{preparing=false;if($('catalog-add-product'))$('catalog-add-product').disabled=false;}
        };
        $('catalog-add-product')?.addEventListener('click',()=>{void open();});
        document.addEventListener('click',event=>{const button=event.target.closest('[data-manage-product]');if(button && authorized){event.preventDefault();void open(button.dataset.manageProduct);}});
        document.addEventListener('visibilitychange',()=>{if(!document.hidden)void checkSession();});
        window.addEventListener('focus',()=>{if(!document.hidden)void checkSession();});
        if(!document.hidden)void checkSession();
        return {labels,onCatalog(products){editor?.reconcile(products,{publicList:true});if(authorized && !document.hidden)void checkSession();}};
    }};
})();
