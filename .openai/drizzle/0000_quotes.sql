CREATE TABLE IF NOT EXISTS quotes (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        project_type TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quotes_created_at ON quotes(created_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS quote_rate_limits (
        client_key TEXT PRIMARY KEY,
        window_start INTEGER NOT NULL,
        attempts INTEGER NOT NULL
    );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS app_migrations (name TEXT PRIMARY KEY);
