"""Private, checksummed order snapshots; restore only missing orders."""
import hashlib
import json
import os
import re
import sqlite3
import time
import uuid
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from django.conf import settings
from django.http import HttpResponse
from .auth import admin_api
from . import storage


def directory():
    path=settings.DATA_DIR / 'backups'
    path.mkdir(parents=True,exist_ok=True,mode=0o700)
    return path


def ensure_backup(force=False):
    with closing(storage.connect()) as db:
        now=int(time.time())
        with db:
            db.execute('INSERT OR IGNORE INTO backup_state (id) VALUES (1)')
            state=db.execute("UPDATE backup_state SET lease_until=? WHERE id=1 AND lease_until<=? AND (?=1 OR revision>saved_revision OR last_at='' OR julianday(last_at)<julianday('now','-1 day')) RETURNING *",(now+120,now,int(force))).fetchone()
        if not state:return None
        try:
            db.execute('BEGIN')
            from .catalog import read
            tables={table:[dict(row) for row in db.execute(f'SELECT * FROM {table}')] for table in ('quotes','quote_admin','quote_notifications','products','quote_items')}
            tables['quote_events']=[dict(row) for row in db.execute('SELECT e.* FROM quote_events e JOIN quotes q ON q.id=e.quote_id')]
            catalog=read(db,True)
            revision=db.execute('SELECT revision FROM backup_state WHERE id=1').fetchone()[0]
            db.commit()
            created=datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
            snapshot={'format':'mak-orders-backup','version':1,'createdAt':created,'revision':revision,'tables':tables,'catalog':catalog}
            data=json.dumps(snapshot,ensure_ascii=False,separators=(',',':'))
            envelope={'format':'mak-backup-envelope','sha256':hashlib.sha256(data.encode()).hexdigest(),'data':data}
            backup_id=f'{9999999999999-int(time.time()*1000):013d}-{uuid.uuid4()}'
            target=directory() / (backup_id+'.json')
            temp=target.with_suffix('.tmp')
            with temp.open('x',encoding='utf-8') as output:
                os.chmod(temp,0o600);output.write(json.dumps(envelope,ensure_ascii=False));output.flush();os.fsync(output.fileno())
            temp.replace(target)
            with db:db.execute("UPDATE backup_state SET saved_revision=?,last_id=?,last_at=?,last_error='',lease_until=0 WHERE id=1",(revision,backup_id,created))
            for old in sorted(directory().glob('*.json'))[30:]:old.unlink()
            return {'id':backup_id,'createdAt':created,'quoteCount':len(tables['quotes']),'revision':revision}
        except Exception:
            db.rollback()
            with db:db.execute("UPDATE backup_state SET lease_until=0,last_error='backup_failed' WHERE id=1")
            raise


def read_backup(backup_id):
    if not re.fullmatch(r'\d{13}-[0-9a-f-]{36}',backup_id):raise ValueError('Invalid backup')
    path=directory() / (backup_id+'.json')
    if path.is_symlink() or path.stat().st_size>64*1024*1024:raise ValueError('Invalid backup')
    envelope=json.loads(path.read_text(encoding='utf-8'))
    if envelope.get('format')!='mak-backup-envelope' or hashlib.sha256(envelope['data'].encode()).hexdigest()!=envelope['sha256']:raise ValueError('Invalid checksum')
    snapshot=json.loads(envelope['data'])
    if snapshot.get('format')!='mak-orders-backup' or snapshot.get('version')!=1:raise ValueError('Invalid backup')
    tables=snapshot['tables']
    if any(not isinstance(tables.get(table),list) for table in ('quotes','quote_admin','quote_notifications')):raise ValueError('Invalid backup')
    if not isinstance(tables.get('quote_events',[]),list):raise ValueError('Invalid history')
    if not isinstance(tables.get('quote_items',[]),list):raise ValueError('Invalid order items')
    ids={row['id'] for row in tables['quotes']}
    for item in tables.get('quote_items',[]):
        if not isinstance(item,dict) or item.get('quote_id') not in ids or not all(isinstance(item.get(key),str) for key in ('product_id','product_name','product_name_en')) or type(item.get('quantity')) is not int or not 1<=item['quantity']<=9999 or type(item.get('unit_price')) not in (int,float) or item['unit_price']<0 or type(item.get('product_version')) is not int:raise ValueError('Invalid order items')
    for event in tables.get('quote_events',[]):
        if not isinstance(event,dict) or not all(isinstance(event.get(key),str) for key in ('id','quote_id','actor','previous_status','status','created_at')) or event['quote_id'] not in ids or type(event.get('version')) is not int or event['version']<1 or event.get('notes_changed') not in (0,1) or event['status'] not in ('new','contacted','fulfilled') or event['previous_status'] not in ('new','contacted','fulfilled'):raise ValueError('Invalid history')
    return envelope,snapshot


@admin_api
def api(request,backup_id=None,restore=False):
    from .orders import authorized
    from .views import _json_response as reply
    if not authorized(request):return reply({'error':'Admin authorization required'},401)
    if request.method=='POST' and request.headers.get('Origin') and request.headers['Origin']!=f'{request.scheme}://{request.get_host()}':return reply({'error':'Origin not allowed'},403)
    try:
        if backup_id is None:
            if request.method=='POST':
                backup=ensure_backup(True)
                return reply({'ok':True,'backup':backup,'pending':not backup},201 if backup else 202)
            if request.method!='GET':return reply({'error':'Method not allowed'},405)
            state=None
            try:
                ensure_backup()
                with closing(storage.connect()) as db:state=dict(db.execute('SELECT * FROM backup_state WHERE id=1').fetchone())
            except (OSError,sqlite3.Error):pass
            backups=[]
            for path in sorted(directory().glob('*.json'))[:30]:
                _,snapshot=read_backup(path.stem)
                backups.append({'id':path.stem,'createdAt':snapshot['createdAt'],'quoteCount':len(snapshot['tables']['quotes'])})
            return reply({'state':state,'backups':backups,'retainedVersions':30})
        envelope,snapshot=read_backup(backup_id)
        if not restore:
            if request.method!='GET':return reply({'error':'Method not allowed'},405)
            response=HttpResponse(json.dumps(envelope,ensure_ascii=False),content_type='application/json; charset=utf-8')
            response['Content-Disposition']=f'attachment; filename="MAK-backup-{snapshot["createdAt"][:10]}.json"'
            response['Cache-Control']='no-store'
            return response
        if request.method!='POST':return reply({'error':'Method not allowed'},405)
        if request.content_type!='application/json' or len(request.body)>1000:return reply({'error':'Invalid restore request'},400)
        body=json.loads(request.body)
        if body.get('mode') not in ('preview','restore') or body['mode']=='restore' and body.get('confirm')!=backup_id:return reply({'error':'Restore confirmation required'},400)
        with closing(storage.connect()) as db:
            rows=db.execute('SELECT id,request_id FROM quotes').fetchall()
            ids={row['id'] for row in rows};requests={row['request_id'] for row in rows}
            missing=[row for row in snapshot['tables']['quotes'] if row['id'] not in ids and row['request_id'] not in requests]
            preserved=len(snapshot['tables']['quotes'])-len(missing)
            if body['mode']=='preview':return reply({'missing':len(missing),'preserved':preserved})
            admin={row['quote_id']:row for row in snapshot['tables']['quote_admin']}
            notifications={row['quote_id']:row for row in snapshot['tables']['quote_notifications']}
            with db:
                for row in missing:
                    db.execute('INSERT OR IGNORE INTO quotes VALUES (?,?,?,?,?,?,?,?)',tuple(row[key] for key in ('id','request_id','name','email','phone','project_type','message','created_at')))
                    notes=admin.get(row['id'])
                    if notes:db.execute('INSERT OR IGNORE INTO quote_admin (quote_id,status,notes,version,updated_at) VALUES (?,?,?,?,?)',(row['id'],notes['status'],notes['notes'],notes['version'],notes['updated_at']))
                    notice=notifications.get(row['id'],{})
                    submitted=notice.get('state')=='submitted'
                    db.execute('INSERT OR IGNORE INTO quote_notifications (quote_id,state,provider_id,error_code) VALUES (?,?,?,?)',(row['id'],'submitted' if submitted else 'needs_review',notice.get('provider_id',''),'' if submitted else 'restored_backup'))
                archived_requests={row['id']:row['request_id'] for row in snapshot['tables']['quotes']}
                items_added=0
                for item in snapshot['tables'].get('quote_items',[]):
                    values=tuple(item[key] for key in ('quote_id','product_id','quantity','unit_price','product_name','product_name_en','product_version'))
                    result=db.execute('INSERT OR IGNORE INTO quote_items SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM quotes WHERE id=? AND request_id=?)',(*values,item['quote_id'],archived_requests[item['quote_id']]))
                    items_added+=result.rowcount
                events_added=0
                for event in snapshot['tables'].get('quote_events',[]):
                    values=tuple(event[key] for key in ('id','quote_id','version','actor','previous_status','status','notes_changed','created_at'))
                    result=db.execute('INSERT OR IGNORE INTO quote_events SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM quotes q JOIN quote_admin a ON a.quote_id=q.id WHERE q.id=? AND q.request_id=? AND a.version>=?)',(*values,event['quote_id'],archived_requests[event['quote_id']],event['version']))
                    events_added+=result.rowcount
                if missing or events_added or items_added:db.execute('UPDATE backup_state SET revision=revision+1 WHERE id=1')
        ensure_backup()
        return reply({'ok':True,'restored':len(missing),'preserved':preserved})
    except (OSError,ValueError,KeyError,TypeError,sqlite3.Error):return reply({'error':'Backup missing or invalid'},422)
