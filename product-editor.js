/* One product form and CRUD implementation, shared by both management surfaces. */
(() => {
    const categoryLabels={pipes:{ar:'مواسير',en:'Pipes'},fittings:{ar:'وصلات',en:'Fittings'},poly:{ar:'بولي بروبلين',en:'Polypropylene'}};
    window.MakProductEditor={mount({request,isAuthorized,onSaved=()=>{},onDeleted=()=>{},onUnauthorized=()=>{}}) {
        const $=id=>document.getElementById(id);
        let editingProduct=null,busy=false,stale=false;
        const status=message=>{$('product-save-status').textContent=message;};
        const setBusy=value=>{
            busy=value;
            $('product-form').querySelectorAll('input,select,textarea,button').forEach(input=>input.disabled=value);
            $('close-product').disabled=value;
            $('save-product').disabled=value || stale;
            $('delete-product').disabled=value || stale;
        };
        const lock=()=>{editingProduct=null;stale=false;$('product-dialog').close();};
        const open=(product=null)=>{
            if(busy || !isAuthorized())return;
            editingProduct=product;stale=false;
            $('product-dialog-title').textContent=product?'تعديل المنتج':'إضافة منتج';
            $('product-id').value=product?.id || 'product-'+crypto.randomUUID();$('product-id').readOnly=!!product;
            $('product-category').value=product?.category || 'pipes';$('product-price').value=product?.price ?? '';
            $('product-image').value=product?.image || '';$('product-active').checked=product?.active ?? true;
            for(const lang of ['ar','en'])for(const key of ['name','size','spec','unit','finish','description'])$('product-'+lang+'-'+key).value=product?.[lang]?.[key] || '';
            $('delete-product').hidden=!product;$('reload-product').hidden=true;status('');setBusy(false);
            if(!$('product-dialog').open)$('product-dialog').showModal();
        };
        const formValue=()=>{
            const category=$('product-category').value;
            const product={id:$('product-id').value.trim(),category,price:Number($('product-price').value),image:$('product-image').value.trim(),active:$('product-active').checked};
            for(const lang of ['ar','en']) {
                product[lang]=Object.fromEntries(['name','size','spec','unit','description'].map(key=>[key,$('product-'+lang+'-'+key).value.trim()]));
                product[lang].category=editingProduct?.category===category?editingProduct[lang].category:categoryLabels[category][lang];
                const finish=$('product-'+lang+'-finish').value.trim();
                if(finish || editingProduct?.[lang]?.finish!==undefined)product[lang].finish=finish;
            }
            if(editingProduct)product.version=editingProduct.version;
            return product;
        };
        const failure=(error,message)=>{
            if(error.status===401 || error.status===403){lock();onUnauthorized();return;}
            if(error.status===409){stale=!!editingProduct;status('المنتج اتعدّل أو الكود مستخدم بالفعل. حمّل أحدث بيانات قبل الحفظ.');$('reload-product').hidden=!editingProduct;}
            else if(error.status===404){stale=true;status('المنتج اتحذف من جلسة أخرى. البيانات المكتوبة لم تُحفظ.');$('reload-product').hidden=true;}
            else status(error.status===400?'راجع الاسم في اللغتين، السعر، ورابط الصورة.':message);
        };
        $('close-product').addEventListener('click',()=>{if(!busy)$('product-dialog').close();});
        $('product-dialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
        $('product-dialog').addEventListener('close',()=>{editingProduct=null;stale=false;});
        $('reload-product').addEventListener('click',async()=>{
            if(!editingProduct || busy || !isAuthorized())return;
            if(!window.confirm('تحميل آخر تعديل هيستبدل البيانات المكتوبة في النموذج. تكمل؟'))return;
            setBusy(true);
            try{const result=await request('/api/products/'+encodeURIComponent(editingProduct.id));setBusy(false);if(isAuthorized())open(result.product);}
            catch(error){failure(error,'تعذّر تحميل التعديل الأحدث. البيانات المكتوبة موجودة؛ أعد المحاولة.');}
            finally{setBusy(false);}
        });
        $('product-form').addEventListener('submit',async event=>{
            event.preventDefault();if(!isAuthorized() || busy || stale || !$('product-form').reportValidity())return;
            const body=formValue(),id=editingProduct?.id;setBusy(true);status('جاري حفظ المنتج…');
            try {
                const result=await request('/api/products'+(id?'/'+encodeURIComponent(id):''),{method:id?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
                if(!isAuthorized())return;
                editingProduct=result.product;stale=false;
                $('product-id').readOnly=true;$('delete-product').hidden=false;$('reload-product').hidden=true;
                $('product-dialog-title').textContent='تعديل المنتج';
                status('تم حفظ المنتج والسعر. التعديل هيظهر تلقائيًا في الموقع ولوحة المنتجات.');
                onSaved(result.product);
            }catch(error){failure(error,'تعذّر الحفظ. البيانات المكتوبة ما زالت موجودة؛ أعد المحاولة.');}
            finally{setBusy(false);}
        });
        $('delete-product').addEventListener('click',async()=>{
            if(!isAuthorized() || !editingProduct || busy || stale)return;
            if(!window.confirm('حذف المنتج من الموقع؟ الطلبات السابقة وأسعارها المحفوظة هتفضل موجودة.'))return;
            const product=editingProduct;setBusy(true);status('جاري حذف المنتج…');
            try {
                await request('/api/products/'+encodeURIComponent(product.id),{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:product.version})});
                if(!isAuthorized())return;
                lock();onDeleted(product);
            }catch(error){failure(error,'تعذّر الحذف. أعد المحاولة.');}
            finally{setBusy(false);}
        });
        return {open,lock,get busy(){return busy;},reconcile(products,{publicList=false}={}) {
            if(!editingProduct || busy)return;
            const latest=products.find(p=>p.id===editingProduct.id);
            const editable=p=>JSON.stringify([p.version,p.price,p.active,p.category,p.image,p.ar,p.en]);
            if(!latest || editable(latest)!==editable(editingProduct)) {
                stale=true;
                status(latest?'المنتج اتعدّل من جلسة أخرى. حمّل التعديل الأحدث قبل الحفظ.':publicList?'المنتج اتوقف أو اتحذف من جلسة أخرى. حمّل أحدث بيانات للمراجعة.':'المنتج اتحذف من جلسة أخرى. البيانات المكتوبة لم تُحفظ.');
                $('reload-product').hidden=!latest && !publicList;
                setBusy(false);
            }
        }};
    }};
})();
