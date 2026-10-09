CREATE TABLE IF NOT EXISTS background_workers (
    id TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    stale_after INTEGER NOT NULL,
    state TEXT NOT NULL,
    error_code TEXT NOT NULL DEFAULT ''
);
