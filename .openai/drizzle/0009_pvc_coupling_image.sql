-- Use the supplied original photo for every ordinary PVC coupling size.
-- Prices, translations, availability and historical orders remain unchanged.
UPDATE backup_state
SET revision = revision + 1
WHERE id = 1 AND EXISTS (
    SELECT 1 FROM products
    WHERE id IN ('pvc-coupling-1-5', 'pvc-coupling-2', 'pvc-coupling-3', 'pvc-coupling-4', 'pvc-coupling-6')
      AND deleted_at = '' AND image <> '/images/pvc-coupling.jpeg'
);
--> statement-breakpoint
UPDATE products
SET image = '/images/pvc-coupling.jpeg',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    version = version + 1
WHERE id IN ('pvc-coupling-1-5', 'pvc-coupling-2', 'pvc-coupling-3', 'pvc-coupling-4', 'pvc-coupling-6')
  AND deleted_at = '' AND image <> '/images/pvc-coupling.jpeg';
