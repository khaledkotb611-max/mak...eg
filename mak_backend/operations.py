"""Private operational status; no provider credentials or customer data."""
import time
from contextlib import closing
from datetime import datetime, timezone

from . import notifications, storage
from .auth import admin_api


def heartbeat(worker_id, started_at, stale_after, state='running', error=''):
    now = int(time.time())
    with closing(storage.connect()) as db:
        with db:
            db.execute('DELETE FROM background_workers WHERE last_seen < ?', (now - 7 * 86400,))
            db.execute('''INSERT INTO background_workers VALUES (?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen,
                state=excluded.state,error_code=excluded.error_code''',
                (worker_id, started_at, now, stale_after, state, error))


def worker_status(db, now=None):
    now = int(time.time()) if now is None else now
    rows = db.execute('SELECT * FROM background_workers ORDER BY last_seen DESC').fetchall()
    active = [row for row in rows if row['state'] == 'running' and now - row['last_seen'] <= row['stale_after']]
    last = rows[0] if rows else None
    return {'mode':'continuous', 'state':'running' if active else 'stale' if last else 'not_started',
            'activeWorkers':len(active), 'lastSeen':datetime.fromtimestamp(last['last_seen'],timezone.utc).isoformat() if last else None,
            'error':next((row['error_code'] for row in active if row['error_code']), '') if active else last['error_code'] if last else ''}


@admin_api
def health(request):
    from .views import _json_response
    if request.method != 'GET':
        return _json_response({'error':'Method not allowed'},405)
    with closing(storage.connect()) as db:
        counts = {row['state']:row['count'] for row in db.execute('SELECT state,COUNT(*) AS count FROM quote_notifications GROUP BY state')}
        oldest = db.execute("SELECT MIN(q.created_at) FROM quotes q JOIN quote_notifications n ON q.id=n.quote_id WHERE n.state IN ('pending','failed','sending')").fetchone()[0]
        backup = db.execute('SELECT * FROM backup_state WHERE id=1').fetchone()
        return _json_response({'notifications':{'configured':notifications.configured(),'counts':counts,'oldestPending':oldest},
                               'worker':worker_status(db), 'backup':dict(backup) if backup else None})
