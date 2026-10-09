-- Approved original photo for all existing access-elbow sizes.
-- Prices, translations, availability and historical orders remain unchanged.
UPDATE backup_state
SET revision = revision + 1
WHERE id = 1 AND EXISTS (
    SELECT 1 FROM products
    WHERE id IN ('pvc-access-elbow-2', 'pvc-access-elbow-3', 'pvc-access-elbow-4', 'pvc-access-elbow-6')
      AND deleted_at = '' AND image <> '/images/pvc-access-elbow.jpeg'
);
--> statement-breakpoint
UPDATE products
SET image = '/images/pvc-access-elbow.jpeg',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    version = version + 1
WHERE id IN ('pvc-access-elbow-2', 'pvc-access-elbow-3', 'pvc-access-elbow-4', 'pvc-access-elbow-6')
  AND deleted_at = '' AND image <> '/images/pvc-access-elbow.jpeg';
