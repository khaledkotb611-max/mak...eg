import json
import re
import sqlite3
import uuid
from contextlib import closing
from datetime import datetime, timezone
from urllib.request import Request, urlopen

from django.conf import settings
from django.middleware.csrf import get_token
from . import storage
from .auth import authorized, admin_api, bearer_authorized

STATUSES = ('new', 'contacted', 'fulfilled')
SELECT = """SELECT q.*, COALESCE(a.status, 'new') AS status, COALESCE(a.notes, '') AS notes,
COALESCE(a.version, 0) AS version, COALESCE(a.updated_at, q.created_at) AS updated_at,
COALESCE(n.state, 'not_requested') AS notification_state, COALESCE(n.error_code, '') AS notification_error
FROM quotes q LEFT JOIN quote_admin a ON a.quote_id=q.id LEFT JOIN quote_notifications n ON n.quote_id=q.id"""


def serialize(row):
    return {**storage.serialize(row), 'status': row['status'], 'notes': row['notes'], 'version': row['version'],
            'updatedAt': row['updated_at'], 'notification': {'state': row['notification_state'], 'error': row['notification_error']}}


def list_orders(request):
    from .catalog import attach_items
    from .views import _json_response as reply
    if not authorized(request):
        return reply({'error': 'Admin authorization required'}, 401)
    try:
        with closing(storage.connect()) as db:
            if 'limit' not in request.GET:
                return reply({'quotes': attach_items(db,[serialize(row) for row in db.execute(SELECT+' ORDER BY q.created_at DESC, q.id DESC LIMIT 100')])})
            try:
                limit=max(1,min(100,int(request.GET.get('limit','30')))); offset=max(0,min(1000000,int(request.GET.get('offset','0'))))
            except ValueError:
                return reply({'error':'Invalid pagination'},400)
            status=request.GET.get('status',''); q=request.GET.get('q','').strip()[:160]
            if status and status not in STATUSES:return reply({'error':'Invalid status'},400)
            created_from=request.GET.get('createdFrom','');created_before=request.GET.get('createdBefore','')
            try:
                for value in (created_from,created_before):
                    if not value:continue
                    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z',value):raise ValueError()
                    parsed=datetime.fromisoformat(value.replace('Z','+00:00'))
                    if parsed.isoformat(timespec='milliseconds').replace('+00:00','Z')!=value:raise ValueError()
                if created_from and created_before and created_from>=created_before:raise ValueError()
            except ValueError:return reply({'error':'Invalid date range'},400)
            conditions=[]; args=[]
            if status:conditions.append("COALESCE(a.status, 'new') = ?");args.append(status)
            if created_from:conditions.append('julianday(q.created_at) >= julianday(?)');args.append(created_from)
            if created_before:conditions.append('julianday(q.created_at) < julianday(?)');args.append(created_before)
            if q:
                conditions.append('(q.name LIKE ? OR q.email LIKE ? OR q.phone LIKE ? OR q.message LIKE ? OR q.id LIKE ?)')
                args.extend([f'%{q}%']*5)
            where=' WHERE '+' AND '.join(conditions) if conditions else ''
            rows=db.execute(SELECT+where+' ORDER BY q.created_at DESC, q.id DESC LIMIT ? OFFSET ?',[*args,limit,offset]).fetchall()
            total=db.execute('SELECT COUNT(*) FROM quotes q LEFT JOIN quote_admin a ON a.quote_id=q.id'+where,args).fetchone()[0]
            summary={'total':0,'new':0,'contacted':0,'fulfilled':0}
            for row in db.execute("SELECT COALESCE(a.status,'new') AS status, COUNT(*) AS count FROM quotes q LEFT JOIN quote_admin a ON a.quote_id=q.id GROUP BY COALESCE(a.status,'new')"):
                summary[row['status']]=row['count'];summary['total']+=row['count']
            quotes=attach_items(db,[serialize(row) for row in rows])
        return reply({'quotes':quotes,'total':total,'summary':summary,'offset':offset,'limit':limit,
                      'notificationSettings':{'configured': bool(settings.RESEND_API_KEY and settings.NOTIFICATION_FROM and settings.NOTIFICATION_TO), 'recipient':settings.NOTIFICATION_TO,'from':settings.NOTIFICATION_FROM}})
    except (OSError, ValueError, sqlite3.Error):return reply({'error':'Storage unavailable'},503)


def session(request):
    from .views import _json_response as reply
    if request.method!='GET':return reply({'error':'Method not allowed'},405)
    if not authorized(request):return reply({'error':'Admin authorization required'},401)
    if bearer_authorized(request):return reply({'ok':True,'email':''})
    return reply({'ok':True,'email':request.user.email,'authMode':'django','csrfToken':get_token(request),
                  'loginUrl':'/admin/login','logoutUrl':'/admin/logout'})


@admin_api
def test_notification(request):
    from .views import _json_response as reply
    from .notifications import configured
    if not authorized(request):return reply({'error':'Admin authorization required'},401)
    if request.method!='POST':return reply({'error':'Method not allowed'},405)
    if request.headers.get('Origin') and request.headers['Origin']!=f'{request.scheme}://{request.get_host()}':return reply({'error':'Origin not allowed'},403)
    if not configured():return reply({'error':'Email not configured'},503)
    try:
        if len(request.body)>1000:raise ValueError()
        body=json.loads(request.body)
        if not re.fullmatch(r'[0-9a-f-]{36}',body.get('requestId','')):raise ValueError()
    except (ValueError,TypeError,AttributeError):return reply({'error':'Invalid test request'},400)
    payload={'from':settings.NOTIFICATION_FROM,'to':[settings.NOTIFICATION_TO],'subject':'اختبار تنبيهات الطلبات — MAK','text':f'دي رسالة اختبار من لوحة طلبات MAK.\n{settings.SITE_ORIGIN}/admin'}
    try:
        message=Request('https://api.resend.com/emails',data=json.dumps(payload,ensure_ascii=False).encode(),headers={'Authorization':f'Bearer {settings.RESEND_API_KEY}','Content-Type':'application/json','Idempotency-Key':f'mak-test-{body["requestId"]}'},method='POST')
        with urlopen(message,timeout=10) as response:result=json.load(response)
        if not isinstance(result,dict) or not isinstance(result.get('id'),str) or not result['id']:raise ValueError()
        return reply({'ok':True,'state':'submitted'})
    except (OSError,ValueError):return reply({'error':'Email provider rejected test'},502)


@admin_api
def update(request, quote_id):
    from .views import _json_response as reply
    if not authorized(request):return reply({'error':'Admin authorization required'},401)
    if request.method!='PATCH':return reply({'error':'Method not allowed'},405)
    if request.headers.get('Origin') and request.headers['Origin']!=f'{request.scheme}://{request.get_host()}':return reply({'error':'Origin not allowed'},403)
    if request.content_type!='application/json':return reply({'error':'JSON required'},415)
    if len(request.body)>10000:return reply({'error':'Body too large'},413)
    try:
        body=json.loads(request.body)
        if not isinstance(body,dict) or body.get('status') not in STATUSES or not isinstance(body.get('notes'),str) or len(body['notes'])>4000 or type(body.get('version')) is not int or not 0<=body['version']<2147483647:raise ValueError()
    except (ValueError,UnicodeDecodeError):return reply({'error':'Invalid update'},400)
    try:
        with closing(storage.connect()) as db:
            if not db.execute('SELECT 1 FROM quotes WHERE id=?',(str(quote_id),)).fetchone():return reply({'error':'Not found'},404)
            now=datetime.now(timezone.utc).isoformat()
            with db:
                db.execute('INSERT OR IGNORE INTO quote_admin (quote_id,updated_at) VALUES (?,?)',(str(quote_id),now))
                previous=db.execute('SELECT status,notes FROM quote_admin WHERE quote_id=?',(str(quote_id),)).fetchone()
                updated=db.execute('UPDATE quote_admin SET status=?,notes=?,version=version+1,updated_at=? WHERE quote_id=? AND version=? RETURNING quote_id',(body['status'],body['notes'],now,str(quote_id),body['version'])).fetchone()
                if updated:
                    actor='server-api' if bearer_authorized(request) else request.user.email
                    db.execute('INSERT INTO quote_events VALUES (?,?,?,?,?,?,?,?)',
                               (str(uuid.uuid4()),str(quote_id),body['version']+1,actor,previous['status'],body['status'],int(previous['notes']!=body['notes']),now))
                    db.execute('INSERT OR IGNORE INTO backup_state (id) VALUES (1)')
                    db.execute('UPDATE backup_state SET revision=revision+1 WHERE id=1')
            if not updated:return reply({'error':'Order changed; refresh before saving'},409)
            row=db.execute(SELECT+' WHERE q.id=?',(str(quote_id),)).fetchone()
            from .catalog import order_items
            items=order_items(db,str(quote_id))
        return reply({'quote':{**serialize(row),'items':items}})
    except (OSError,ValueError,sqlite3.Error):return reply({'error':'Storage unavailable'},503)


@admin_api
def retry_notifications(request):
    from .views import _json_response as reply
    from . import notifications
    if not authorized(request):return reply({'error':'Admin authorization required'},401)
    if request.method!='POST':return reply({'error':'Method not allowed'},405)
    if request.headers.get('Origin') and request.headers['Origin']!=f'{request.scheme}://{request.get_host()}':return reply({'error':'Origin not allowed'},403)
    if not notifications.configured():return reply({'error':'Email not configured'},503)
    with closing(storage.connect()) as db:
        with db:db.execute("UPDATE quote_notifications SET state='failed',next_attempt=CASE WHEN error_code IN ('provider_429','provider_409') THEN next_attempt ELSE 0 END WHERE state IN ('failed','blocked','action_required')")
    return reply({'ok':True,'state':'queued'})


@admin_api
def history(request, quote_id):
    from .views import _json_response as reply
    if request.method!='GET':return reply({'error':'Method not allowed'},405)
    with closing(storage.connect()) as db:
        if not db.execute('SELECT 1 FROM quotes WHERE id=?',(str(quote_id),)).fetchone():return reply({'error':'Not found'},404)
        before=request.GET.get('before','')
        if before and (not before.isascii() or not before.isdecimal() or len(before)>10):return reply({'error':'Invalid history cursor'},400)
        rows=db.execute('SELECT * FROM quote_events WHERE quote_id=? AND version<? ORDER BY version DESC LIMIT 31',
                        (str(quote_id),int(before) if before else 2147483648)).fetchall()
        events=[{'id':row['id'],'version':row['version'],'actor':row['actor'],'previousStatus':row['previous_status'],
                 'status':row['status'],'notesChanged':bool(row['notes_changed']),'createdAt':row['created_at']} for row in rows[:30]]
        return reply({'events':events,'nextBefore':events[-1]['version'] if len(rows)>30 else None})
