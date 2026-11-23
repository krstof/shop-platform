-- =============================================================================
-- Paket P5 (Produktpflege): Video am Produkt, entweder eine eigene Datei oder
-- ein Video bei YouTube oder Vimeo (Kristof 23.11.2026).
-- =============================================================================

-- Video am Produkt (Kristof 23.11.2026): entweder eine eigene Datei (Modul media) oder ein Video
-- bei YouTube oder Vimeo. Mehr als eines braucht niemand, darum stehen die Felder am Produkt und
-- nicht in einer eigenen Tabelle.
ALTER TABLE catalog.product
  ADD COLUMN video_kind text CHECK (video_kind IN ('file','youtube','vimeo')),
  ADD COLUMN video_media_id uuid,                 -- Verweis auf media.media_asset (eigene Datei)
  ADD COLUMN video_provider_id text,              -- Kennung bei YouTube oder Vimeo
  ADD COLUMN video_autoplay boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT product_video_complete CHECK (
    (video_kind IS NULL AND video_media_id IS NULL AND video_provider_id IS NULL)
    OR (video_kind = 'file' AND video_media_id IS NOT NULL AND video_provider_id IS NULL)
    OR (video_kind IN ('youtube','vimeo') AND video_provider_id IS NOT NULL AND video_media_id IS NULL)
  );
