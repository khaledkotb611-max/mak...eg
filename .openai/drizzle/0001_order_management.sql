CREATE TABLE IF NOT EXISTS quote_admin (
        quote_id TEXT PRIMARY KEY REFERENCES quotes(id),
        status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'fulfilled')),
        notes TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS quote_notifications (
        quote_id TEXT PRIMARY KEY REFERENCES quotes(id),
        state TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        first_attempt INTEGER NOT NULL DEFAULT 0,
        next_attempt INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER NOT NULL DEFAULT 0,
        provider_id TEXT NOT NULL DEFAULT '',
        error_code TEXT NOT NULL DEFAULT '',
        payload TEXT NOT NULL DEFAULT ''
    );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quote_notifications_pending ON quote_notifications(state, next_attempt);
