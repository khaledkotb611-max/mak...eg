"""Durable email outbox. Provider acceptance is not inbox delivery."""
import json
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from contextlib import closing
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from django.conf import settings
from . import storage


def configured():
    return bool(settings.RESEND_API_KEY and settings.NOTIFICATION_FROM and settings.NOTIFICATION_TO)


def retry_delay(value, attempts):
    backoff = min(3600, 60 * 2 ** min(attempts, 6))
    try:
        delay = float(value)
    except (TypeError, ValueError):
        try:
            delay = (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds()
        except (TypeError, ValueError, OverflowError):
            return backoff
    if not 0 <= delay <= 86400:
        return backoff
    return max(backoff, int(delay + 0.999))


def failure_state(status, name=''):
    if status == 409 and name != 'concurrent_idempotent_requests':
        return 'needs_review'
    if status == 429 and name in ('daily_quota_exceeded','monthly_quota_exceeded'):
        return 'action_required'
    if status in (408,429) or status == 409 or status >= 500:
        return 'failed'
    return 'action_required'


def process_pending(limit=None, progress=None):
    """Called by the separate worker, never by the customer's save request."""
    with closing(storage.connect()) as db:
        if not configured():
            with db:
                db.execute("UPDATE quote_notifications SET state='blocked',error_code='not_configured' WHERE state='pending'")
            return 0
        now = int(time.time())
        ids = [row[0] for row in db.execute(
            "SELECT quote_id FROM quote_notifications WHERE state IN ('pending','failed','blocked','sending') "
            "AND locked_until<=? AND next_attempt<=? ORDER BY rowid LIMIT ?",
            (now, now, limit or settings.OUTBOX_BATCH_SIZE))]
    for quote_id in ids:
        if progress:progress()
        deliver(quote_id)
        if progress:progress()
    return len(ids)


def finish(db, claimed, state, error='', provider_id='', next_attempt=0):
    # An expired worker cannot overwrite a newer worker's completed delivery.
    args=(claimed['quote_id'],claimed['locked_until'])
    with db:
        db.execute("UPDATE backup_state SET revision=revision+1 WHERE id=1 AND EXISTS (SELECT 1 FROM quote_notifications WHERE quote_id=? AND state='sending' AND locked_until=?)",args)
        db.execute("UPDATE quote_notifications SET state=?,error_code=?,provider_id=?,next_attempt=?,locked_until=0 WHERE quote_id=? AND state='sending' AND locked_until=?",
                   (state,error,provider_id,next_attempt,*args))


def deliver(quote_id):
    with closing(storage.connect()) as db:
        if not configured():
            with db:db.execute("UPDATE quote_notifications SET state='blocked',error_code='not_configured' WHERE quote_id=? AND state IN ('pending','failed','blocked')",(quote_id,))
            return
        now=int(time.time())
        with db:
            claimed=db.execute("UPDATE quote_notifications SET state='sending',locked_until=?,attempts=attempts+1,first_attempt=CASE WHEN first_attempt=0 THEN ? ELSE first_attempt END WHERE quote_id=? AND state IN ('pending','failed','blocked','sending') AND locked_until<=? AND next_attempt<=? RETURNING *",(now+60,now,quote_id,now,now)).fetchone()
        if not claimed:return
        if now-claimed['first_attempt']>23*3600:
            finish(db,claimed,'needs_review','retry_window_expired')
            return
        quote=db.execute('SELECT * FROM quotes WHERE id=?',(quote_id,)).fetchone()
        if not quote:
            finish(db,claimed,'needs_review','order_missing')
            return
        payload=claimed['payload']
        if not payload:
            from .catalog import price_summary
            prices=price_summary(db,quote_id)
            body={'from':settings.NOTIFICATION_FROM,'to':[settings.NOTIFICATION_TO],'subject':f"طلب جديد من MAK — {quote_id[:8]}",
                  'text':f"وصل طلب جديد إلى MAK\n\nرقم الطلب: {quote_id}\nالاسم: {quote['name']}\nالموبايل: {quote['phone']}\nالإيميل: {quote['email']}\nنوع الطلب: {quote['project_type']}\nالتفاصيل:\n{quote['message']}\n\nمتابعة الطلب: {settings.SITE_ORIGIN}/admin"}
            if quote['email']:body['reply_to']=quote['email']
            if prices:body['text']+='\n\nأسعار المنتجات المحفوظة مع الطلب:\n'+prices
            payload=json.dumps(body,ensure_ascii=False)
            with db:db.execute('UPDATE quote_notifications SET payload=? WHERE quote_id=?',(payload,quote_id))
        error='network_error'
        state='failed'
        delay=retry_delay(None,claimed['attempts'])
        try:
            request=Request('https://api.resend.com/emails',data=payload.encode(),headers={'Authorization':f'Bearer {settings.RESEND_API_KEY}','Content-Type':'application/json','Idempotency-Key':f'mak-quote-{quote_id}'},method='POST')
            with urlopen(request,timeout=10) as response:result=json.load(response)
            if not isinstance(result,dict) or not isinstance(result.get('id'),str) or not result['id']:raise ValueError('Invalid provider response')
            finish(db,claimed,'submitted',provider_id=result['id'])
            return
        except HTTPError as exc:
            error=f'provider_{exc.code}'
            try:
                result=json.loads(exc.read(4096))
                name=result.get('name','') if isinstance(result,dict) else ''
            except (OSError,ValueError):
                name=''
            state=failure_state(exc.code,name)
            delay=retry_delay(exc.headers.get('Retry-After') if exc.headers else None,claimed['attempts'])
            exc.close()
        except (OSError,ValueError,TimeoutError):pass
        finish(db,claimed,state,error,next_attempt=int(time.time())+delay)
