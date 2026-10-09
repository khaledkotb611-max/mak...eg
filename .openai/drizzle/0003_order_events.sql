CREATE TABLE IF NOT EXISTS quote_events (
    id TEXT PRIMARY KEY,
    quote_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    actor TEXT NOT NULL,
    previous_status TEXT NOT NULL,
    status TEXT NOT NULL,
    notes_changed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE (quote_id, version)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quote_events_order ON quote_events(quote_id, version DESC);
