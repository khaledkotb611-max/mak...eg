// Shared SQLite/D1 schema. The build stages these statements as a migration.
export const schemaStatements = [
    `CREATE TABLE IF NOT EXISTS quotes (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        project_type TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS quotes_created_at ON quotes(created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS quote_rate_limits (
        client_key TEXT PRIMARY KEY,
        window_start INTEGER NOT NULL,
        attempts INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS app_migrations (name TEXT PRIMARY KEY)`,
    `CREATE TABLE IF NOT EXISTS quote_admin (
        quote_id TEXT PRIMARY KEY REFERENCES quotes(id),
        status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'fulfilled')),
        notes TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS quote_notifications (
        quote_id TEXT PRIMARY KEY REFERENCES quotes(id),
        state TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        first_attempt INTEGER NOT NULL DEFAULT 0,
        next_attempt INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER NOT NULL DEFAULT 0,
        provider_id TEXT NOT NULL DEFAULT '',
        error_code TEXT NOT NULL DEFAULT '',
        payload TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE INDEX IF NOT EXISTS quote_notifications_pending ON quote_notifications(state, next_attempt)`,
    `CREATE TABLE IF NOT EXISTS backup_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        revision INTEGER NOT NULL DEFAULT 1,
        saved_revision INTEGER NOT NULL DEFAULT 0,
        last_id TEXT NOT NULL DEFAULT '',
        last_at TEXT NOT NULL DEFAULT '',
        last_error TEXT NOT NULL DEFAULT '',
        lease_until INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS quote_events (
        id TEXT PRIMARY KEY,
        quote_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        actor TEXT NOT NULL,
        previous_status TEXT NOT NULL,
        status TEXT NOT NULL,
        notes_changed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE (quote_id, version)
    )`,
    `CREATE INDEX IF NOT EXISTS quote_events_order ON quote_events(quote_id, version DESC)`
,
    `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    name_en TEXT NOT NULL,
    description_en TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL CHECK (category IN ('pipes','fittings','poly')),
    price NUMERIC NOT NULL CHECK (price >= 0 AND price <= 9999999999.99 AND ROUND(price,2)=price),
    image TEXT NOT NULL DEFAULT '',
    details_ar TEXT NOT NULL DEFAULT '{}',
    details_en TEXT NOT NULL DEFAULT '{}',
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT NOT NULL DEFAULT ''
)`,
    `CREATE INDEX IF NOT EXISTS products_visible ON products(deleted_at,active,position,id)`,
    `CREATE TABLE IF NOT EXISTS catalog_meta (id INTEGER PRIMARY KEY CHECK (id=1), imported_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS quote_items (
    quote_id TEXT NOT NULL REFERENCES quotes(id),
    product_id TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 9999),
    unit_price NUMERIC NOT NULL CHECK (unit_price >= 0),
    product_name TEXT NOT NULL,
    product_name_en TEXT NOT NULL,
    product_version INTEGER NOT NULL,
    PRIMARY KEY (quote_id,product_id)
)`,
    `CREATE TRIGGER IF NOT EXISTS products_touch AFTER UPDATE ON products
WHEN NEW.version <= OLD.version
BEGIN
    UPDATE products SET version=OLD.version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id;
END`,
    `CREATE TRIGGER IF NOT EXISTS products_backup_insert AFTER INSERT ON products
BEGIN
    INSERT OR IGNORE INTO backup_state (id) VALUES (1);
    UPDATE backup_state SET revision=revision+1 WHERE id=1;
END`,
    `CREATE TRIGGER IF NOT EXISTS products_backup_update AFTER UPDATE ON products
BEGIN
    INSERT OR IGNORE INTO backup_state (id) VALUES (1);
    UPDATE backup_state SET revision=revision+1 WHERE id=1;
END`,
    `CREATE TRIGGER IF NOT EXISTS products_backup_delete AFTER DELETE ON products
BEGIN
    INSERT OR IGNORE INTO backup_state (id) VALUES (1);
    UPDATE backup_state SET revision=revision+1 WHERE id=1;
END`
];
