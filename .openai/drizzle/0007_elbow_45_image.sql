-- Approved original photo for all existing 45-degree elbow sizes.
-- Prices, translations, availability and historical orders remain unchanged.
UPDATE backup_state
SET revision = revision + 1
WHERE id = 1 AND EXISTS (
    SELECT 1 FROM products
    WHERE id IN ('pvc-elbow-45-1-5', 'pvc-elbow-45-2', 'pvc-elbow-45-3', 'pvc-elbow-45-4', 'pvc-elbow-45-6')
      AND deleted_at = '' AND image <> '/images/pvc-elbow-45.jpeg'
);
--> statement-breakpoint
UPDATE products
SET image = '/images/pvc-elbow-45.jpeg',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    version = version + 1
WHERE id IN ('pvc-elbow-45-1-5', 'pvc-elbow-45-2', 'pvc-elbow-45-3', 'pvc-elbow-45-4', 'pvc-elbow-45-6')
  AND deleted_at = '' AND image <> '/images/pvc-elbow-45.jpeg';
