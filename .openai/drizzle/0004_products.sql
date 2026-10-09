CREATE TABLE IF NOT EXISTS products (
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
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS products_visible ON products(deleted_at,active,position,id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS catalog_meta (id INTEGER PRIMARY KEY CHECK (id=1), imported_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS quote_items (
    quote_id TEXT NOT NULL REFERENCES quotes(id),
    product_id TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 9999),
    unit_price NUMERIC NOT NULL CHECK (unit_price >= 0),
    product_name TEXT NOT NULL,
    product_name_en TEXT NOT NULL,
    product_version INTEGER NOT NULL,
    PRIMARY KEY (quote_id,product_id)
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS products_touch AFTER UPDATE ON products
WHEN NEW.version <= OLD.version
BEGIN
    UPDATE products SET version=OLD.version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS products_backup_insert AFTER INSERT ON products
BEGIN
    INSERT OR IGNORE INTO backup_state (id) VALUES (1);
    UPDATE backup_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS products_backup_update AFTER UPDATE ON products
BEGIN
    INSERT OR IGNORE INTO backup_state (id) VALUES (1);
    UPDATE backup_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS products_backup_delete AFTER DELETE ON products
BEGIN
    INSERT OR IGNORE INTO backup_state (id) VALUES (1);
    UPDATE backup_state SET revision=revision+1 WHERE id=1;
END;
