"""Durable local SQLite storage; hosted builds use D1 with the same schema."""
import hashlib
import json
import os
import sqlite3
import time

from django.conf import settings


RATE_SQL = """INSERT INTO quote_rate_limits (client_key, window_start, attempts)
VALUES (?, ?, 1) ON CONFLICT(client_key) DO UPDATE SET
attempts = CASE WHEN quote_rate_limits.window_start <= ? THEN 1 ELSE quote_rate_limits.attempts + 1 END,
window_start = CASE WHEN quote_rate_limits.window_start <= ? THEN excluded.window_start ELSE quote_rate_limits.window_start END
RETURNING attempts"""


def connect():
    settings.DATA_DIR.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(settings.QUOTES_DB_PATH, timeout=10)
    os.chmod(settings.QUOTES_DB_PATH, 0o600)
    db.row_factory = sqlite3.Row
    migrations = [("schema:" + path.name, path) for path in sorted((settings.BASE_DIR / ".openai/drizzle").glob("*.sql"))]
    migrations += [("local:" + path.name, path) for path in sorted((settings.BASE_DIR / "mak_backend/local_schema").glob("*.sql"))]
    try:
        try:
            applied = {row[0] for row in db.execute('SELECT name FROM app_migrations')}
        except sqlite3.OperationalError as exc:
            if 'no such table: app_migrations' not in str(exc):
                raise
            applied = set()
        if {'legacy_quotes','catalog_seed_v1'} <= applied and all(name in applied for name, _ in migrations):
            return db
        # Serialize first-time schema work across web and background processes.
        db.execute('BEGIN IMMEDIATE')
        db.execute('CREATE TABLE IF NOT EXISTS app_migrations (name TEXT PRIMARY KEY)')
        applied = {row[0] for row in db.execute('SELECT name FROM app_migrations')}
        for name, migration in migrations:
            if name in applied:
                continue
            statement = ''
            for line in migration.read_text().splitlines(keepends=True):
                if line.startswith('--> statement-breakpoint'):
                    continue
                statement += line
                if sqlite3.complete_statement(statement):
                    db.execute(statement)
                    statement = ''
            if statement.strip():
                raise ValueError('Incomplete database migration')
            db.execute('INSERT INTO app_migrations (name) VALUES (?)', (name,))
        # Preserve requests from the previous JSONL backend once.
        if 'legacy_quotes' not in applied:
            if settings.QUOTES_PATH.exists():
                for line in settings.QUOTES_PATH.read_text().splitlines():
                    if not line.strip():
                        continue
                    item = json.loads(line)
                    db.execute("INSERT OR IGNORE INTO quotes VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (
                        item["id"], "legacy:" + item["id"], item["name"], item.get("email", ""),
                        item.get("phone", ""), item["projectType"], item["message"], item["createdAt"],
                    ))
            db.execute("INSERT INTO app_migrations (name) VALUES (?)", ("legacy_quotes",))
        if 'catalog_seed_v1' not in applied:
            from .catalog import seed
            seed(db)
        db.commit()
        return db
    except BaseException:
        db.rollback()
        db.close()
        raise


def serialize(row):
    return {
        "id": row["id"], "name": row["name"], "email": row["email"], "phone": row["phone"],
        "projectType": row["project_type"], "message": row["message"], "createdAt": row["created_at"],
    }


def rate_limited(db, address):
    now = int(time.time())
    key = hashlib.sha256(address.encode()).hexdigest()
    with db:
        db.execute("DELETE FROM quote_rate_limits WHERE window_start <= ?", (now - 600,))
        row = db.execute(RATE_SQL, (key, now, now - 600, now - 600)).fetchone()
    return row[0] > 5
