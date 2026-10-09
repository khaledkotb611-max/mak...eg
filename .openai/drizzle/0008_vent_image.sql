-- Approved original photo for all existing vent sizes.
-- Prices, translations, availability and historical orders remain unchanged.
UPDATE backup_state
SET revision = revision + 1
WHERE id = 1 AND EXISTS (
    SELECT 1 FROM products
    WHERE id IN ('pvc-vent-2', 'pvc-vent-3', 'pvc-vent-4')
      AND deleted_at = '' AND image <> '/images/pvc-vent.jpeg'
);
--> statement-breakpoint
UPDATE products
SET image = '/images/pvc-vent.jpeg',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    version = version + 1
WHERE id IN ('pvc-vent-2', 'pvc-vent-3', 'pvc-vent-4')
  AND deleted_at = '' AND image <> '/images/pvc-vent.jpeg';
